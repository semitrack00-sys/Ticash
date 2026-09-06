import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { FundingSourceStatus, FundingStatus } from './types.js';
import { FundingError } from './types.js';

export interface FundingCustomerRecord {
  id: string;
  userId: string;
  providerCustomerId: string;
  providerCustomerUrl: string;
  status: string;
}

export interface FundingSourceRecord {
  id: string;
  userId: string;
  providerCustomerId: string;
  providerFundingSourceId: string;
  providerFundingSourceUrl: string;
  name: string;
  bankName?: string;
  lastFour: string;
  bankAccountType: string;
  status: FundingSourceStatus;
  isDefault: boolean;
  microDepositsInitiatedAt?: string;
  verificationAttempts: number;
  verificationFailureCode?: string;
  removedAt?: string;
  createdAt: string;
  updatedAt: string;
}

type NewFundingSourceRecord = Omit<FundingSourceRecord, 'id' | 'createdAt' | 'updatedAt'>;
type FundingSourceUpdate = Partial<Pick<FundingSourceRecord,
  'name' | 'bankName' | 'bankAccountType' | 'status' | 'isDefault' |
  'microDepositsInitiatedAt' | 'verificationAttempts' | 'verificationFailureCode' | 'removedAt'>>;

export interface FundingTransactionRecord {
  id: string;
  userId: string;
  fundingSourceId: string;
  transferId?: string;
  amount: number;
  currency: 'USD';
  status: FundingStatus;
  idempotencyKey: string;
  requestHash: string;
  providerTransferId?: string;
  providerTransferUrl?: string;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
}

export interface WebhookReservation {
  duplicate: boolean;
  eventId: string;
}

export interface FundingRepository {
  getCustomer(userId: string): Promise<FundingCustomerRecord | undefined>;
  saveCustomer(input: Omit<FundingCustomerRecord, 'id'>): Promise<FundingCustomerRecord>;
  listSources(userId: string): Promise<FundingSourceRecord[]>;
  getSource(userId: string, id: string): Promise<FundingSourceRecord | undefined>;
  saveSource(input: NewFundingSourceRecord): Promise<FundingSourceRecord>;
  updateSource(userId: string, id: string, input: FundingSourceUpdate): Promise<FundingSourceRecord>;
  getSourceByProviderId(providerFundingSourceId: string): Promise<FundingSourceRecord | undefined>;
  setDefaultSource(userId: string, id: string): Promise<FundingSourceRecord>;
  hasActiveTransactions(fundingSourceId: string): Promise<boolean>;
  reserveTransaction(input: {
    id: string;
    userId: string;
    fundingSourceId: string;
    transferId?: string;
    amount: number;
    idempotencyKey: string;
    requestHash: string;
  }): Promise<{ record: FundingTransactionRecord; created: boolean }>;
  attachProviderTransfer(
    id: string,
    providerTransferId: string,
    providerTransferUrl: string,
    status: FundingStatus,
  ): Promise<FundingTransactionRecord>;
  getTransaction(userId: string, id: string): Promise<FundingTransactionRecord | undefined>;
  getTransactionByProviderId(providerTransferId: string): Promise<FundingTransactionRecord | undefined>;
  applyProviderStatus(id: string, status: FundingStatus, failureCode?: string): Promise<FundingTransactionRecord>;
  reserveWebhook(providerEventId: string, topic: string, payloadHash: string): Promise<WebhookReservation>;
  completeWebhook(eventId: string): Promise<void>;
  failWebhook(eventId: string, errorCode: string): Promise<void>;
  walletBalance(userId: string): Promise<number>;
  reserveWalletForTransfer(userId: string, transferId: string, amount: number): Promise<void>;
  releaseWalletForTransfer(userId: string, transferId: string, amount: number): Promise<void>;
  reset?(): void;
}

function nowIso(): string {
  return new Date().toISOString();
}

const memoryCustomers = new Map<string, FundingCustomerRecord>();
const memorySources = new Map<string, FundingSourceRecord>();
const memoryTransactions = new Map<string, FundingTransactionRecord>();
const memoryWebhookEvents = new Map<string, {
  id: string;
  topic: string;
  payloadHash: string;
  status: string;
  errorCode?: string;
}>();
const memoryLedgerReferences = new Set<string>();
const memoryWalletBalances = new Map<string, number>();

export function resetFundingStore(): void {
  memoryCustomers.clear();
  memorySources.clear();
  memoryTransactions.clear();
  memoryWebhookEvents.clear();
  memoryLedgerReferences.clear();
  memoryWalletBalances.clear();
}

export class MemoryFundingRepository implements FundingRepository {
  async getCustomer(userId: string) {
    return memoryCustomers.get(userId);
  }

  async saveCustomer(input: Omit<FundingCustomerRecord, 'id'>) {
    const record = { id: memoryCustomers.get(input.userId)?.id ?? randomUUID(), ...input };
    memoryCustomers.set(input.userId, record);
    return record;
  }

  async listSources(userId: string) {
    return [...memorySources.values()].filter((source) => source.userId === userId && source.status !== 'REMOVED');
  }

  async getSource(userId: string, id: string) {
    const source = memorySources.get(id);
    return source?.userId === userId ? source : undefined;
  }

  async saveSource(input: NewFundingSourceRecord) {
    const existing = [...memorySources.values()].find(
      (source) => source.providerFundingSourceId === input.providerFundingSourceId,
    );
    const timestamp = nowIso();
    const record: FundingSourceRecord = {
      id: existing?.id ?? randomUUID(),
      ...input,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    memorySources.set(record.id, record);
    return record;
  }

  async updateSource(userId: string, id: string, input: FundingSourceUpdate) {
    const source = memorySources.get(id);
    if (!source || source.userId !== userId) {
      throw new FundingError('FUNDING_SOURCE_NOT_FOUND', 'Funding source was not found', 404);
    }
    const updated = { ...source, ...input, updatedAt: nowIso() };
    memorySources.set(id, updated);
    return updated;
  }

  async getSourceByProviderId(providerFundingSourceId: string) {
    return [...memorySources.values()].find(
      (source) => source.providerFundingSourceId === providerFundingSourceId,
    );
  }

  async setDefaultSource(userId: string, id: string) {
    const source = await this.getSource(userId, id);
    if (!source) throw new FundingError('FUNDING_SOURCE_NOT_FOUND', 'Funding source was not found', 404);
    for (const [sourceId, item] of memorySources) {
      if (item.userId === userId) {
        memorySources.set(sourceId, { ...item, isDefault: sourceId === id, updatedAt: nowIso() });
      }
    }
    return memorySources.get(id)!;
  }

  async hasActiveTransactions(fundingSourceId: string) {
    return [...memoryTransactions.values()].some(
      (item) => item.fundingSourceId === fundingSourceId && ['PENDING', 'PROCESSING'].includes(item.status),
    );
  }

  async reserveTransaction(input: {
    id: string; userId: string; fundingSourceId: string; amount: number;
    idempotencyKey: string; requestHash: string; transferId?: string;
  }) {
    const existing = [...memoryTransactions.values()].find(
      (item) => item.userId === input.userId && item.idempotencyKey === input.idempotencyKey,
    );
    if (existing) return { record: existing, created: false };
    const timestamp = nowIso();
    const record: FundingTransactionRecord = {
      ...input,
      currency: 'USD',
      status: 'PENDING',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    memoryTransactions.set(record.id, record);
    return { record, created: true };
  }

  async attachProviderTransfer(
    id: string,
    providerTransferId: string,
    providerTransferUrl: string,
    status: FundingStatus,
  ) {
    const record = memoryTransactions.get(id);
    if (!record) throw new FundingError('FUNDING_NOT_FOUND', 'Funding transaction was not found', 404);
    const updated = { ...record, providerTransferId, providerTransferUrl, status, updatedAt: nowIso() };
    memoryTransactions.set(id, updated);
    return updated;
  }

  async getTransaction(userId: string, id: string) {
    const record = memoryTransactions.get(id);
    return record?.userId === userId ? record : undefined;
  }

  async getTransactionByProviderId(providerTransferId: string) {
    return [...memoryTransactions.values()].find((item) => item.providerTransferId === providerTransferId);
  }

  async applyProviderStatus(id: string, status: FundingStatus, failureCode?: string) {
    const record = memoryTransactions.get(id);
    if (!record) throw new FundingError('FUNDING_NOT_FOUND', 'Funding transaction was not found', 404);
    const settledReference = `dwolla-funding:${id}:settled`;
    const reversedReference = `dwolla-funding:${id}:reversed`;
    let effectiveStatus = status;
    if (record.status === 'REVERSED' ||
        (record.status === 'COMPLETED' && status !== 'FAILED' && status !== 'REVERSED') ||
        ((record.status === 'FAILED' || record.status === 'CANCELLED') && status !== 'REVERSED')) {
      effectiveStatus = record.status;
    }
    if ((status === 'FAILED' || status === 'REVERSED') && memoryLedgerReferences.has(settledReference)) {
      effectiveStatus = 'REVERSED';
    }
    if (effectiveStatus === 'COMPLETED' && !memoryLedgerReferences.has(settledReference)) {
      memoryLedgerReferences.add(settledReference);
      memoryWalletBalances.set(record.userId, (memoryWalletBalances.get(record.userId) ?? 0) + record.amount);
    }
    if (effectiveStatus === 'REVERSED' && !memoryLedgerReferences.has(reversedReference)) {
      memoryLedgerReferences.add(reversedReference);
      if (memoryLedgerReferences.has(settledReference)) {
        memoryWalletBalances.set(record.userId, (memoryWalletBalances.get(record.userId) ?? 0) - record.amount);
      }
    }
    const timestamp = nowIso();
    const updated: FundingTransactionRecord = {
      ...record,
      status: effectiveStatus,
      failureCode,
      updatedAt: timestamp,
    };
    memoryTransactions.set(id, updated);
    return updated;
  }

  async reserveWebhook(providerEventId: string, topic: string, payloadHash: string) {
    const existing = memoryWebhookEvents.get(providerEventId);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new FundingError(
          'WEBHOOK_EVENT_CONFLICT',
          'A Dwolla event ID was reused with a different payload',
          409,
        );
      }
      if (existing.status === 'FAILED') {
        memoryWebhookEvents.set(providerEventId, {
          ...existing,
          status: 'PROCESSING',
          errorCode: undefined,
        });
        return { duplicate: false, eventId: existing.id };
      }
      return { duplicate: true, eventId: existing.id };
    }
    const event = { id: randomUUID(), topic, payloadHash, status: 'PROCESSING' };
    memoryWebhookEvents.set(providerEventId, event);
    return { duplicate: false, eventId: event.id };
  }

  async completeWebhook(eventId: string) {
    for (const [providerEventId, event] of memoryWebhookEvents) {
      if (event.id === eventId) memoryWebhookEvents.set(providerEventId, { ...event, status: 'PROCESSED' });
    }
  }

  async failWebhook(eventId: string, errorCode: string) {
    for (const [providerEventId, event] of memoryWebhookEvents) {
      if (event.id === eventId) {
        memoryWebhookEvents.set(providerEventId, { ...event, status: 'FAILED', errorCode });
      }
    }
  }

  async walletBalance(userId: string) {
    return memoryWalletBalances.get(userId) ?? 0;
  }

  async reserveWalletForTransfer(userId: string, transferId: string, amount: number) {
    const reference = `remittance:${transferId}:reserved`;
    if (memoryLedgerReferences.has(reference)) return;
    const available = memoryWalletBalances.get(userId) ?? 0;
    if (available + 0.0001 < amount) throw new FundingError('INSUFFICIENT_FUNDS', 'Confirmed funding is insufficient', 409);
    memoryLedgerReferences.add(reference);
    memoryWalletBalances.set(userId, available - amount);
  }

  async releaseWalletForTransfer(userId: string, transferId: string, amount: number) {
    const reserveReference = `remittance:${transferId}:reserved`;
    const releaseReference = `remittance:${transferId}:released`;
    if (!memoryLedgerReferences.has(reserveReference) || memoryLedgerReferences.has(releaseReference)) return;
    memoryLedgerReferences.add(releaseReference);
    memoryWalletBalances.set(userId, (memoryWalletBalances.get(userId) ?? 0) + amount);
  }

  reset() {
    resetFundingStore();
  }
}

function transactionFromDb(row: {
  id: string; userId: string; fundingSourceId: string; transferId: string | null; amount: unknown; currency: string;
  status: string; idempotencyKey: string; requestHash: string; providerTransferId: string | null;
  providerTransferUrl: string | null; failureCode: string | null; createdAt: Date; updatedAt: Date;
}): FundingTransactionRecord {
  return {
    id: row.id,
    userId: row.userId,
    fundingSourceId: row.fundingSourceId,
    transferId: row.transferId ?? undefined,
    amount: Number(row.amount),
    currency: 'USD',
    status: row.status as FundingStatus,
    idempotencyKey: row.idempotencyKey,
    requestHash: row.requestHash,
    providerTransferId: row.providerTransferId ?? undefined,
    providerTransferUrl: row.providerTransferUrl ?? undefined,
    failureCode: row.failureCode ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function sourceFromDb(row: {
  id: string; userId: string; providerCustomerId: string; providerFundingSourceId: string;
  providerFundingSourceUrl: string; name: string; bankName: string | null; lastFour: string;
  bankAccountType: string; status: string; isDefault: boolean; microDepositsInitiatedAt: Date | null;
  verificationAttempts: number; verificationFailureCode: string | null; removedAt: Date | null;
  createdAt: Date; updatedAt: Date;
}): FundingSourceRecord {
  return {
    id: row.id,
    userId: row.userId,
    providerCustomerId: row.providerCustomerId,
    providerFundingSourceId: row.providerFundingSourceId,
    providerFundingSourceUrl: row.providerFundingSourceUrl,
    name: row.name,
    bankName: row.bankName ?? undefined,
    lastFour: row.lastFour,
    bankAccountType: row.bankAccountType,
    status: row.status as FundingSourceStatus,
    isDefault: row.isDefault,
    microDepositsInitiatedAt: row.microDepositsInitiatedAt?.toISOString(),
    verificationAttempts: row.verificationAttempts,
    verificationFailureCode: row.verificationFailureCode ?? undefined,
    removedAt: row.removedAt?.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class PrismaFundingRepository implements FundingRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async getCustomer(userId: string) {
    const row = await this.prisma.fundingProviderCustomer.findUnique({
      where: { userId_provider: { userId, provider: 'DWOLLA' } },
    });
    return row ? {
      id: row.id, userId: row.userId, providerCustomerId: row.providerCustomerId,
      providerCustomerUrl: row.providerCustomerUrl, status: row.status,
    } : undefined;
  }

  async saveCustomer(input: Omit<FundingCustomerRecord, 'id'>) {
    const row = await this.prisma.fundingProviderCustomer.upsert({
      where: { userId_provider: { userId: input.userId, provider: 'DWOLLA' } },
      update: {
        providerCustomerId: input.providerCustomerId,
        providerCustomerUrl: input.providerCustomerUrl,
        status: input.status,
      },
      create: { ...input, provider: 'DWOLLA' },
    });
    return {
      id: row.id, userId: row.userId, providerCustomerId: row.providerCustomerId,
      providerCustomerUrl: row.providerCustomerUrl, status: row.status,
    };
  }

  async listSources(userId: string) {
    return (await this.prisma.fundingSource.findMany({
      where: { userId, provider: 'DWOLLA', status: { not: 'REMOVED' } },
      orderBy: { createdAt: 'desc' },
    })).map(sourceFromDb);
  }

  async getSource(userId: string, id: string) {
    const row = await this.prisma.fundingSource.findFirst({ where: { id, userId, provider: 'DWOLLA' } });
    return row ? sourceFromDb(row) : undefined;
  }

  async saveSource(input: NewFundingSourceRecord) {
    const row = await this.prisma.fundingSource.upsert({
      where: {
        provider_providerFundingSourceId: {
          provider: 'DWOLLA',
          providerFundingSourceId: input.providerFundingSourceId,
        },
      },
      update: {
        name: input.name,
        lastFour: input.lastFour,
        bankName: input.bankName,
        bankAccountType: input.bankAccountType,
        status: input.status,
        isDefault: input.isDefault,
        microDepositsInitiatedAt: input.microDepositsInitiatedAt
          ? new Date(input.microDepositsInitiatedAt)
          : null,
        verificationAttempts: input.verificationAttempts,
        verificationFailureCode: input.verificationFailureCode,
        removedAt: input.removedAt ? new Date(input.removedAt) : null,
      },
      create: {
        ...input,
        provider: 'DWOLLA',
        microDepositsInitiatedAt: input.microDepositsInitiatedAt
          ? new Date(input.microDepositsInitiatedAt)
          : undefined,
        removedAt: input.removedAt ? new Date(input.removedAt) : undefined,
      },
    });
    return sourceFromDb(row);
  }

  async updateSource(userId: string, id: string, input: FundingSourceUpdate) {
    const source = await this.prisma.fundingSource.findFirst({ where: { id, userId, provider: 'DWOLLA' } });
    if (!source) throw new FundingError('FUNDING_SOURCE_NOT_FOUND', 'Funding source was not found', 404);
    return sourceFromDb(await this.prisma.fundingSource.update({
      where: { id },
      data: {
        ...input,
        microDepositsInitiatedAt: input.microDepositsInitiatedAt === undefined
          ? undefined
          : new Date(input.microDepositsInitiatedAt),
        removedAt: input.removedAt === undefined ? undefined : new Date(input.removedAt),
      },
    }));
  }

  async getSourceByProviderId(providerFundingSourceId: string) {
    const row = await this.prisma.fundingSource.findFirst({
      where: { provider: 'DWOLLA', providerFundingSourceId },
    });
    return row ? sourceFromDb(row) : undefined;
  }

  async setDefaultSource(userId: string, id: string) {
    return this.prisma.$transaction(async (transaction) => {
      const source = await transaction.fundingSource.findFirst({
        where: { id, userId, provider: 'DWOLLA' },
      });
      if (!source) throw new FundingError('FUNDING_SOURCE_NOT_FOUND', 'Funding source was not found', 404);
      await transaction.fundingSource.updateMany({
        where: { userId, provider: 'DWOLLA' },
        data: { isDefault: false },
      });
      return sourceFromDb(await transaction.fundingSource.update({
        where: { id },
        data: { isDefault: true },
      }));
    });
  }

  async hasActiveTransactions(fundingSourceId: string) {
    return (await this.prisma.fundingTransaction.count({
      where: { fundingSourceId, status: { in: ['PENDING', 'PROCESSING'] } },
    })) > 0;
  }

  async reserveTransaction(input: {
    id: string; userId: string; fundingSourceId: string; amount: number;
    idempotencyKey: string; requestHash: string; transferId?: string;
  }) {
    try {
      const row = await this.prisma.fundingTransaction.create({
        data: { ...input, currency: 'USD', provider: 'DWOLLA' },
      });
      return { record: transactionFromDb(row), created: true };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const row = await this.prisma.fundingTransaction.findUnique({
        where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
      });
      if (!row) throw error;
      return { record: transactionFromDb(row), created: false };
    }
  }

  async attachProviderTransfer(
    id: string,
    providerTransferId: string,
    providerTransferUrl: string,
    status: FundingStatus,
  ) {
    return transactionFromDb(await this.prisma.fundingTransaction.update({
      where: { id },
      data: { providerTransferId, providerTransferUrl, status },
    }));
  }

  async getTransaction(userId: string, id: string) {
    const row = await this.prisma.fundingTransaction.findFirst({ where: { id, userId } });
    return row ? transactionFromDb(row) : undefined;
  }

  async getTransactionByProviderId(providerTransferId: string) {
    const row = await this.prisma.fundingTransaction.findFirst({
      where: { provider: 'DWOLLA', providerTransferId },
    });
    return row ? transactionFromDb(row) : undefined;
  }

  async applyProviderStatus(id: string, status: FundingStatus, failureCode?: string) {
    const row = await this.prisma.$transaction(async (transaction) => {
      const funding = await transaction.fundingTransaction.findUnique({ where: { id } });
      if (!funding) throw new FundingError('FUNDING_NOT_FOUND', 'Funding transaction was not found', 404);

      const settled = await transaction.ledgerTransaction.findUnique({
        where: { reference: `dwolla-funding:${funding.id}:settled` },
      });
      let effectiveStatus: FundingStatus = status;
      if (funding.status === 'REVERSED' ||
          (funding.status === 'COMPLETED' && status !== 'FAILED' && status !== 'REVERSED') ||
          ((funding.status === 'FAILED' || funding.status === 'CANCELLED') && status !== 'REVERSED')) {
        effectiveStatus = funding.status as FundingStatus;
      }
      if ((status === 'FAILED' || status === 'REVERSED') && settled) {
        effectiveStatus = 'REVERSED';
      }

      if (effectiveStatus === 'COMPLETED') {
        await this.postLedgerTransaction(transaction, funding.userId, funding.id, funding.amount, 'settled');
      } else if (effectiveStatus === 'REVERSED') {
        if (settled) {
          await this.postLedgerTransaction(transaction, funding.userId, funding.id, funding.amount, 'reversed');
        }
      }

      return transaction.fundingTransaction.update({
        where: { id },
        data: {
          status: effectiveStatus,
          failureCode,
          completedAt: effectiveStatus === 'COMPLETED' ? new Date() : funding.completedAt,
          cancelledAt: effectiveStatus === 'CANCELLED' ? new Date() : funding.cancelledAt,
          reversedAt: effectiveStatus === 'REVERSED' ? new Date() : funding.reversedAt,
        },
      });
    });
    return transactionFromDb(row);
  }

  private async postLedgerTransaction(
    transaction: Prisma.TransactionClient,
    userId: string,
    fundingTransactionId: string,
    amount: Prisma.Decimal,
    kind: 'settled' | 'reversed',
  ) {
    const reference = `dwolla-funding:${fundingTransactionId}:${kind}`;
    const existing = await transaction.ledgerTransaction.findUnique({ where: { reference } });
    if (existing) return;
    const clearing = await transaction.ledgerAccount.upsert({
      where: { key: 'DWOLLA_CLEARING_USD' },
      update: {},
      create: { key: 'DWOLLA_CLEARING_USD', name: 'Dwolla clearing', type: 'ASSET', currency: 'USD' },
    });
    const wallet = await transaction.ledgerAccount.upsert({
      where: { key: `USER_WALLET_USD:${userId}` },
      update: {},
      create: {
        key: `USER_WALLET_USD:${userId}`, name: 'User USD wallet', type: 'LIABILITY', currency: 'USD', userId,
      },
    });
    await transaction.ledgerTransaction.create({
      data: {
        reference,
        type: kind === 'settled' ? 'ACH_FUNDING_SETTLED' : 'ACH_FUNDING_REVERSED',
        fundingTransactionId,
        entries: {
          create: kind === 'settled'
            ? [
                { accountId: clearing.id, direction: 'DEBIT', amount, currency: 'USD' },
                { accountId: wallet.id, direction: 'CREDIT', amount, currency: 'USD' },
              ]
            : [
                { accountId: wallet.id, direction: 'DEBIT', amount, currency: 'USD' },
                { accountId: clearing.id, direction: 'CREDIT', amount, currency: 'USD' },
              ],
        },
      },
    });
  }

  async reserveWebhook(providerEventId: string, topic: string, payloadHash: string) {
    try {
      const row = await this.prisma.providerWebhookEvent.create({
        data: { provider: 'DWOLLA', providerEventId, topic, payloadHash },
      });
      return { duplicate: false, eventId: row.id };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
      const row = await this.prisma.providerWebhookEvent.findUnique({
        where: { provider_providerEventId: { provider: 'DWOLLA', providerEventId } },
      });
      if (!row) throw error;
      await this.prisma.providerWebhookEvent.update({
        where: { id: row.id },
        data: {
          duplicateDeliveryCount: { increment: 1 },
          lastReceivedAt: new Date(),
        },
      });
      if (row.payloadHash !== payloadHash) {
        throw new FundingError(
          'WEBHOOK_EVENT_CONFLICT',
          'A Dwolla event ID was reused with a different payload',
          409,
        );
      }
      if (row.status === 'FAILED') {
        const claimed = await this.prisma.providerWebhookEvent.updateMany({
          where: { id: row.id, status: 'FAILED' },
          data: { status: 'PROCESSING', errorCode: null },
        });
        if (claimed.count === 1) return { duplicate: false, eventId: row.id };
      }
      return { duplicate: true, eventId: row.id };
    }
  }

  async completeWebhook(eventId: string) {
    await this.prisma.providerWebhookEvent.update({
      where: { id: eventId },
      data: { status: 'PROCESSED', processedAt: new Date(), errorCode: null },
    });
  }

  async failWebhook(eventId: string, errorCode: string) {
    await this.prisma.providerWebhookEvent.update({
      where: { id: eventId },
      data: { status: 'FAILED', errorCode: errorCode.slice(0, 100) },
    });
  }

  async walletBalance(userId: string) {
    const account = await this.prisma.ledgerAccount.findUnique({
      where: { key: `USER_WALLET_USD:${userId}` },
      include: { entries: true },
    });
    if (!account) return 0;
    return account.entries.reduce(
      (balance, entry) => balance + (entry.direction === 'CREDIT' ? Number(entry.amount) : -Number(entry.amount)),
      0,
    );
  }

  async reserveWalletForTransfer(userId: string, transferId: string, amount: number) {
    await this.postRemittanceLedger(userId, transferId, amount, 'reserved');
  }

  async releaseWalletForTransfer(userId: string, transferId: string, amount: number) {
    await this.postRemittanceLedger(userId, transferId, amount, 'released');
  }

  private async postRemittanceLedger(userId: string, transferId: string, rawAmount: number, kind: 'reserved' | 'released') {
    await this.prisma.$transaction(async (transaction) => {
      const reference = `remittance:${transferId}:${kind}`;
      if (await transaction.ledgerTransaction.findUnique({ where: { reference } })) return;
      const reserved = await transaction.ledgerTransaction.findUnique({ where: { reference: `remittance:${transferId}:reserved` } });
      if (kind === 'released' && !reserved) return;
      const wallet = await transaction.ledgerAccount.upsert({
        where: { key: `USER_WALLET_USD:${userId}` }, update: {},
        create: { key: `USER_WALLET_USD:${userId}`, name: 'User USD wallet', type: 'LIABILITY', currency: 'USD', userId },
      });
      const clearing = await transaction.ledgerAccount.upsert({
        where: { key: 'REMITTANCE_CLEARING_USD' }, update: {},
        create: { key: 'REMITTANCE_CLEARING_USD', name: 'Remittance clearing', type: 'ASSET', currency: 'USD' },
      });
      const amount = new Prisma.Decimal(rawAmount);
      await transaction.ledgerTransaction.create({
        data: {
          reference, type: kind === 'reserved' ? 'REMITTANCE_FUNDS_RESERVED' : 'REMITTANCE_FUNDS_RELEASED',
          entries: { create: kind === 'reserved'
            ? [{ accountId: wallet.id, direction: 'DEBIT', amount, currency: 'USD' }, { accountId: clearing.id, direction: 'CREDIT', amount, currency: 'USD' }]
            : [{ accountId: clearing.id, direction: 'DEBIT', amount, currency: 'USD' }, { accountId: wallet.id, direction: 'CREDIT', amount, currency: 'USD' }] },
        },
      });
    });
  }
}
