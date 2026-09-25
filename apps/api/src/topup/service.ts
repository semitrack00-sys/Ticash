import { decodeOperatorId } from './provider-identity.js';
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
import { usdMinorUnits } from './payment-utils.js';
import { approvedRechargeAmountsUsd, approvedRechargePrice, isApprovedRechargeAmountMinorUnits } from './recharge-fee-grid.js';
import type { StripeSandboxPaymentProvider } from './stripe-provider.js';
import { assertVerifiedStripeEvent, type VerifiedStripeEvent } from './stripe-webhook.js';
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

function planName(operator: MobileTopUpOperator, amount: number): string | undefined {
  const keys = [String(amount), amount.toFixed(2), amount.toFixed(1)];
  for (const key of keys) {
    const value = operator.fixedAmountsPlanNames[key] ?? operator.localFixedAmountsPlanNames[key];
    if (value) return value;
  }
  return undefined;
}

export function productsFromOperator(operator: MobileTopUpOperator): MobileTopUpProduct[] {
  const provider = operator.provider ?? decodeOperatorId(operator.id).provider;
  if (provider !== 'RELOADLY') return [];
  const destinationCurrency = operator.destinationCurrencyCode.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(destinationCurrency)) return [];
  if (operator.senderCurrencyCode !== 'USD') return [];
  const approvedAmounts = operator.denominationType === 'RANGE'
    ? approvedRechargeAmountsUsd.filter((amount) => {
      const amountMinorUnits = usdMinorUnits(amount);
      return (!Number.isFinite(operator.minAmount) || amount >= operator.minAmount!) && (!Number.isFinite(operator.maxAmount) || amount <= operator.maxAmount!) && isApprovedRechargeAmountMinorUnits(amountMinorUnits);
    })
    : operator.fixedAmounts.filter((amount) => isApprovedRechargeAmountMinorUnits(usdMinorUnits(amount)));
  return approvedAmounts.flatMap((amount, index) => {
    const plan = planName(operator, amount);
    const kind = plan || operator.bundle ? 'DATA' : 'AIRTIME';
    const amountMinorUnits = usdMinorUnits(amount);
    const deliveredValue = operator.localFixedAmounts[index] ?? Number.NaN;
    return [{
      id: `reloadly:${operator.countryCode}:${operator.id}:${kind.toLowerCase()}:${amount.toFixed(2)}`,
      provider,
      countryCode: operator.countryCode,
      operatorId: operator.id,
      kind,
      name: plan ?? `${operator.name} ${amount.toFixed(2)} ${operator.senderCurrencyCode}`,
      price: amountMinorUnits / 100,
      priceCurrency: operator.senderCurrencyCode,
      deliveredValue: Number.isFinite(deliveredValue) && deliveredValue > 0 ? deliveredValue : undefined,
      deliveredCurrency: destinationCurrency,
      amountType: 'FIXED',
    } satisfies MobileTopUpProduct];
  });
}

function mapProviderStatus(value: string): MobileTopUpStatus {
  const status = value.toUpperCase();
  if (['SUCCESSFUL', 'DELIVERED', 'COMPLETED'].includes(status)) return 'DELIVERED';
  if (['FAILED', 'REJECTED', 'DECLINED', 'CANCELLED'].includes(status)) return 'FAILED';
  if (['REFUNDED', 'REVERSED'].includes(status)) return 'REFUNDED';
  if (['PROCESSING', 'IN_PROGRESS', 'CONFIRMED', 'SUBMITTED'].includes(status)) return 'PROCESSING';
  return 'PENDING';
}

export class MobileTopUpService {
  private countriesCache?: { expiresAt: number; value: MobileTopUpDestination[]; key: string };
  private readonly config: MobileTopUpConfig;
  private readonly provider: MobileTopUpProvider;
  private readonly paymentProvider: MobileTopUpPaymentProvider;
  private readonly repository: MobileTopUpRepository;
  private readonly audit: AuditRecorder;
  private readonly clock: () => Date;
  private readonly stripeProvider?: StripeSandboxPaymentProvider;

  constructor(
    config: MobileTopUpConfig,
    provider: MobileTopUpProvider,
    paymentProvider: MobileTopUpPaymentProvider,
    repository: MobileTopUpRepository,
    audit: AuditRecorder,
    clock: () => Date = () => new Date(),
    stripeProvider?: StripeSandboxPaymentProvider,
  ) {
    this.config = config;
    this.provider = provider;
    this.paymentProvider = paymentProvider;
    this.repository = repository;
    this.audit = audit;
    this.clock = clock;
    this.stripeProvider = stripeProvider;
  }

  availability() {
    const providers = this.config.enabled ? this.provider.providerNames ?? [this.provider.name ?? 'RELOADLY'] : [];
    return {
      enabled: this.config.enabled,
      environment: 'SANDBOX',
      billingCurrency: this.config.billingCurrency,
      provider: providers.length === 1 ? providers[0] : providers.length ? 'MULTI_PROVIDER' : null,
      providerMode: providers.length > 1 ? 'MULTI_PROVIDER' : providers.length ? 'SINGLE_PROVIDER' : 'DISABLED',
      providers,
      paymentMode: this.config.paymentMode === 'stripe_sandbox'
        ? 'STRIPE_SANDBOX'
        : 'MOCK',
      testMode: true,
      supportedGeographicScope: 'Configured sandbox provider catalog countries only',
      supportedCountriesPath: '/api/mobile-topups/countries',
      productionEnabled: false,
      approvedForLiveUse: false,
      liveRechargeEnabled: false,
      recurringRechargeEnabled: false,
    };
  }

  async coverage() {
    this.assertEnabled();
    if (this.provider.coverage) return this.provider.coverage();
    const countries = await this.listCountries();
    const provider = this.provider.name ?? 'RELOADLY';
    return { environment: 'SANDBOX', uniqueCountries: countries.length,
      providers: [{ provider, enabled: true, countries: countries.length }],
      overlapCountries: [], reloadlyOnlyCountries: provider === 'RELOADLY' ? countries.map(country => country.code) : [],
      dtoneOnlyCountries: provider === 'DTONE' ? countries.map(country => country.code) : [] };
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
    const owner = decodeOperatorId(operatorId).provider;
    if (operator.id !== operatorId || (operator.provider && operator.provider !== owner)) {
      throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Recharge operator identity did not match', 502);
    }
    const rawProducts = await this.provider.listProducts?.(normalizedCountry, operatorId) ?? productsFromOperator(operator);
    if (!Array.isArray(rawProducts) || rawProducts.some(product => !product || typeof product.id !== 'string' || product.operatorId !== operatorId || product.countryCode !== normalizedCountry ||
        (product.provider && product.provider !== owner) || !product.id.startsWith(`${owner.toLowerCase()}:${normalizedCountry}:${operatorId}:`) ||
        product.priceCurrency !== 'USD' || !Number.isFinite(product.price) || product.price <= 0 ||
        (owner !== 'RELOADLY' && !product.providerProductId))) {
      throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Invalid provider product identity or price', 502);
    }
    const products = rawProducts.filter((product) => product.amountType === 'FIXED' && isApprovedRechargeAmountMinorUnits(usdMinorUnits(product.price)));
    return { operator: { ...operator, provider: owner }, products };
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
      provider: operatorId === undefined ? undefined : decodeOperatorId(operatorId).provider,
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
    productId?: string;
    amount?: number;
  }): Promise<MobileTopUpQuoteRecord> {
    this.assertEnabled();
    const countryCode = normalizeTopUpCountryCode(input.countryCode);
    const phone = normalizeTopUpPhone(input.phone, countryCode);
    const { operator, products } = await this.products(countryCode, input.operatorId);

    if (input.amount !== undefined) {
      if (operator.denominationType !== 'RANGE') {
        throw new MobileTopUpError('UNSUPPORTED_TOPUP_DENOMINATION', 'Select a supported recharge denomination', 400);
      }
      const amount = Number(input.amount);
      const minAmount = Number.isFinite(operator.minAmount) ? operator.minAmount! : undefined;
      const maxAmount = Number.isFinite(operator.maxAmount) ? operator.maxAmount! : undefined;
      if (minAmount !== undefined && amount < minAmount) {
        throw new MobileTopUpError('INVALID_TOPUP_AMOUNT', 'Recharge amount must be within the displayed range', 400);
      }
      if (maxAmount !== undefined && amount > maxAmount) {
        throw new MobileTopUpError('INVALID_TOPUP_AMOUNT', 'Recharge amount must be within the displayed range', 400);
      }
      const pricing = approvedRechargePrice(amount);
      const customProductId = input.productId && /^custom:/.test(input.productId) ? input.productId : `custom:${(pricing.amountMinorUnits / 100).toFixed(2)}`;
      const createdAt = this.clock();
      const quote = await this.repository.createQuote({
        userId,
        countryCode,
        recipientPhone: phone,
        operatorId: operator.id,
        operatorName: operator.name,
        provider: operator.provider ?? decodeOperatorId(operator.id).provider,
        providerProductId: undefined,
        productId: customProductId,
        productName: `Custom recharge ${((pricing.amountMinorUnits) / 100).toFixed(2)}`,
        kind: 'AIRTIME',
        providerAmount: pricing.amountMinorUnits / 100,
        providerCurrency: 'USD',
        deliveredValue: undefined,
        deliveredCurrency: 'USD',
        feeUsd: pricing.feeMinorUnits / 100,
        totalChargeUsd: pricing.totalMinorUnits / 100,
        expiresAt: new Date(createdAt.getTime() + this.config.quoteTtlSeconds * 1000).toISOString(),
      });
      await this.audit(userId, 'MOBILE_TOPUP_QUOTE_CREATED', 'MobileTopUpQuote', quote.id, {
        countryCode: quote.countryCode,
        operatorId: operator.id,
        productId: quote.productId,
        testMode: true,
      });
      return quote;
    }

    const product = products.find(
      (item) => item.id === input.productId && normalizeTopUpCountryCode(item.countryCode) === countryCode,
    );
    if (!product) {
      throw new MobileTopUpError('TOPUP_PRODUCT_UNAVAILABLE', 'Select a product returned by the recharge provider', 400);
    }
    if (product.amountType !== 'FIXED') {
      throw new MobileTopUpError('UNSUPPORTED_TOPUP_DENOMINATION', 'Select a supported recharge denomination', 400);
    }
    const pricing = approvedRechargePrice(product.price);
    const createdAt = this.clock();
    const quote = await this.repository.createQuote({
      userId,
      countryCode,
      recipientPhone: phone,
      operatorId: operator.id,
      operatorName: operator.name,
      provider: operator.provider ?? decodeOperatorId(operator.id).provider,
      providerProductId: product.providerProductId,
      productId: product.id,
      productName: product.name,
      kind: product.kind,
      providerAmount: pricing.amountMinorUnits / 100,
      providerCurrency: product.priceCurrency,
      deliveredValue: product.deliveredValue,
      deliveredCurrency: product.deliveredCurrency,
      feeUsd: pricing.feeMinorUnits / 100,
      totalChargeUsd: pricing.totalMinorUnits / 100,
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

  private async reservePayment(userId: string, input: { quoteId: string; recipientId?: string }, idempotencyKey: string) {
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
    const transactionId = randomUUID();
    const transaction: MobileTopUpTransactionRecord = {
      ...quoteSnapshot,
      id: transactionId,
      quoteId: quote.id,
      recipientId: savedRecipient?.id,
      customIdentifier: `ticash-topup-${randomUUID()}`,
      idempotencyKey,
      requestHash: this.requestHash(userId, quote.id, savedRecipient?.id),
      status: 'PENDING',
      paymentStatus: 'PENDING',
      paymentMethod: 'CARD',
      paymentProvider: this.config.paymentMode === 'stripe_sandbox'
        ? 'STRIPE'
        : 'MOCK',
      paymentSessionId: this.config.paymentMode === 'mock'
        ? 'mock-session:' + transactionId
        : undefined,
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
    return reservation.record;
  }

  paymentMethods(guest = false) {
    const stripe = this.config.paymentMode === 'stripe_sandbox';
    const stripeReady = stripe && Boolean(this.stripeProvider);
    const cardEnabled = this.config.enabled &&
      ((!stripe) || (stripeReady && !guest));

    const cardReason = !this.config.enabled
      ? 'RECHARGE_DISABLED'
      : guest && stripe
        ? 'GUEST_BILLING_PROFILE_REQUIRED'
        : stripe && !stripeReady
          ? 'PROVIDER_NOT_CONFIGURED'
          : undefined;

    const providerName = stripe ? 'STRIPE' : 'MOCK';

    return { environment: 'SANDBOX', methods: [
      {
        type: 'CARD',
        enabled: cardEnabled,
        provider: providerName,
        testMode: true,
        label: stripe ? 'Test card - Stripe Sandbox' : 'Test card — Sandbox',
        ...(cardReason ? { reason: cardReason } : {}),
      },
      { type: 'APPLE_PAY', enabled: false, provider: providerName, reason: 'PROVIDER_NOT_CONFIGURED' },
      { type: 'GOOGLE_PAY', enabled: false, provider: providerName, reason: 'PROVIDER_NOT_CONFIGURED' },
      { type: 'BANK_ACCOUNT', enabled: false, provider: 'DWOLLA', reason: guest ? 'GUEST_SCOPE_RESTRICTED' : 'NOT_ENABLED_FOR_RECHARGE' },
    ] };
  }

  async createPaymentSession(
    userId: string,
    input: { quoteId: string; recipientId?: string },
    key: string,
    billingCountry?: string,
  ) {
    const reserved = await this.reservePayment(userId, input, key);

    if (reserved.paymentProvider === 'MOCK') {
      const sessionId = reserved.paymentSessionId ?? 'mock-session:' + reserved.id;
      if (!reserved.paymentStartedAt && await this.repository.transitionPayment(reserved.id, ['PENDING'], {
        paymentSessionId: sessionId,
        paymentStatus: 'SESSION_CREATED',
      })) {
        await this.audit(
          userId,
          'MOBILE_TOPUP_PAYMENT_SESSION_CREATED',
          'MobileTopUpTransaction',
          reserved.id,
          { provider: 'MOCK', testMode: true },
        );
      }

      const current = (await this.repository.getTransaction(userId, reserved.id))!;
      return {
        provider: 'MOCK',
        environment: 'SANDBOX',
        testMode: true,
        transactionId: current.id,
        paymentSession: { id: current.paymentSessionId ?? sessionId },
        amountMinor: usdMinorUnits(current.totalChargeUsd),
        currency: 'USD',
        paymentStatus: current.paymentStatus,
      };
    }

    if (this.config.paymentMode === 'stripe_sandbox') {
      if (reserved.paymentProvider !== 'STRIPE' || !this.stripeProvider) {
        throw new MobileTopUpError(
          'PAYMENT_PROVIDER_DISABLED',
          'Stripe Sandbox is not enabled',
          503,
        );
      }

      const country = billingCountry?.trim().toUpperCase();
      if (!country || !/^[A-Z]{2}$/.test(country)) {
        throw new MobileTopUpError(
          'BILLING_COUNTRY_REQUIRED',
          'A verified billing country is required for Stripe Sandbox',
          409,
        );
      }

      if (reserved.paymentSessionId) {
        throw new MobileTopUpError(
          'PAYMENT_SESSION_REPLAY_UNAVAILABLE',
          'This Stripe payment session was already created; do not create another attempt',
          409,
        );
      }

      if (!await this.repository.claimOperation(reserved.id, 'payment', this.clock().toISOString())) {
        const current = await this.repository.getTransaction(userId, reserved.id);
        if (current?.paymentSessionId) {
          throw new MobileTopUpError(
            'PAYMENT_SESSION_REPLAY_UNAVAILABLE',
            'This Stripe payment session was already created; do not create another attempt',
            409,
          );
        }
        throw new MobileTopUpError(
          'PAYMENT_SESSION_IN_PROGRESS',
          'Stripe payment session creation is already in progress',
          409,
        );
      }

      let paymentSession: Record<string, unknown>;
      try {
        paymentSession = await this.stripeProvider.createPaymentSession({
          transactionId: reserved.id,
          amountMinor: usdMinorUnits(reserved.totalChargeUsd),
          currency: 'USD',
          billingCountry: country,
        });
      } catch (error) {
        await this.repository.updateTransaction(reserved.id, { paymentRecoveryCode: 'PAYMENT_SESSION_CREATION_UNKNOWN' });
        await this.audit(userId, 'MOBILE_TOPUP_PAYMENT_RECONCILIATION_REQUIRED', 'MobileTopUpTransaction', reserved.id, { provider: 'STRIPE', stage: 'PAYMENT_SESSION' });
        if (error instanceof MobileTopUpError) throw error;
        throw new MobileTopUpError('PAYMENT_SESSION_CREATION_UNKNOWN', 'Stripe payment session creation requires reconciliation', 502);
      }

      const sessionId = typeof paymentSession.id === 'string' ? paymentSession.id : '';
      if (!/^pi_[A-Za-z0-9_]+$/.test(sessionId)) {
        throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Stripe returned an invalid payment session', 502);
      }

      await this.repository.updateTransaction(reserved.id, {
        paymentSessionId: sessionId,
        paymentStatus: 'SESSION_CREATED',
      });
      await this.audit(userId, 'MOBILE_TOPUP_PAYMENT_SESSION_CREATED', 'MobileTopUpTransaction', reserved.id, { provider: 'STRIPE', testMode: true });
      return {
        ...this.stripeProvider.flowContract(reserved.id, paymentSession),
        testMode: true,
        amountMinor: usdMinorUnits(reserved.totalChargeUsd),
        currency: 'USD',
        paymentStatus: 'SESSION_CREATED',
      };
    }

    throw new MobileTopUpError(
      'PAYMENT_PROVIDER_DISABLED',
      'Stripe Sandbox is not enabled',
      503,
    );
  }

  async purchase(userId: string, input: { quoteId: string; recipientId?: string }, idempotencyKey: string) {
    const transaction = await this.reservePayment(userId, input, idempotencyKey);
    // Hosted-provider records can only be fulfilled by verified server events.
    if (transaction.paymentProvider !== 'MOCK') return transaction;
    if (await this.repository.claimOperation(transaction.id, 'payment', this.clock().toISOString())) {
      let payment;
      try {
        payment = await this.paymentProvider.authorize({ userId, transactionId: transaction.id,
          amount: transaction.totalChargeUsd, currency: 'USD', idempotencyKey });
      } catch {
        await this.repository.updateTransaction(transaction.id, { paymentRecoveryCode: 'PAYMENT_AUTHORIZATION_UNKNOWN' });
        await this.audit(userId, 'MOBILE_TOPUP_PAYMENT_RECONCILIATION_REQUIRED', 'MobileTopUpTransaction', transaction.id);
        throw new MobileTopUpError('PAYMENT_AUTHORIZATION_UNKNOWN', 'Payment requires reconciliation; do not start another attempt', 502);
      }
      if (payment.status !== 'AUTHORIZED' || !payment.authorizationId || payment.testMode !== true) {
        const failed = await this.repository.updateTransaction(transaction.id, { paymentStatus: 'FAILED', status: 'FAILED', failureCode: 'PAYMENT_FAILED', failedAt: this.clock().toISOString() });
        await this.audit(userId, 'MOBILE_TOPUP_PAYMENT_FAILED', 'MobileTopUpTransaction', transaction.id);
        return failed;
      }
      await this.repository.updateTransaction(transaction.id, { paymentStatus: 'AUTHORIZED', paymentAuthorizationId: payment.authorizationId,
        paymentProviderTransactionId: payment.authorizationId });
      await this.audit(userId, 'MOBILE_TOPUP_PAYMENT_AUTHORIZED', 'MobileTopUpTransaction', transaction.id, { provider: 'MOCK' });
    }
    return this.fulfillPaidRecharge(transaction.id);
  }

  async fulfillPaidRecharge(id: string) {
    this.assertEnabled();
    const transaction = await this.repository.getTransactionById(id);
    if (!transaction) throw new MobileTopUpError('TOPUP_NOT_FOUND', 'Recharge transaction was not found', 404);
    if (!await this.repository.claimOperation(id, 'fulfillment', this.clock().toISOString())) return (await this.repository.getTransactionById(id))!;
    await this.audit(transaction.userId, 'MOBILE_TOPUP_FULFILLMENT_STARTED', 'MobileTopUpTransaction', id, { testMode: true });
    let providerResult: ProviderTopUpResult;
    try {
      providerResult = await this.provider.submitTopUp({ operatorId: transaction.operatorId, amount: transaction.providerAmount,
        provider: transaction.provider ?? decodeOperatorId(transaction.operatorId).provider, productId: transaction.productId,
        providerProductId: transaction.providerProductId, providerCurrency: transaction.providerCurrency,
        recipientPhone: transaction.recipientPhone, recipientCountryCode: transaction.countryCode, customIdentifier: transaction.customIdentifier });
    } catch (error) {
      const rejected = error instanceof MobileTopUpError && error.statusCode === 400;
      await this.repository.updateTransaction(id, { status: rejected ? 'FAILED' : 'PROCESSING',
        failureCode: rejected ? 'TOPUP_REJECTED' : 'TOPUP_SUBMISSION_UNKNOWN',
        paymentRecoveryCode: rejected ? 'PAYMENT_RECOVERY_REQUIRED' : 'FULFILLMENT_RECONCILIATION_REQUIRED',
        ...(rejected ? { failedAt: this.clock().toISOString() } : {}) });
      await this.audit(transaction.userId, 'MOBILE_TOPUP_FULFILLMENT_RECONCILIATION_REQUIRED', 'MobileTopUpTransaction', id, { rejected });
      if (rejected) await this.recoverPayment(id);
      throw new MobileTopUpError(rejected ? 'TOPUP_REJECTED' : 'TOPUP_SUBMISSION_UNKNOWN', 'Recharge needs reconciliation; retrying will not resubmit airtime', 502);
    }
    // Keep persistence/audit failures out of the provider-submission catch: a known
    // accepted top-up must never be turned into a rejected top-up or refunded here.
    const updated = await this.applyProviderResult(id, providerResult);
    if (transaction.recipientId) await this.repository.updateRecipientLastUsed(transaction.userId, transaction.recipientId, transaction.productId, transaction.productName);
    await this.audit(transaction.userId, 'MOBILE_TOPUP_SUBMITTED', 'MobileTopUpTransaction', id,
      { provider: transaction.provider ?? decodeOperatorId(transaction.operatorId).provider, status: updated.status, testMode: true });
    return updated;
  }

  private async recoverPayment(id: string, providerReversed = false) {
    if (!await this.repository.claimOperation(id, 'recovery', this.clock().toISOString())) return (await this.repository.getTransactionById(id))!;
    let record;
    let refund;
    let pending: 'REFUND_PENDING' | 'VOID_PENDING';
    // A webhook may confirm capture/recovery while the claim is being acquired.
    // Compare-and-set prevents downgrading that confirmation to a pending state.
    do {
      record = (await this.repository.getTransactionById(id))!;
      if (!['AUTHORIZED', 'CAPTURED'].includes(record.paymentStatus)) return record;
      refund = record.paymentStatus === 'CAPTURED' || (providerReversed && record.paymentProvider === 'MOCK');
      pending = refund ? 'REFUND_PENDING' : 'VOID_PENDING';
    } while (!await this.repository.transitionPayment(id, [record.paymentStatus], {
      paymentStatus: pending, paymentRecoveryCode: 'PAYMENT_RECOVERY_REQUIRED',
    }));
    await this.audit(record.userId, 'MOBILE_TOPUP_PAYMENT_' + pending, 'MobileTopUpTransaction', id);
    // No implicit fallback from a hosted provider to a mock refund.
    const recovery = record.paymentProvider === 'MOCK'
      ? this.paymentProvider
      : record.paymentProvider === 'STRIPE'
        ? this.stripeProvider
        : undefined;
    const paymentId = record.paymentProviderTransactionId ?? record.paymentAuthorizationId;
    try {
      const status = paymentId && (refund
        ? await recovery?.refund?.({ paymentId, transactionId: id, amountMinor: usdMinorUnits(record.totalChargeUsd) })
        : await recovery?.void?.({ paymentId, transactionId: id }));
      if (status === (refund ? 'REFUNDED' : 'VOIDED')) {
        if (await this.repository.transitionPayment(id, [pending], { paymentStatus: status, paymentRecoveryCode: 'RECOVERY_CONFIRMED' })) {
          await this.audit(record.userId, 'MOBILE_TOPUP_PAYMENT_' + status, 'MobileTopUpTransaction', id);
        }
        return (await this.repository.getTransactionById(id))!;
      }
    } catch { /* Unknown recovery outcome stays pending for reconciliation. */ }
    await this.audit(record.userId, 'MOBILE_TOPUP_PAYMENT_RECONCILIATION_REQUIRED', 'MobileTopUpTransaction', id);
    return (await this.repository.getTransactionById(id))!;
  }

  async acceptVerifiedPaymentEvent(event: VerifiedStripeEvent) {
    this.assertEnabled();
    assertVerifiedStripeEvent(event);

    const record = await this.repository.getTransactionById(event.transactionId);
    const hostedProvider = record?.paymentProvider === 'STRIPE';
    if (!record || !hostedProvider || !record.paymentSessionId) {
      throw new MobileTopUpError('PAYMENT_NOT_FOUND', 'Hosted payment was not found', 404);
    }
    const paymentIdMismatch = record.paymentProviderTransactionId && record.paymentProviderTransactionId !== event.paymentId;
    const ignoreNonSuccessStripeFollowUp = event.type !== 'payment_intent.succeeded' && ['SESSION_CREATED', 'PENDING', 'AUTHORIZED', 'CAPTURED', 'FAILED'].includes(record.paymentStatus);
    if (event.amountMinor !== usdMinorUnits(record.totalChargeUsd) || event.currency !== 'USD' ||
        (paymentIdMismatch && !ignoreNonSuccessStripeFollowUp)) {
      throw new MobileTopUpError('PAYMENT_EVENT_MISMATCH', 'Payment event did not match the reserved recharge', 409);
    }
    if (!await this.repository.registerPaymentEvent(event.eventId, event.payloadHash, record.id)) return;

    const transitionMap = {
      'payment_intent.succeeded': { from: ['PENDING', 'SESSION_CREATED', 'AUTHORIZED'], to: 'AUTHORIZED' },
      'payment_intent.payment_failed': { from: ['PENDING', 'SESSION_CREATED'], to: 'FAILED' },
      'payment_intent.canceled': { from: ['PENDING', 'SESSION_CREATED'], to: 'FAILED' },
      'payment_intent.processing': { from: ['PENDING', 'SESSION_CREATED'], to: 'PENDING' },
      'payment_intent.requires_action': { from: ['PENDING', 'SESSION_CREATED'], to: 'PENDING' },
      'payment_intent.incomplete': { from: ['PENDING', 'SESSION_CREATED'], to: 'PENDING' },
      'payment_intent.partially_funded': { from: ['PENDING', 'SESSION_CREATED'], to: 'PENDING' },
    } as const;
    const transition = transitionMap[event.type];
    if (!transition) return;
    const changed = await this.repository.transitionPayment(record.id, [...transition.from], {
      paymentStatus: transition.to,
      paymentProviderTransactionId: event.paymentId,
      ...(transition.to === 'FAILED' ? { status: 'FAILED', failureCode: 'PAYMENT_DECLINED', failedAt: this.clock().toISOString() } : {}),
    });
    if (changed) await this.audit(record.userId, 'MOBILE_TOPUP_PAYMENT_' + transition.to, 'MobileTopUpTransaction', record.id, { provider: record.paymentProvider });
    if (transition.to === 'AUTHORIZED') await this.fulfillPaidRecharge(record.id);
    await this.repository.completePaymentEvent(event.eventId);
  }

  private async applyProviderResult(id: string, result: ProviderTopUpResult) {
    const status = mapProviderStatus(result.status);
    const timestamp = this.clock().toISOString();
    const updated = await this.repository.updateTransaction(id, {
      providerTransactionId: result.transactionId,
      ...(result.operatorTransactionId ? { operatorTransactionId: result.operatorTransactionId } : {}),
      providerStatus: result.rawStatus ?? result.status,
      status,
      ...(result.deliveredAmount !== undefined ? { deliveredValue: result.deliveredAmount } : {}),
      ...(result.deliveredAmountCurrencyCode ? { deliveredCurrency: result.deliveredAmountCurrencyCode } : {}),
      ...(status === 'DELIVERED' ? { deliveredAt: timestamp } : {}),
      ...(status === 'FAILED' ? { failedAt: timestamp } : {}),
      ...(status === 'REFUNDED' ? { refundedAt: timestamp } : {}),
    });
    if (status === 'DELIVERED') await this.repository.postDeliveredLedger(updated);
    if (status === 'REFUNDED') await this.repository.postRefundLedger(updated);
    if (status === 'FAILED' || status === 'REFUNDED') return this.recoverPayment(id, status === 'REFUNDED');
    return updated;
  }

  async getTransaction(userId: string, id: string, refresh = false) {
    this.assertEnabled();
    const record = await this.repository.getTransaction(userId, id);
    if (!record) throw new MobileTopUpError('TOPUP_NOT_FOUND', 'Recharge transaction was not found', 404);
    if (refresh && record.providerTransactionId && !['FAILED', 'REFUNDED'].includes(record.status)) {
      return this.applyProviderResult(record.id, await this.provider.getTopUpStatus(record.providerTransactionId, record.provider ?? decodeOperatorId(record.operatorId).provider));
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
