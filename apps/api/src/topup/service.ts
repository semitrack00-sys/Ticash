import { createHash, randomUUID } from 'node:crypto';
import { getCountryCallingCode, isSupportedCountry, type CountryCode } from 'libphonenumber-js';
import type {
  MobileTopUpConfig,
  MobileTopUpDestination,
  MobileTopUpOperator,
  MobileTopUpPaymentProvider,
  MobileTopUpProduct,
  MobileTopUpProvider,
  MobileTopUpStatus,
  ProviderTopUpResult,
} from './types.js';
import { MobileTopUpError } from './types.js';
import {
  normalizeTopUpCountryCode,
  normalizeTopUpPhone,
} from './validation.js';
import type {
  MobileTopUpQuoteRecord,
  MobileTopUpRepository,
  MobileTopUpTransactionRecord,
  SavedTopUpRecipientRecord,
} from './repository.js';

type AuditRecorder = (
  userId: string | undefined,
  action: string,
  entity: string,
  entityId?: string,
  metadata?: Record<string, unknown>,
) => Promise<void>;

const countryCatalogCacheTtlMs = 60_000;

function cents(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }

function planName(operator: MobileTopUpOperator, amount: number): string | undefined {
  const keys = [String(amount), amount.toFixed(2), amount.toFixed(1)];
  for (const key of keys) {
    const value = operator.fixedAmountsPlanNames[key] ?? operator.localFixedAmountsPlanNames[key];
    if (value) return value;
  }
  return undefined;
}

export function productsFromOperator(operator: MobileTopUpOperator): MobileTopUpProduct[] {
  const destinationCurrency = operator.destinationCurrencyCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(destinationCurrency)) return [];
  if (operator.denominationType === 'RANGE') {
    if (!operator.minAmount || !operator.maxAmount || operator.senderCurrencyCode !== 'USD') return [];
    return [{
      id: `reloadly:${operator.countryCode}:${operator.id}:airtime:range`,
      countryCode: operator.countryCode,
      operatorId: operator.id,
      kind: 'AIRTIME',
      name: `${operator.name} airtime`,
      price: operator.minAmount,
      priceCurrency: operator.senderCurrencyCode,
      deliveredCurrency: destinationCurrency,
      amountType: 'RANGE',
      minimumAmount: operator.minAmount,
      maximumAmount: operator.maxAmount,
    }];
  }
  if (operator.senderCurrencyCode !== 'USD') return [];
  return operator.fixedAmounts.map((amount, index) => {
    const plan = planName(operator, amount);
    const kind = plan || operator.bundle ? 'DATA' : 'AIRTIME';
    const deliveredValue = operator.localFixedAmounts[index] ?? Number.NaN;
    return {
      id: `reloadly:${operator.countryCode}:${operator.id}:${kind.toLowerCase()}:${amount.toFixed(2)}`,
      countryCode: operator.countryCode,
      operatorId: operator.id,
      kind,
      name: plan ?? `${operator.name} ${amount.toFixed(2)} ${operator.senderCurrencyCode}`,
      price: cents(amount),
      priceCurrency: operator.senderCurrencyCode,
      deliveredValue: Number.isFinite(deliveredValue) && deliveredValue > 0 ? deliveredValue : undefined,
      deliveredCurrency: destinationCurrency,
      amountType: 'FIXED',
    } satisfies MobileTopUpProduct;
  });
}

function mapProviderStatus(value: string): MobileTopUpStatus {
  const status = value.toUpperCase();
  if (['SUCCESSFUL', 'DELIVERED', 'COMPLETED'].includes(status)) return 'DELIVERED';
  if (['FAILED', 'REJECTED', 'CANCELLED'].includes(status)) return 'FAILED';
  if (['REFUNDED', 'REVERSED'].includes(status)) return 'REFUNDED';
  if (['PROCESSING', 'IN_PROGRESS'].includes(status)) return 'PROCESSING';
  return 'PENDING';
}

export class MobileTopUpService {
  private countriesCache?: { expiresAt: number; value: MobileTopUpDestination[]; key: string };

  constructor(
    private readonly config: MobileTopUpConfig,
    private readonly provider: MobileTopUpProvider,
    private readonly paymentProvider: MobileTopUpPaymentProvider,
    private readonly repository: MobileTopUpRepository,
    private readonly audit: AuditRecorder,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  availability() {
    return {
      enabled: this.config.enabled,
      environment: 'SANDBOX',
      billingCurrency: this.config.billingCurrency,
      provider: 'RELOADLY',
      paymentMode: 'MOCK',
      testMode: true,
      supportedGeographicScope: 'Provider-supported Reloadly Sandbox catalog countries only',
      supportedCountriesPath: '/api/mobile-topups/countries',
      productionEnabled: false,
      approvedForLiveUse: false,
      liveRechargeEnabled: false,
      recurringRechargeEnabled: false,
    };
  }

  private countriesCacheKey() {
    return [
      this.config.airtimeBaseUrl,
      this.config.authUrl,
      this.config.clientId ?? '',
      this.config.environment,
      this.provider.constructor.name,
    ].join('|');
  }

  private assertEnabled() {
    if (!this.config.enabled) {
      throw new MobileTopUpError('MOBILE_TOPUP_DISABLED', 'Mobile recharge Sandbox is not enabled', 503);
    }
  }

  async listCountries() {
    this.assertEnabled();
    const cacheKey = this.countriesCacheKey();
    if (this.countriesCache &&
        this.countriesCache.key === cacheKey &&
        this.countriesCache.expiresAt > Date.now()) {
      return this.countriesCache.value;
    }
    const providerCountries = await this.provider.listCountries();
    if (!Array.isArray(providerCountries)) {
      throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Provider returned an invalid country catalog', 502);
    }
    const supported = new Map<string, MobileTopUpDestination>();
    const skipped = new Set<string>();
    for (const country of providerCountries) {
      // Validate before filtering: malformed data is not an unsupported destination.
      if (!country || typeof country.code !== 'string' || typeof country.name !== 'string' ||
          !/^[A-Za-z]{2}$/.test(country.code.trim())) {
        throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Provider returned an invalid recharge country', 502);
      }
      const code = normalizeTopUpCountryCode(country.code);
      if (!isSupportedCountry(code)) {
        skipped.add(code);
        continue;
      }
      supported.set(code, {
        code,
        name: country.name.trim().slice(0, 160) || code,
        callingCode: `+${getCountryCallingCode(code as CountryCode)}`,
      });
    }
    if (skipped.size) {
      // Only validated ISO-shaped codes; never log provider documents or names.
      console.warn('Mobile recharge skipped unsupported country codes:', [...skipped].sort());
    }
    if (providerCountries.length && !supported.size) {
      throw new MobileTopUpError('UNSUPPORTED_CALLING_CODE', 'No provider destinations have supported calling-code metadata', 502);
    }
    const countries = [...supported.values()].sort((left, right) => left.name.localeCompare(right.name));
    this.countriesCache = {
      key: cacheKey,
      value: countries,
      expiresAt: Date.now() + countryCatalogCacheTtlMs,
    };
    return countries;
  }

  async listOperators(countryCode: string) {
    this.assertEnabled();
    const normalizedCountry = normalizeTopUpCountryCode(countryCode);
    const operators = await this.provider.listOperators(normalizedCountry);
    const mismatch = operators.find(
      (item) => normalizeTopUpCountryCode(item.countryCode) != normalizedCountry,
    );
    if (mismatch) {
      throw new MobileTopUpError(
        'INVALID_PROVIDER_RESPONSE',
        'Recharge operator country did not match the requested destination',
        502,
      );
    }
    return operators.filter((item) => item.status);
  }

  async detectOperator(countryCode: string, phone: string) {
    this.assertEnabled();
    const normalizedCountry = normalizeTopUpCountryCode(countryCode);
    const normalizedPhone = normalizeTopUpPhone(phone, normalizedCountry);
    const operator = await this.provider.detectOperator(normalizedPhone, normalizedCountry);
    if (normalizeTopUpCountryCode(operator.countryCode) !== normalizedCountry) {
      throw new MobileTopUpError(
        'TOPUP_OPERATOR_COUNTRY_MISMATCH',
        'Detected recharge operator does not support the requested destination country',
        400,
      );
    }
    if (!operator.status) {
      throw new MobileTopUpError('TOPUP_OPERATOR_UNAVAILABLE', 'No active recharge operator was detected', 404);
    }
    return operator;
  }

  async products(countryCode: string, operatorId: number) {
    this.assertEnabled();
    const normalizedCountry = normalizeTopUpCountryCode(countryCode);
    const operator = await this.provider.getOperator(operatorId);
    if (normalizeTopUpCountryCode(operator.countryCode) !== normalizedCountry) {
      throw new MobileTopUpError(
        'TOPUP_OPERATOR_COUNTRY_MISMATCH',
        'This recharge operator does not belong to the requested destination country',
        400,
      );
    }
    if (!operator.status) {
      throw new MobileTopUpError('TOPUP_OPERATOR_UNAVAILABLE', 'This recharge operator is unavailable', 404);
    }
    return { operator, products: productsFromOperator(operator) };
  }

  listRecipients(userId: string) { return this.repository.listRecipients(userId); }

  async saveRecipient(userId: string, input: {
    nickname: string;
    phone: string;
    countryCode: string;
    operatorId?: number;
    operatorName?: string;
  }) {
    this.assertEnabled();
    const countryCode = normalizeTopUpCountryCode(input.countryCode);
    const phone = normalizeTopUpPhone(input.phone, countryCode);
    let operatorId = input.operatorId;
    let operatorName = input.operatorName?.trim().slice(0, 160);
    if (operatorId !== undefined) {
      const operator = await this.provider.getOperator(operatorId);
      if (normalizeTopUpCountryCode(operator.countryCode) !== countryCode) {
        throw new MobileTopUpError(
          'TOPUP_OPERATOR_COUNTRY_MISMATCH',
          'Saved recharge recipient operator does not match the destination country',
          400,
        );
      }
      if (!operator.status) {
        throw new MobileTopUpError('TOPUP_OPERATOR_UNAVAILABLE', 'This recharge operator is unavailable', 404);
      }
      operatorId = operator.id;
      operatorName = operator.name;
    }
    const record = await this.repository.saveRecipient({
      userId,
      nickname: input.nickname.trim().slice(0, 80),
      phone,
      countryCode,
      operatorId,
      operatorName,
    });
    await this.audit(userId, 'MOBILE_TOPUP_RECIPIENT_SAVED', 'MobileTopUpRecipient', record.id, {
      countryCode: record.countryCode,
      operatorId: record.operatorId,
    });
    return record;
  }

  async createQuote(userId: string, input: {
    countryCode: string;
    phone: string;
    operatorId: number;
    productId: string;
    amount?: number;
  }): Promise<MobileTopUpQuoteRecord> {
    this.assertEnabled();
    const countryCode = normalizeTopUpCountryCode(input.countryCode);
    const phone = normalizeTopUpPhone(input.phone, countryCode);
    const { operator, products } = await this.products(countryCode, input.operatorId);
    const product = products.find(
      (item) => item.id === input.productId && normalizeTopUpCountryCode(item.countryCode) === countryCode,
    );
    if (!product) {
      throw new MobileTopUpError('TOPUP_PRODUCT_UNAVAILABLE', 'Select a product returned by the recharge provider', 400);
    }
    let amount = product.price;
    if (product.amountType === 'RANGE') {
      if (!Number.isFinite(input.amount) || input.amount! < product.minimumAmount! || input.amount! > product.maximumAmount!) {
        throw new MobileTopUpError('INVALID_TOPUP_AMOUNT', 'Recharge amount is outside the provider-supported range', 400);
      }
      amount = cents(input.amount!);
    }
    const fee = cents(Number(this.config.feeUsd));
    const createdAt = this.clock();
    const quote = await this.repository.createQuote({
      userId,
      countryCode,
      recipientPhone: phone,
      operatorId: operator.id,
      operatorName: operator.name,
      productId: product.id,
      productName: product.name,
      kind: product.kind,
      providerAmount: amount,
      providerCurrency: product.priceCurrency,
      deliveredValue: product.deliveredValue,
      deliveredCurrency: product.deliveredCurrency,
      feeUsd: fee,
      totalChargeUsd: cents(amount + fee),
      expiresAt: new Date(createdAt.getTime() + this.config.quoteTtlSeconds * 1000).toISOString(),
    });
    await this.audit(userId, 'MOBILE_TOPUP_QUOTE_CREATED', 'MobileTopUpQuote', quote.id, {
      countryCode: quote.countryCode,
      operatorId: operator.id,
      productId: product.id,
      testMode: true,
    });
    return quote;
  }

  private requestHash(userId: string, quoteId: string, recipientId?: string) {
    return createHash('sha256').update(JSON.stringify({ userId, quoteId, recipientId: recipientId ?? null })).digest('hex');
  }

  async purchase(userId: string, input: { quoteId: string; recipientId?: string }, idempotencyKey: string) {
    this.assertEnabled();
    if (!/^[A-Za-z0-9._:-]{8,200}$/.test(idempotencyKey)) {
      throw new MobileTopUpError('INVALID_IDEMPOTENCY_KEY', 'A valid Idempotency-Key header is required', 400);
    }
    const replay = await this.repository.getTransactionByIdempotency(userId, idempotencyKey);
    if (replay) {
      if (replay.quoteId !== input.quoteId || replay.recipientId !== input.recipientId) {
        throw new MobileTopUpError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different recharge', 409);
      }
      return replay;
    }
    const quote = await this.repository.getQuote(userId, input.quoteId);
    if (!quote) throw new MobileTopUpError('TOPUP_QUOTE_NOT_FOUND', 'Recharge quote was not found', 404);
    const timestamp = this.clock();
    if (quote.consumedAt || new Date(quote.expiresAt) <= timestamp) {
      throw new MobileTopUpError(quote.consumedAt ? 'TOPUP_QUOTE_ALREADY_USED' : 'TOPUP_QUOTE_EXPIRED', 'Recharge quote is no longer valid', 409);
    }
    let savedRecipient: SavedTopUpRecipientRecord | undefined;
    if (input.recipientId) {
      savedRecipient = (await this.repository.listRecipients(userId)).find((item) => item.id === input.recipientId);
      if (!savedRecipient ||
          savedRecipient.phone !== quote.recipientPhone ||
          savedRecipient.countryCode !== quote.countryCode) {
        throw new MobileTopUpError('TOPUP_RECIPIENT_MISMATCH', 'Saved recharge recipient does not match the quote', 400);
      }
    }
    const createdAt = timestamp.toISOString();
    const { expiresAt: _expiresAt, consumedAt: _consumedAt, ...quoteSnapshot } = quote;
    void _expiresAt;
    void _consumedAt;
    const transaction: MobileTopUpTransactionRecord = {
      ...quoteSnapshot,
      id: randomUUID(),
      quoteId: quote.id,
      recipientId: savedRecipient?.id,
      customIdentifier: `ticash-topup-${randomUUID()}`,
      idempotencyKey,
      requestHash: this.requestHash(userId, quote.id, savedRecipient?.id),
      status: 'PENDING',
      paymentStatus: 'PENDING',
      testMode: true,
      createdAt,
      updatedAt: createdAt,
    };
    const reservation = await this.repository.reserveTransaction(transaction);
    if (!reservation.created) {
      if (reservation.record.requestHash !== transaction.requestHash) {
        throw new MobileTopUpError('IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for a different recharge', 409);
      }
      return reservation.record;
    }
    await this.repository.markQuoteConsumed(userId, quote.id, createdAt);
    const payment = await this.paymentProvider.authorize({
      userId,
      transactionId: transaction.id,
      amount: quote.totalChargeUsd,
      currency: 'USD',
      idempotencyKey,
    });
    if (payment.status !== 'AUTHORIZED') {
      return this.repository.updateTransaction(transaction.id, { paymentStatus: 'FAILED', status: 'FAILED', failureCode: 'PAYMENT_FAILED', failedAt: createdAt });
    }
    await this.repository.updateTransaction(transaction.id, {
      paymentStatus: 'AUTHORIZED',
      paymentAuthorizationId: payment.authorizationId,
    });
    try {
      const providerResult = await this.provider.submitTopUp({
        operatorId: quote.operatorId,
        amount: quote.providerAmount,
        recipientPhone: quote.recipientPhone,
        recipientCountryCode: quote.countryCode,
        customIdentifier: transaction.customIdentifier,
      });
      const updated = await this.applyProviderResult(transaction.id, providerResult);
      if (savedRecipient) {
        await this.repository.updateRecipientLastUsed(userId, savedRecipient.id, quote.productId, quote.productName);
      }
      await this.audit(userId, 'MOBILE_TOPUP_SUBMITTED', 'MobileTopUpTransaction', updated.id, {
        provider: 'RELOADLY',
        countryCode: updated.countryCode,
        providerStatus: updated.providerStatus,
        status: updated.status,
        testMode: true,
      });
      return updated;
    } catch (error) {
      if (error instanceof MobileTopUpError) {
        await this.repository.updateTransaction(transaction.id, {
          status: 'FAILED',
          failureCode: error.code,
          failedAt: this.clock().toISOString(),
        });
      }
      throw error;
    }
  }

  private async applyProviderResult(id: string, result: ProviderTopUpResult) {
    const status = mapProviderStatus(result.status);
    const timestamp = this.clock().toISOString();
    const updated = await this.repository.updateTransaction(id, {
      providerTransactionId: result.transactionId,
      ...(result.operatorTransactionId ? { operatorTransactionId: result.operatorTransactionId } : {}),
      providerStatus: result.status,
      status,
      ...(status === 'REFUNDED' ? { paymentStatus: 'REFUNDED' as const } : {}),
      ...(result.deliveredAmount !== undefined ? { deliveredValue: result.deliveredAmount } : {}),
      ...(result.deliveredAmountCurrencyCode ? { deliveredCurrency: result.deliveredAmountCurrencyCode } : {}),
      ...(status === 'DELIVERED' ? { deliveredAt: timestamp } : {}),
      ...(status === 'FAILED' ? { failedAt: timestamp } : {}),
      ...(status === 'REFUNDED' ? { refundedAt: timestamp } : {}),
    });
    if (status === 'DELIVERED') await this.repository.postDeliveredLedger(updated);
    if (status === 'REFUNDED') await this.repository.postRefundLedger(updated);
    return updated;
  }

  async getTransaction(userId: string, id: string, refresh = false) {
    this.assertEnabled();
    const record = await this.repository.getTransaction(userId, id);
    if (!record) throw new MobileTopUpError('TOPUP_NOT_FOUND', 'Recharge transaction was not found', 404);
    if (refresh && record.providerTransactionId && !['FAILED', 'REFUNDED'].includes(record.status)) {
      return this.applyProviderResult(record.id, await this.provider.getTopUpStatus(record.providerTransactionId));
    }
    return record;
  }

  async listTransactions(userId: string) {
    this.assertEnabled();
    return this.repository.listTransactions(userId);
  }

  async repeat(userId: string, id: string) {
    const previous = await this.getTransaction(userId, id);
    return this.createQuote(userId, {
      countryCode: previous.countryCode,
      phone: previous.recipientPhone,
      operatorId: previous.operatorId,
      productId: previous.productId,
      amount: previous.providerAmount,
    });
  }
}
