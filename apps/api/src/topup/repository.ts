import type { ReceiverQuote } from './receiver-value.js';
import { notificationFor, retryableNotification, type ReceiverNotification, type ReceiverNotificationStore } from './receiver-notification.js';
import { ownerData, ownerWhere, ownerFromDb, recipientOwnerKey, transactionOwnerKey } from '../flupflap/owner.js';
import { decodeOperatorId } from './provider-identity.js';
import { randomUUID } from 'node:crypto';
import { marketingEnabled, sandboxBenefitsEnabled } from '../flupflap/marketing.js';
import { reconcilePromotion, reserveQuotePromotion } from '../flupflap/marketing-recharge.js';
import { Prisma, type PrismaClient } from '@prisma/client';
import type {
  MobileTopUpRuntimeEnvironment,
  MobileTopUpKind,
  MobileTopUpProduct,
  MobileTopUpProviderName,
  MobileTopUpPaymentStatus,
  MobileTopUpPaymentMethod,
  MobileTopUpPaymentProviderName,
  MobileTopUpStatus,
} from './types.js';
import { MobileTopUpError } from './types.js';

export interface SavedTopUpRecipientRecord {
  language?: string;
  provider?: MobileTopUpProviderName;
  id: string;
  userId: string;
  nickname: string;
  phone: string;
  countryCode: string;
  operatorId?: number;
  operatorName?: string;
  lastProductId?: string;
  lastProductName?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MobileTopUpQuoteRecord {
  receiverQuote?: ReceiverQuote;
  productSnapshot?: MobileTopUpProduct;
  provider?: MobileTopUpProviderName;
  providerProductId?: string;
  id: string;
  userId: string;
  countryCode: string;
  recipientPhone: string;
  operatorId: number;
  operatorName: string;
  productId: string;
  productName: string;
  kind: MobileTopUpKind;
  providerAmount: number;
  providerCurrency: string;
  deliveredValue?: number;
  deliveredCurrency: string;
  feeUsd: number;
  totalChargeUsd: number;
  testMode: boolean;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
}

export interface MobileTopUpTransactionRecord extends Omit<MobileTopUpQuoteRecord, 'expiresAt' | 'consumedAt'> {
  receiverValueConfirmed?: boolean;
  receiverDiscrepancy?: boolean;
  receiverLanguage?: string;
  quoteId: string;
  recipientId?: string;
  providerTransactionId?: string;
  operatorTransactionId?: string;
  customIdentifier: string;
  idempotencyKey: string;
  requestHash: string;
  status: MobileTopUpStatus;
  paymentStatus: MobileTopUpPaymentStatus;
  paymentAuthorizationId?: string;
  paymentMethod?: MobileTopUpPaymentMethod;
  paymentProvider?: MobileTopUpPaymentProviderName;
  paymentEnvironment: MobileTopUpRuntimeEnvironment;
  rechargeEnvironment: MobileTopUpRuntimeEnvironment;
  paymentSessionId?: string;
  paymentProviderTransactionId?: string;
  checkoutResumeTokenHash?: string;
  checkoutResumeTokenExpiresAt?: string;
  paymentStartedAt?: string;
  fulfillmentStartedAt?: string;
  recoveryStartedAt?: string;
  paymentRecoveryCode?: string;
  providerStatus?: string;
  failureCode?: string;
  testMode: boolean;
  updatedAt: string;
  deliveredAt?: string;
  failedAt?: string;
  refundedAt?: string;
  customerHiddenAt?: string;
}

export interface MobileTopUpRepository extends ReceiverNotificationStore {
  getCountryCatalogCache?(key: string): Promise<{ value: unknown; validatedAt: string; expiresAt: string } | undefined>;
  saveCountryCatalogCache?(key: string, value: unknown, validatedAt: string, expiresAt: string): Promise<void>;
  listRecipients(userId: string): Promise<SavedTopUpRecipientRecord[]>;
  saveRecipient(input: Omit<SavedTopUpRecipientRecord, 'id' | 'createdAt' | 'updatedAt'>): Promise<SavedTopUpRecipientRecord>;
  updateRecipientLastUsed(userId: string, id: string, productId: string, productName: string): Promise<void>;
  createQuote(input: Omit<MobileTopUpQuoteRecord, 'id' | 'createdAt'>): Promise<MobileTopUpQuoteRecord>;
  getQuote(userId: string, id: string): Promise<MobileTopUpQuoteRecord | undefined>;
  markQuoteConsumed(userId: string, id: string, when: string): Promise<void>;
  reserveTransaction(input: MobileTopUpTransactionRecord): Promise<{ record: MobileTopUpTransactionRecord; created: boolean }>;
  getTransactionById(id: string): Promise<MobileTopUpTransactionRecord | undefined>;
  getTransactionByCheckoutResumeTokenHash(tokenHash: string): Promise<MobileTopUpTransactionRecord | undefined>;
  listReconciliationCandidates(limit: number, staleBefore: string): Promise<MobileTopUpTransactionRecord[]>;
  claimOperation(id: string, operation: 'payment' | 'fulfillment' | 'recovery', when: string): Promise<boolean>;
  transitionPayment(id: string, from: MobileTopUpPaymentStatus[], input: TransactionUpdate): Promise<boolean>;
  registerPaymentEvent(eventId: string, payloadHash: string, transactionId: string): Promise<boolean>;
  completePaymentEvent(eventId: string): Promise<void>;
  getTransactionByIdempotency(userId: string, key: string): Promise<MobileTopUpTransactionRecord | undefined>;
  getTransaction(userId: string, id: string): Promise<MobileTopUpTransactionRecord | undefined>;
  listFlupFlapTransactions(offset: number): Promise<MobileTopUpTransactionRecord[]>;
  listTransactions(userId: string): Promise<MobileTopUpTransactionRecord[]>;
  hideTransactionFromCustomer(userId: string, id: string, when: string): Promise<boolean>;
  updateTransaction(id: string, input: TransactionUpdate): Promise<MobileTopUpTransactionRecord>;
  postDeliveredLedger(record: MobileTopUpTransactionRecord): Promise<void>;
  postRefundLedger(record: MobileTopUpTransactionRecord): Promise<void>;
  reset?(): void;
}

export type TransactionUpdate = Partial<Pick<MobileTopUpTransactionRecord,
    'receiverValueConfirmed' | 'receiverDiscrepancy' | 'providerTransactionId' | 'operatorTransactionId' | 'status' | 'paymentStatus' |
    'paymentAuthorizationId' | 'providerStatus' | 'failureCode' | 'deliveredValue' |
    'deliveredCurrency' | 'deliveredAt' | 'failedAt' | 'refundedAt' | 'paymentMethod' |
  'paymentProvider' |
  'paymentSessionId' | 'paymentProviderTransactionId' | 'paymentRecoveryCode' |
      'checkoutResumeTokenHash' | 'checkoutResumeTokenExpiresAt' | 'customerHiddenAt'>>;

const notifications = new Map<string, ReceiverNotification>();
const recipients = new Map<string, SavedTopUpRecipientRecord>();
const quotes = new Map<string, MobileTopUpQuoteRecord>();
const transactions = new Map<string, MobileTopUpTransactionRecord>();
const ledgerReferences = new Set<string>();
const paymentEvents = new Map<string, { payloadHash: string; transactionId: string; processed: boolean }>();

export function resetMobileTopUpStore(): void {
  notifications.clear();
  recipients.clear();
  quotes.clear();
  transactions.clear();
  ledgerReferences.clear();
  paymentEvents.clear();
}

function now(): string { return new Date().toISOString(); }

export class MemoryMobileTopUpRepository implements MobileTopUpRepository {
  async listRetryableNotificationIds(limit: number) {
    return [...notifications.values()].filter(retryableNotification).slice(0, limit).map(n => n.transactionId);
  }
  async getNotification(id: string) { return notifications.get(id); }
  async claimNotification(id: string, when: string) {
    const record = notifications.get(id);
    const transaction = transactions.get(id);
    if (!record || !retryableNotification(record) || transaction?.status !== 'DELIVERED' || !transaction.receiverValueConfirmed) return false;
    notifications.set(id, { ...record, status: 'PENDING', claimedAt: when, attempts: record.attempts + 1, lastErrorCategory: undefined });
    return true;
  }
  async finishNotification(id: string, update: Parameters<ReceiverNotificationStore['finishNotification']>[1]) {
    const record = notifications.get(id);
    if (record) notifications.set(id, { ...record, ...update, updatedAt: now() });
  }
  async getTransactionById(id: string) { return transactions.get(id); }

  async getTransactionByCheckoutResumeTokenHash(tokenHash: string) {
    return [...transactions.values()].find((item) => item.checkoutResumeTokenHash === tokenHash);
  }

  async listReconciliationCandidates(limit: number, staleBefore: string) {
    return [...transactions.values()]
      .filter((item) =>
        (
          (item.status === 'PROCESSING' &&
            ['AUTHORIZED', 'CAPTURED'].includes(item.paymentStatus)) ||
          (item.paymentProvider === 'STRIPE' &&
            item.status === 'PENDING' &&
            ['PENDING', 'SESSION_CREATED'].includes(item.paymentStatus)) ||
          ['REFUND_PENDING', 'VOID_PENDING'].includes(item.paymentStatus)
        ) &&
        item.updatedAt <= staleBefore)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, Math.max(0, limit));
  }

  async claimOperation(id: string, operation: 'payment' | 'fulfillment' | 'recovery', when: string) {
    const record = transactions.get(id);
    const field = operationField(operation);
    if (!record || record[field]) return false;
    if (operation === 'payment') {
      const mockAllowed =
        record.paymentProvider === 'MOCK' &&
        ['PENDING', 'SESSION_CREATED'].includes(record.paymentStatus);
      const stripeAllowed =
        record.paymentProvider === 'STRIPE' &&
        record.paymentStatus === 'PENDING';
      if (!mockAllowed && !stripeAllowed) return false;
    }
    if (operation === 'fulfillment') {
      const mockAllowed = record.paymentProvider === 'MOCK' && ['AUTHORIZED', 'CAPTURED'].includes(record.paymentStatus);
      const stripeAllowed = record.paymentProvider === 'STRIPE' && ['AUTHORIZED', 'CAPTURED'].includes(record.paymentStatus);
      if (record.providerTransactionId || record.status !== 'PENDING' || !paid(record) || (!mockAllowed && !stripeAllowed)) return false;
    }
    if (operation === 'recovery' && !['AUTHORIZED', 'CAPTURED'].includes(record.paymentStatus)) return false;
    transactions.set(id, { ...record, [field]: when, updatedAt: now() });
    return true;
  }

  async transitionPayment(id: string, from: MobileTopUpPaymentStatus[], input: TransactionUpdate) {
    const record = transactions.get(id);
    if (!record || !from.includes(record.paymentStatus)) return false;
    if (input.paymentProviderTransactionId && record.paymentProviderTransactionId && input.paymentProviderTransactionId !== record.paymentProviderTransactionId) return false;
    transactions.set(id, { ...record, ...input, updatedAt: now() });
    return true;
  }

  async registerPaymentEvent(eventId: string, payloadHash: string, transactionId: string) {
    const existing = paymentEvents.get(eventId);
    if (existing) {
      assertSameEvent(existing, payloadHash, transactionId);
      return !existing.processed;
    }
    paymentEvents.set(eventId, { payloadHash, transactionId, processed: false });
    return true;
  }
  async completePaymentEvent(eventId: string) { paymentEvents.get(eventId)!.processed = true; }

  async listRecipients(userId: string) {
    return [...recipients.values()]
      .filter((item) => item.userId === userId)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async saveRecipient(input: Omit<SavedTopUpRecipientRecord, 'id' | 'createdAt' | 'updatedAt'>) {
    const existing = [...recipients.values()].find(
      (item) => item.userId === input.userId && item.phone === input.phone && item.countryCode === input.countryCode,
    );
    const timestamp = now();
    const record: SavedTopUpRecipientRecord = {
      id: existing?.id ?? randomUUID(),
      ...existing,
      ...input,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    recipients.set(record.id, record);
    return record;
  }

  async updateRecipientLastUsed(userId: string, id: string, productId: string, productName: string) {
    const record = recipients.get(id);
    if (record?.userId === userId) {
      recipients.set(id, { ...record, lastProductId: productId, lastProductName: productName, updatedAt: now() });
    }
  }

  async createQuote(input: Omit<MobileTopUpQuoteRecord, 'id' | 'createdAt'>) {
    const record = { id: randomUUID(), ...input, createdAt: now() };
    quotes.set(record.id, record);
    return record;
  }

  async getQuote(userId: string, id: string) {
    const record = quotes.get(id);
    return record?.userId === userId ? record : undefined;
  }

  async markQuoteConsumed(userId: string, id: string, when: string) {
    const quote = await this.getQuote(userId, id);
    if (!quote) throw new MobileTopUpError('TOPUP_QUOTE_NOT_FOUND', 'Recharge quote was not found', 404);
    quotes.set(id, { ...quote, consumedAt: quote.consumedAt ?? when });
  }

  async reserveTransaction(input: MobileTopUpTransactionRecord) {
    const replay = [...transactions.values()].find(
      (item) => item.userId === input.userId && item.idempotencyKey === input.idempotencyKey,
    );
    if (replay) return { record: replay, created: false };
    const sameQuote = [...transactions.values()].find((item) => item.quoteId === input.quoteId);
    if (sameQuote) throw new MobileTopUpError('TOPUP_QUOTE_ALREADY_USED', 'Recharge quote was already submitted', 409);
    const quote = quotes.get(input.quoteId);
    if (!quote || quote.userId !== input.userId || quote.consumedAt || quote.expiresAt <= input.createdAt) {
      throw new MobileTopUpError('TOPUP_QUOTE_ALREADY_USED', 'Recharge quote is no longer available', 409);
    }
    quotes.set(quote.id, { ...quote, consumedAt: input.createdAt });
    transactions.set(input.id, input);
    return { record: input, created: true };
  }

  async getTransaction(userId: string, id: string) {
    const record = transactions.get(id);
    return record?.userId === userId && !record.customerHiddenAt ? record : undefined;
  }

  async getTransactionByIdempotency(userId: string, key: string) {
    return [...transactions.values()].find((item) => item.userId === userId && item.idempotencyKey === key);
  }

  async listFlupFlapTransactions(offset: number) {
    return [...transactions.values()].filter(item => item.userId.startsWith('flupflap:'))
      .sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(offset,offset+100);
  }
  async listTransactions(userId: string) {
    return [...transactions.values()]
      .filter((item) => item.userId === userId && !item.customerHiddenAt)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async hideTransactionFromCustomer(userId: string, id: string, when: string) {
    const record = transactions.get(id);
    if (!record || record.userId !== userId || record.customerHiddenAt ||
        record.status !== 'FAILED' || record.paymentStatus !== 'FAILED' || record.failureCode !== 'CANCELLED_BY_CUSTOMER') return false;
    transactions.set(id, { ...record, customerHiddenAt: when, updatedAt: now() });
    return true;
  }

  async updateTransaction(id: string, input: TransactionUpdate) {
    const record = transactions.get(id);
    if (!record) throw new MobileTopUpError('TOPUP_NOT_FOUND', 'Recharge transaction was not found', 404);
    if (record.status === 'DELIVERED' && record.receiverValueConfirmed && input.status === 'DELIVERED') return record;
    const updated = { ...record, ...input, updatedAt: now() };
    transactions.set(id, updated);
    const notification = notificationFor(updated);
    if (notification && !notifications.has(id)) notifications.set(id, notification);
    return updated;
  }

  async postDeliveredLedger(record: MobileTopUpTransactionRecord) {
    ledgerReferences.add(`mobile-topup:${record.id}:delivered`);
  }

  async postRefundLedger(record: MobileTopUpTransactionRecord) {
    if (ledgerReferences.has(`mobile-topup:${record.id}:delivered`)) {
      ledgerReferences.add(`mobile-topup:${record.id}:refunded`);
    }
  }

  reset() { resetMobileTopUpStore(); }
}

function quoteFromDb(record: {
  receiverQuote?: Prisma.JsonValue | null;
  productSnapshot?: Prisma.JsonValue | null;
  provider?: MobileTopUpProviderName; providerProductId?: string | null;
  id: string; userId: string | null; flupFlapCustomerId?: string | null; countryCode: string; recipientPhone: string; operatorId: number; operatorName: string;
  productId: string; productName: string; kind: MobileTopUpKind; providerAmount: Prisma.Decimal;
  providerCurrency: string; deliveredValue: Prisma.Decimal | null; deliveredCurrency: string;
  feeUsd: Prisma.Decimal; totalChargeUsd: Prisma.Decimal; testMode: boolean; expiresAt: Date; consumedAt: Date | null; createdAt: Date;
}): MobileTopUpQuoteRecord {
  return {
    id: record.id,
    provider: record.provider ?? decodeOperatorId(record.operatorId).provider,
    providerProductId: record.providerProductId ?? undefined,
    receiverQuote: record.receiverQuote ? record.receiverQuote as unknown as ReceiverQuote : undefined,
    productSnapshot: record.productSnapshot ? record.productSnapshot as unknown as MobileTopUpProduct : undefined,
    userId: ownerFromDb(record),
    countryCode: record.countryCode,
    recipientPhone: record.recipientPhone,
    operatorId: record.operatorId,
    operatorName: record.operatorName,
    productId: record.productId,
    productName: record.productName,
    kind: record.kind,
    providerAmount: Number(record.providerAmount),
    providerCurrency: record.providerCurrency,
    deliveredValue: record.deliveredValue == null ? undefined : Number(record.deliveredValue),
    deliveredCurrency: record.deliveredCurrency,
    feeUsd: Number(record.feeUsd),
    totalChargeUsd: Number(record.totalChargeUsd),
    testMode: record.testMode,
    expiresAt: record.expiresAt.toISOString(),
    consumedAt: record.consumedAt?.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}

function transactionFromDb(record: {
  receiverQuote?: Prisma.JsonValue | null;
  productSnapshot?: Prisma.JsonValue | null;
  provider?: MobileTopUpProviderName; providerProductId?: string | null;
  id: string; userId: string | null; flupFlapCustomerId?: string | null; recipientId: string | null; quoteId: string; providerTransactionId: string | null;
  operatorTransactionId: string | null; customIdentifier: string; idempotencyKey: string; requestHash: string;
  status: MobileTopUpStatus; paymentStatus: MobileTopUpPaymentStatus; paymentAuthorizationId: string | null;
  countryCode: string; recipientPhone: string; operatorId: number; operatorName: string; productId: string; productName: string;
  kind: MobileTopUpKind; providerAmount: Prisma.Decimal; providerCurrency: string; deliveredValue: Prisma.Decimal | null;
  deliveredCurrency: string; feeUsd: Prisma.Decimal; totalChargeUsd: Prisma.Decimal; providerStatus: string | null;
  failureCode: string | null; testMode: boolean; createdAt: Date; updatedAt: Date; deliveredAt: Date | null;
  failedAt: Date | null; refundedAt: Date | null; customerHiddenAt?: Date | null;
  paymentMethod?: MobileTopUpPaymentMethod | null; paymentProvider?: MobileTopUpPaymentProviderName | string | null;
  paymentEnvironment?: 'SANDBOX' | 'PRODUCTION' | null;
  rechargeEnvironment?: 'SANDBOX' | 'PRODUCTION' | null;
  paymentSessionId?: string | null; paymentProviderTransactionId?: string | null;
  checkoutResumeTokenHash?: string | null; checkoutResumeTokenExpiresAt?: Date | null;
  paymentStartedAt?: Date | null; fulfillmentStartedAt?: Date | null; recoveryStartedAt?: Date | null;
  receiverValueConfirmed?: boolean;
  receiverDiscrepancy?: boolean;
  receiverLanguage?: string | null;
  paymentRecoveryCode?: string | null;
}): MobileTopUpTransactionRecord {
  const paymentProvider = record.paymentProvider ?? undefined;
  return {
    id: record.id,
    provider: record.provider ?? decodeOperatorId(record.operatorId).provider,
    providerProductId: record.providerProductId ?? undefined,
    receiverQuote: record.receiverQuote ? record.receiverQuote as unknown as ReceiverQuote : undefined,
    productSnapshot: record.productSnapshot ? record.productSnapshot as unknown as MobileTopUpProduct : undefined,
    userId: ownerFromDb(record),
    quoteId: record.quoteId,
    recipientId: record.recipientId ?? undefined,
    providerTransactionId: record.providerTransactionId ?? undefined,
    operatorTransactionId: record.operatorTransactionId ?? undefined,
    customIdentifier: record.customIdentifier,
    idempotencyKey: record.idempotencyKey,
    requestHash: record.requestHash,
    status: record.status,
    paymentStatus: record.paymentStatus,
    paymentAuthorizationId: record.paymentAuthorizationId ?? undefined,
    paymentMethod: record.paymentMethod ?? undefined,
    paymentProvider: paymentProvider as MobileTopUpPaymentProviderName | undefined,
    paymentEnvironment: record.paymentEnvironment ?? 'SANDBOX',
    rechargeEnvironment: record.rechargeEnvironment ?? 'SANDBOX',
    paymentSessionId: record.paymentSessionId ?? undefined,
    paymentProviderTransactionId: record.paymentProviderTransactionId ?? undefined,
    checkoutResumeTokenHash: record.checkoutResumeTokenHash ?? undefined,
    checkoutResumeTokenExpiresAt: record.checkoutResumeTokenExpiresAt?.toISOString(),
    paymentStartedAt: record.paymentStartedAt?.toISOString(),
    fulfillmentStartedAt: record.fulfillmentStartedAt?.toISOString(),
    recoveryStartedAt: record.recoveryStartedAt?.toISOString(),
    receiverValueConfirmed: record.receiverValueConfirmed ?? false,
    receiverDiscrepancy: record.receiverDiscrepancy ?? false,
    receiverLanguage: record.receiverLanguage ?? undefined,
    paymentRecoveryCode: record.paymentRecoveryCode ?? undefined,
    countryCode: record.countryCode,
    recipientPhone: record.recipientPhone,
    operatorId: record.operatorId,
    operatorName: record.operatorName,
    productId: record.productId,
    productName: record.productName,
    kind: record.kind,
    providerAmount: Number(record.providerAmount),
    providerCurrency: record.providerCurrency,
    deliveredValue: record.receiverValueConfirmed && record.deliveredValue != null ? Number(record.deliveredValue) : undefined,
    deliveredCurrency: record.deliveredCurrency,
    feeUsd: Number(record.feeUsd),
    totalChargeUsd: Number(record.totalChargeUsd),
    providerStatus: record.providerStatus ?? undefined,
    failureCode: record.failureCode ?? undefined,
    testMode: record.testMode,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    deliveredAt: record.deliveredAt?.toISOString(),
    failedAt: record.failedAt?.toISOString(),
    refundedAt: record.refundedAt?.toISOString(),
    customerHiddenAt: record.customerHiddenAt?.toISOString(),
  };
}

export class PrismaMobileTopUpRepository implements MobileTopUpRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getCountryCatalogCache(key: string) {
    const record = await this.prisma.mobileTopUpCountryCatalogCache.findUnique({ where: { key } });
    if (!record) return undefined;
    return { value: record.countries, validatedAt: record.validatedAt.toISOString(), expiresAt: record.expiresAt.toISOString() };
  }

  async saveCountryCatalogCache(key: string, value: unknown, validatedAt: string, expiresAt: string) {
    const countries = JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
    await this.prisma.mobileTopUpCountryCatalogCache.upsert({
      where: { key },
      update: { countries, validatedAt: new Date(validatedAt), expiresAt: new Date(expiresAt) },
      create: { key, countries, validatedAt: new Date(validatedAt), expiresAt: new Date(expiresAt) },
    });
  }

  async listRetryableNotificationIds(limit: number) {
    const rows = await this.prisma.rechargeNotification.findMany({ where: { transaction: { status: 'DELIVERED', receiverValueConfirmed: true }, OR: [
      { status: 'PENDING', claimedAt: null },
      { status: 'FAILED', lastErrorCategory: { in: ['SMS_NOT_CONFIGURED', 'PROVIDER_REJECTED'] } },
    ] }, orderBy: { createdAt: 'asc' }, take: limit, select: { transactionId: true } });
    return rows.map(row => row.transactionId);
  }
  async getNotification(id: string): Promise<ReceiverNotification | undefined> {
    const row = await this.prisma.rechargeNotification.findUnique({ where: { transactionId: id } });
    if (!row) return undefined;
    return { ...row, amount: Number(row.amount), status: row.status as ReceiverNotification['status'],
      providerMessageId: row.providerMessageId ?? undefined, lastErrorCategory: row.lastErrorCategory ?? undefined,
      claimedAt: row.claimedAt?.toISOString(), createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      sentAt: row.sentAt?.toISOString(), deliveredAt: row.deliveredAt?.toISOString() };
  }
  async claimNotification(id: string, when: string) {
    const result = await this.prisma.rechargeNotification.updateMany({ where: { transactionId: id, transaction: { status: 'DELIVERED', receiverValueConfirmed: true }, OR: [
      { status: 'PENDING', claimedAt: null },
      { status: 'FAILED', lastErrorCategory: { in: ['SMS_NOT_CONFIGURED', 'PROVIDER_REJECTED'] } },
    ] }, data: { status: 'PENDING', claimedAt: new Date(when), attempts: { increment: 1 }, lastErrorCategory: null } });
    return result.count === 1;
  }
  async finishNotification(id: string, update: Parameters<ReceiverNotificationStore['finishNotification']>[1]) {
    await this.prisma.rechargeNotification.update({ where: { transactionId: id }, data: {
      ...update, lastErrorCategory: update.lastErrorCategory ?? null,
      sentAt: update.sentAt ? new Date(update.sentAt) : undefined,
      deliveredAt: update.deliveredAt ? new Date(update.deliveredAt) : undefined,
    } });
  }

  async getTransactionById(id: string) {
    const record = await this.prisma.mobileTopUpTransaction.findUnique({ where: { id } });
    return record ? transactionFromDb(record) : undefined;
  }

  async getTransactionByCheckoutResumeTokenHash(tokenHash: string) {
    const record = await this.prisma.mobileTopUpTransaction.findFirst({ where: { checkoutResumeTokenHash: tokenHash } });
    return record ? transactionFromDb(record) : undefined;
  }

  async listReconciliationCandidates(limit: number, staleBefore: string) {
    const records = await this.prisma.mobileTopUpTransaction.findMany({
      where: {
        OR: [
          { status: 'PROCESSING', paymentStatus: { in: ['AUTHORIZED', 'CAPTURED'] } },
          { paymentProvider: 'STRIPE', status: 'PENDING', paymentStatus: { in: ['PENDING', 'SESSION_CREATED'] } },
          { paymentStatus: { in: ['REFUND_PENDING', 'VOID_PENDING'] } },
        ],
        updatedAt: { lte: new Date(staleBefore) },
      },
      orderBy: { updatedAt: 'asc' },
      take: Math.max(0, Math.min(limit, 100)),
    });
    return records.map(transactionFromDb);
  }

  async claimOperation(id: string, operation: 'payment' | 'fulfillment' | 'recovery', when: string) {
    const where: Prisma.MobileTopUpTransactionWhereInput = { id, [operationField(operation)]: null };
    if (operation === 'payment') Object.assign(where, {
      OR: [
        { paymentProvider: 'MOCK', paymentStatus: { in: ['PENDING', 'SESSION_CREATED'] } },
        { paymentProvider: 'STRIPE', paymentStatus: 'PENDING' },
      ],
    });
    if (operation === 'fulfillment') Object.assign(where, {
      providerTransactionId: null, status: 'PENDING', OR: [
        { paymentProvider: 'MOCK', paymentStatus: { in: ['AUTHORIZED', 'CAPTURED'] } },
        { paymentProvider: 'STRIPE', paymentStatus: { in: ['AUTHORIZED', 'CAPTURED'] } },
      ],
    });
    if (operation === 'recovery') where.paymentStatus = { in: ['AUTHORIZED', 'CAPTURED'] };
    const result = await this.prisma.mobileTopUpTransaction.updateMany({ where, data: { [operationField(operation)]: new Date(when) } });
    return result.count === 1;
  }

  async transitionPayment(id: string, from: MobileTopUpPaymentStatus[], input: TransactionUpdate) {
    const transition = async (tx: Prisma.TransactionClient) => {
    const result = await tx.mobileTopUpTransaction.updateMany({
      where: { id, paymentStatus: { in: from }, ...(input.paymentProviderTransactionId ? { OR: [
        { paymentProviderTransactionId: null }, { paymentProviderTransactionId: input.paymentProviderTransactionId },
      ] } : {}) },
      data: transactionUpdateData(input),
    });
    if (result.count && marketingEnabled()) await reconcilePromotion(tx, id);
    return result.count === 1;
    };
    return marketingEnabled() ? this.prisma.$transaction(transition) : transition(this.prisma);
  }

  async registerPaymentEvent(eventId: string, payloadHash: string, transactionId: string) {
    const record = await this.prisma.mobileTopUpPaymentEvent.upsert({
      where: { provider_eventId: { provider: 'STRIPE', eventId } },
      create: { provider: 'STRIPE', eventId, payloadHash, transactionId }, update: {},
    });
    assertSameEvent(record, payloadHash, transactionId);
    return !record.processedAt;
  }
  async completePaymentEvent(eventId: string) {
    await this.prisma.mobileTopUpPaymentEvent.update({ where: { provider_eventId: { provider: 'STRIPE', eventId } }, data: { processedAt: new Date() } });
  }

  async listRecipients(userId: string) {
    const records = await this.prisma.mobileTopUpRecipient.findMany({ where: ownerWhere(userId), orderBy: { updatedAt: 'desc' } });
    return records.map((item) => ({
      ...item,
      language: item.language ?? undefined,
      userId: ownerFromDb(item),
      countryCode: item.countryCode,
      provider: item.provider ?? undefined,
      operatorId: item.operatorId ?? undefined,
      operatorName: item.operatorName ?? undefined,
      lastProductId: item.lastProductId ?? undefined,
      lastProductName: item.lastProductName ?? undefined,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    }));
  }

  async saveRecipient(input: Omit<SavedTopUpRecipientRecord, 'id' | 'createdAt' | 'updatedAt'>) {
    const record = await this.prisma.mobileTopUpRecipient.upsert({
      where: recipientOwnerKey(input.userId, input.phone, input.countryCode),
      update: { ...input, ...ownerData(input.userId) },
      create: { ...input, ...ownerData(input.userId) },
    });
    return {
      ...record,
      language: record.language ?? undefined,
      userId: ownerFromDb(record),
      countryCode: record.countryCode,
      provider: record.provider ?? undefined,
      operatorId: record.operatorId ?? undefined,
      operatorName: record.operatorName ?? undefined,
      lastProductId: record.lastProductId ?? undefined,
      lastProductName: record.lastProductName ?? undefined,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    };
  }

  async updateRecipientLastUsed(userId: string, id: string, productId: string, productName: string) {
    await this.prisma.mobileTopUpRecipient.updateMany({ where: { id, ...ownerWhere(userId) }, data: { lastProductId: productId, lastProductName: productName } });
  }

  async createQuote(input: Omit<MobileTopUpQuoteRecord, 'id' | 'createdAt'>) {
    const create = async (tx: Prisma.TransactionClient) => {
    const record = await tx.mobileTopUpQuote.create({ data: {
      ...input,
      ...ownerData(input.userId),
      receiverQuote: input.receiverQuote ? JSON.parse(JSON.stringify(input.receiverQuote)) as Prisma.InputJsonValue : undefined,
      productSnapshot: input.productSnapshot ? JSON.parse(JSON.stringify(input.productSnapshot)) as Prisma.InputJsonValue : undefined,
      provider: input.provider ?? decodeOperatorId(input.operatorId).provider,
      testMode: input.testMode,
      expiresAt: new Date(input.expiresAt),
      consumedAt: input.consumedAt ? new Date(input.consumedAt) : null,
    } });
    return quoteFromDb(marketingEnabled() ? await reserveQuotePromotion(tx, record, sandboxBenefitsEnabled()) : record);
    };
    return marketingEnabled() ? this.prisma.$transaction(create) : create(this.prisma);
  }

  async getQuote(userId: string, id: string) {
    const record = await this.prisma.mobileTopUpQuote.findFirst({ where: { id, ...ownerWhere(userId) } });
    return record ? quoteFromDb(record) : undefined;
  }

  async markQuoteConsumed(userId: string, id: string, when: string) {
    const result = await this.prisma.mobileTopUpQuote.updateMany({
      where: { id, ...ownerWhere(userId), consumedAt: null }, data: { consumedAt: new Date(when) },
    });
    if (result.count === 0) throw new MobileTopUpError('TOPUP_QUOTE_ALREADY_USED', 'Recharge quote was already submitted', 409);
  }

  async reserveTransaction(input: MobileTopUpTransactionRecord) {
    const existing = await this.prisma.mobileTopUpTransaction.findUnique({
      where: transactionOwnerKey(input.userId, input.idempotencyKey),
    });
    if (existing) return { record: transactionFromDb(existing), created: false };
    try {
      const record = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.mobileTopUpQuote.updateMany({
          where: { id: input.quoteId, ...ownerWhere(input.userId), consumedAt: null, expiresAt: { gt: new Date(input.createdAt) } },
          data: { consumedAt: new Date(input.createdAt) },
        });
        if (claimed.count !== 1) throw new MobileTopUpError('TOPUP_QUOTE_ALREADY_USED', 'Recharge quote is no longer available', 409);
        return tx.mobileTopUpTransaction.create({ data: {
          ...input,
      ...ownerData(input.userId),
          receiverQuote: input.receiverQuote ? JSON.parse(JSON.stringify(input.receiverQuote)) as Prisma.InputJsonValue : undefined,
      productSnapshot: input.productSnapshot ? JSON.parse(JSON.stringify(input.productSnapshot)) as Prisma.InputJsonValue : undefined,
          provider: input.provider ?? decodeOperatorId(input.operatorId).provider,
          testMode: input.testMode,
          paymentStartedAt: input.paymentStartedAt ? new Date(input.paymentStartedAt) : null,
          fulfillmentStartedAt: input.fulfillmentStartedAt ? new Date(input.fulfillmentStartedAt) : null,
          recoveryStartedAt: input.recoveryStartedAt ? new Date(input.recoveryStartedAt) : null,
          paymentEnvironment: input.paymentEnvironment,
          rechargeEnvironment: input.rechargeEnvironment,
          checkoutResumeTokenHash: input.checkoutResumeTokenHash ?? undefined,
          checkoutResumeTokenExpiresAt: input.checkoutResumeTokenExpiresAt ? new Date(input.checkoutResumeTokenExpiresAt) : null,
          recipientId: input.recipientId,
          countryCode: input.countryCode,
          deliveredAt: input.deliveredAt ? new Date(input.deliveredAt) : null,
          failedAt: input.failedAt ? new Date(input.failedAt) : null,
          refundedAt: input.refundedAt ? new Date(input.refundedAt) : null,
          createdAt: new Date(input.createdAt),
          updatedAt: new Date(input.updatedAt),
        } });
      });
      return { record: transactionFromDb(record), created: true };
    } catch (error) {
      if ((error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') ||
          (error instanceof MobileTopUpError && error.code === 'TOPUP_QUOTE_ALREADY_USED')) {
        const replay = await this.prisma.mobileTopUpTransaction.findUnique({ where: transactionOwnerKey(input.userId, input.idempotencyKey) });
        if (replay && ownerFromDb(replay) === input.userId && replay.idempotencyKey === input.idempotencyKey) {
          return { record: transactionFromDb(replay), created: false };
        }
        throw new MobileTopUpError('TOPUP_QUOTE_ALREADY_USED', 'Recharge quote was already submitted', 409);
      }
      throw error;
    }
  }

  async getTransaction(userId: string, id: string) {
    const record = await this.prisma.mobileTopUpTransaction.findFirst({ where: { id, ...ownerWhere(userId), customerHiddenAt: null } });
    return record ? transactionFromDb(record) : undefined;
  }

  async getTransactionByIdempotency(userId: string, key: string) {
    const record = await this.prisma.mobileTopUpTransaction.findUnique({
      where: transactionOwnerKey(userId, key),
    });
    return record ? transactionFromDb(record) : undefined;
  }

  async listFlupFlapTransactions(offset: number) {
    return (await this.prisma.mobileTopUpTransaction.findMany({where:{flupFlapCustomerId:{not:null}},orderBy:{createdAt:'desc'},skip:offset,take:100})).map(transactionFromDb);
  }
  async listTransactions(userId: string) {
    const records = await this.prisma.mobileTopUpTransaction.findMany({ where: { ...ownerWhere(userId), customerHiddenAt: null }, orderBy: { createdAt: 'desc' } });
    return records.map(transactionFromDb);
  }

  async hideTransactionFromCustomer(userId: string, id: string, when: string) {
    const result = await this.prisma.mobileTopUpTransaction.updateMany({
      where: { id, ...ownerWhere(userId), customerHiddenAt: null, status: 'FAILED', paymentStatus: 'FAILED', failureCode: 'CANCELLED_BY_CUSTOMER' },
      data: { customerHiddenAt: new Date(when) },
    });
    return result.count === 1;
  }

  async updateTransaction(id: string, input: TransactionUpdate) {
    return this.prisma.$transaction(async tx => {
      if (input.status === 'DELIVERED') {
        await tx.mobileTopUpTransaction.updateMany({ where: { id, OR: [{ deliveredAt: null }, { receiverValueConfirmed: false }] }, data: transactionUpdateData(input) });
      } else {
        await tx.mobileTopUpTransaction.update({ where: { id }, data: transactionUpdateData(input) });
      }
      const record = transactionFromDb(await tx.mobileTopUpTransaction.findUniqueOrThrow({ where: { id } }));
      if (marketingEnabled()) await reconcilePromotion(tx, id);
      const notification = notificationFor(record);
      if (notification) await tx.rechargeNotification.upsert({ where: { transactionId: id }, update: {}, create: {
        ...notification, createdAt: new Date(notification.createdAt), updatedAt: new Date(notification.updatedAt),
      } });
      return record;
    });
  }

  async postDeliveredLedger(record: MobileTopUpTransactionRecord) {
    const reference = `mobile-topup:${record.id}:delivered`;
    const keys = ledgerAccountKeys(record);
    await this.prisma.$transaction(async (tx) => {
      if (await tx.ledgerTransaction.findUnique({ where: { reference } })) return;
      const clearing = await tx.ledgerAccount.upsert({
        where: { key: keys.clearing },
        update: {},
        create: { key: keys.clearing, name: keys.clearingName, type: 'ASSET', currency: 'USD' },
      });
      const provider = await tx.ledgerAccount.upsert({
        where: { key: keys.providerSettlement },
        update: {},
        create: { key: keys.providerSettlement, name: keys.providerSettlementName, type: 'LIABILITY', currency: 'USD' },
      });
      const fee = await tx.ledgerAccount.upsert({
        where: { key: keys.feeRevenue },
        update: {},
        create: { key: keys.feeRevenue, name: keys.feeRevenueName, type: 'REVENUE', currency: 'USD' },
      });
      const transaction = await tx.ledgerTransaction.create({ data: { reference, type: 'MOBILE_TOPUP_DELIVERED' } });
      await tx.ledgerEntry.createMany({ data: [
        { transactionId: transaction.id, accountId: clearing.id, direction: 'DEBIT', amount: record.totalChargeUsd, currency: 'USD' },
        { transactionId: transaction.id, accountId: provider.id, direction: 'CREDIT', amount: record.providerAmount, currency: 'USD' },
        ...(record.feeUsd > 0 ? [{ transactionId: transaction.id, accountId: fee.id, direction: 'CREDIT' as const, amount: record.feeUsd, currency: 'USD' }] : []),
      ] });
    });
  }

  async postRefundLedger(record: MobileTopUpTransactionRecord) {
    const reference = `mobile-topup:${record.id}:refunded`;
    const keys = ledgerAccountKeys(record);
    await this.prisma.$transaction(async (tx) => {
      if (await tx.ledgerTransaction.findUnique({ where: { reference } })) return;
      if (!await tx.ledgerTransaction.findUnique({ where: { reference: `mobile-topup:${record.id}:delivered` } })) return;
      const clearing = await tx.ledgerAccount.findUniqueOrThrow({ where: { key: keys.clearing } });
      const provider = await tx.ledgerAccount.findUniqueOrThrow({ where: { key: keys.providerSettlement } });
      const fee = await tx.ledgerAccount.findUniqueOrThrow({ where: { key: keys.feeRevenue } });
      const transaction = await tx.ledgerTransaction.create({ data: { reference, type: 'MOBILE_TOPUP_REFUNDED' } });
      await tx.ledgerEntry.createMany({ data: [
        { transactionId: transaction.id, accountId: clearing.id, direction: 'CREDIT', amount: record.totalChargeUsd, currency: 'USD' },
        { transactionId: transaction.id, accountId: provider.id, direction: 'DEBIT', amount: record.providerAmount, currency: 'USD' },
        ...(record.feeUsd > 0 ? [{ transactionId: transaction.id, accountId: fee.id, direction: 'DEBIT' as const, amount: record.feeUsd, currency: 'USD' }] : []),
      ] });
    });
  }
}

function ledgerAccountKeys(record: MobileTopUpTransactionRecord) {
  const sandbox = record.rechargeEnvironment === 'SANDBOX';
  return sandbox
    ? {
      clearing: 'TOPUP_TEST_PAYMENT_CLEARING_USD',
      clearingName: 'Mobile recharge test payment clearing',
      providerSettlement: 'TOPUP_PROVIDER_SETTLEMENT_USD',
      providerSettlementName: 'Mobile recharge provider settlement',
      feeRevenue: 'TOPUP_FEE_REVENUE_USD',
      feeRevenueName: 'Mobile recharge fees',
    }
    : {
      clearing: 'TOPUP_PRODUCTION_PAYMENT_CLEARING_USD',
      clearingName: 'Mobile recharge production payment clearing',
      providerSettlement: 'TOPUP_PRODUCTION_PROVIDER_SETTLEMENT_USD',
      providerSettlementName: 'Mobile recharge production provider settlement',
      feeRevenue: 'TOPUP_PRODUCTION_FEE_REVENUE_USD',
      feeRevenueName: 'Mobile recharge production fees',
    };
}

function operationField(operation: 'payment' | 'fulfillment' | 'recovery') {
  return ({ payment: 'paymentStartedAt', fulfillment: 'fulfillmentStartedAt', recovery: 'recoveryStartedAt' } as const)[operation];
}
function paid(record: MobileTopUpTransactionRecord) {
  return record.paymentProvider === 'STRIPE'
    ? ['AUTHORIZED', 'CAPTURED'].includes(record.paymentStatus)
    : record.paymentProvider === 'MOCK' && ['AUTHORIZED', 'CAPTURED'].includes(record.paymentStatus);
}
function assertSameEvent(record: { payloadHash: string; transactionId: string }, hash: string, transactionId: string) {
  if (record.payloadHash !== hash || record.transactionId !== transactionId) {
    throw new MobileTopUpError('PAYMENT_EVENT_CONFLICT', 'Payment event identity conflict', 409);
  }
}
function transactionUpdateData(input: TransactionUpdate): Prisma.MobileTopUpTransactionUpdateManyMutationInput {
  const data = { ...input } as Record<string, unknown>;
  if (data.deliveredAt) data.deliveredAt = new Date(String(data.deliveredAt));
  if (data.failedAt) data.failedAt = new Date(String(data.failedAt));
  if (data.refundedAt) data.refundedAt = new Date(String(data.refundedAt));
  if (data.customerHiddenAt) data.customerHiddenAt = new Date(String(data.customerHiddenAt));
  return data as Prisma.MobileTopUpTransactionUpdateManyMutationInput;
}
