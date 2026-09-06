import { createHash, randomUUID } from 'node:crypto';
import type {
  MobileTopUpConfig,
  MobileTopUpOperator,
  MobileTopUpPaymentProvider,
  MobileTopUpProduct,
  MobileTopUpProvider,
  MobileTopUpStatus,
  ProviderTopUpResult,
} from './types.js';
import { MobileTopUpError } from './types.js';
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

function cents(value: number): number { return Math.round((value + Number.EPSILON) * 100) / 100; }

export function normalizeHaitiPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  const local = digits.startsWith('509') ? digits.slice(3) : digits;
  if (!/^\d{8}$/.test(local)) {
    throw new MobileTopUpError('INVALID_HAITI_PHONE', 'Enter a valid Haiti phone number with 8 digits after +509', 400);
  }
  return `+509${local}`;
}

function planName(operator: MobileTopUpOperator, amount: number): string | undefined {
  const keys = [String(amount), amount.toFixed(2), amount.toFixed(1)];
  for (const key of keys) {
    const value = operator.fixedAmountsPlanNames[key] ?? operator.localFixedAmountsPlanNames[key];
    if (value) return value;
  }
  return undefined;
}

export function productsFromOperator(operator: MobileTopUpOperator): MobileTopUpProduct[] {
  const destinationCurrency = operator.destinationCurrencyCode || 'HTG';
  if (operator.denominationType === 'RANGE') {
    if (!operator.minAmount || !operator.maxAmount || operator.senderCurrencyCode !== 'USD') return [];
    return [{
      id: `reloadly:${operator.id}:airtime:range`,
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
    return {
      id: `reloadly:${operator.id}:${kind.toLowerCase()}:${amount.toFixed(2)}`,
      operatorId: operator.id,
      kind,
      name: plan ?? `${operator.name} ${amount.toFixed(2)} ${operator.senderCurrencyCode}`,
      price: cents(amount),
      priceCurrency: operator.senderCurrencyCode,
      deliveredValue: operator.localFixedAmounts[index],
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
      destinationCountry: 'HT',
      destinationCurrency: 'HTG',
      provider: 'RELOADLY',
      paymentMode: 'MOCK',
      productionEnabled: false,
      approvedForLiveUse: false,
      recurringRechargeEnabled: false,
    };
  }

  private assertEnabled() {
    if (!this.config.enabled) {
      throw new MobileTopUpError('MOBILE_TOPUP_DISABLED', 'Mobile recharge Sandbox is not enabled', 503);
    }
  }

  async listOperators(countryCode: string) {
    this.assertEnabled();
    if (countryCode.toUpperCase() !== 'HT') {
      throw new MobileTopUpError('UNSUPPORTED_TOPUP_COUNTRY', 'Mobile recharge is currently available for Haiti only', 400);
    }
    return (await this.provider.listOperators('HT')).filter((item) => item.countryCode === 'HT' && item.status);
  }

  async detectOperator(phone: string) {
    this.assertEnabled();
    const normalized = normalizeHaitiPhone(phone);
    const operator = await this.provider.detectOperator(normalized, 'HT');
    if (operator.countryCode !== 'HT' || !operator.status) {
      throw new MobileTopUpError('TOPUP_OPERATOR_UNAVAILABLE', 'No active Haiti operator was detected', 404);
    }
    return operator;
  }

  async products(operatorId: number) {
    this.assertEnabled();
    const operator = await this.provider.getOperator(operatorId);
    if (operator.countryCode !== 'HT' || !operator.status) {
      throw new MobileTopUpError('TOPUP_OPERATOR_UNAVAILABLE', 'This Haiti operator is unavailable', 404);
    }
    return { operator, products: productsFromOperator(operator) };
  }

  listRecipients(userId: string) { return this.repository.listRecipients(userId); }

  async saveRecipient(userId: string, input: { nickname: string; phone: string; operatorId?: number; operatorName?: string }) {
    this.assertEnabled();
    const record = await this.repository.saveRecipient({
      userId,
      nickname: input.nickname.trim().slice(0, 80),
      phone: normalizeHaitiPhone(input.phone),
      countryCode: 'HT',
      operatorId: input.operatorId,
      operatorName: input.operatorName?.trim().slice(0, 160),
    });
    await this.audit(userId, 'MOBILE_TOPUP_RECIPIENT_SAVED', 'MobileTopUpRecipient', record.id, {
      countryCode: 'HT', operatorId: record.operatorId,
    });
    return record;
  }

  async createQuote(userId: string, input: {
    phone: string; operatorId: number; productId: string; amount?: number;
  }): Promise<MobileTopUpQuoteRecord> {
    this.assertEnabled();
    const phone = normalizeHaitiPhone(input.phone);
    const { operator, products } = await this.products(input.operatorId);
    const product = products.find((item) => item.id === input.productId);
    if (!product) throw new MobileTopUpError('TOPUP_PRODUCT_UNAVAILABLE', 'Select a product returned by the recharge provider', 400);
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
      countryCode: 'HT', operatorId: operator.id, productId: product.id, testMode: true,
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
      if (!savedRecipient || savedRecipient.phone !== quote.recipientPhone) {
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
      paymentStatus: 'AUTHORIZED', paymentAuthorizationId: payment.authorizationId,
    });
    try {
      const providerResult = await this.provider.submitTopUp({
        operatorId: quote.operatorId,
        amount: quote.providerAmount,
        recipientPhone: quote.recipientPhone,
        recipientCountryCode: 'HT',
        customIdentifier: transaction.customIdentifier,
      });
      const updated = await this.applyProviderResult(transaction.id, providerResult);
      if (savedRecipient) await this.repository.updateRecipientLastUsed(userId, savedRecipient.id, quote.productId, quote.productName);
      await this.audit(userId, 'MOBILE_TOPUP_SUBMITTED', 'MobileTopUpTransaction', updated.id, {
        provider: 'RELOADLY', providerStatus: updated.providerStatus, status: updated.status, testMode: true,
      });
      return updated;
    } catch (error) {
      if (error instanceof MobileTopUpError) {
        await this.repository.updateTransaction(transaction.id, {
          status: 'FAILED', failureCode: error.code, failedAt: this.clock().toISOString(),
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
      phone: previous.recipientPhone,
      operatorId: previous.operatorId,
      productId: previous.productId,
      amount: previous.providerAmount,
    });
  }
}
