import { Prisma, type PrismaClient } from '@prisma/client';
import { MobileTopUpError, type MobileTopUpTransactionRecord } from '../topup/types.js';
import { flupFlapCustomerId } from './owner.js';
import { storeApplication, storeBalanceReturn, storeCommission, storeCountries, storeFunding, storeLaunchCountries, storeReview } from './store-policy.js';

type Tx = Prisma.TransactionClient;
export interface StoreBalancePayment {
  authorize(record: MobileTopUpTransactionRecord): Promise<void>;
  delivered(record: MobileTopUpTransactionRecord): Promise<void>;
  refund(record: MobileTopUpTransactionRecord): Promise<void>;
}
const fail = (code: string, status = 409): never => { throw new MobileTopUpError(code, code.replaceAll('_', ' ').toLowerCase(), status); };
const cents = (value: number) => {
  const result = Math.round(value * 100);
  if (!Number.isSafeInteger(result) || result < 0 || result > 1_000_000 || Math.abs(value * 100 - result) > 0.00001) fail('INVALID_STORE_AMOUNT');
  return result;
};

export class FlupFlapStores implements StoreBalancePayment {
  constructor(private readonly db: PrismaClient, private readonly countries = storeLaunchCountries(), readonly testMode = false) {}

  private async atomic<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.db.$transaction(run, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (attempt < 3 && error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) continue;
        throw error;
      }
    }
  }

  private async lock(tx: Tx, id: string) {
    await tx.$queryRaw`SELECT id FROM "FlupFlapStore" WHERE id = ${id} FOR UPDATE`;
    return tx.flupFlapStore.findUniqueOrThrow({ where: { id } });
  }

  private async active(tx: Tx, owner: string) {
    const customerId = flupFlapCustomerId(owner);
    if (!customerId) fail('STORE_ACCOUNT_REQUIRED', 403);
    // Same lock order as account deletion; authorization is rechecked inside the money transaction.
    await tx.$queryRaw`SELECT id FROM "FlupFlapCustomer" WHERE id = ${customerId} FOR UPDATE`;
    const customer = await tx.flupFlapCustomer.findUnique({ where: { id: customerId! } });
    if (!customer || customer.guestExpiresAt || customer.status !== 'ACTIVE' || customer.rechargeRestricted) fail('STORE_ACCOUNT_RESTRICTED', 403);
    const store = await tx.flupFlapStore.findUnique({ where: { customerId_testMode: { customerId: customerId!, testMode: this.testMode } } });
    if (!store) fail('STORE_ACCOUNT_REQUIRED', 403);
    const current = await this.lock(tx, store!.id);
    if (current.status !== 'ACTIVE' || !this.countries.has(current.country)) fail('STORE_NOT_ACTIVE', 403);
    return current;
  }

  private async movement(tx: Tx, storeId: string, reference: string, kind: string, amountCents: number) {
    const store = await tx.flupFlapStore.update({ where: { id: storeId }, data: { balanceCents: { increment: amountCents } } });
    await tx.flupFlapStoreEntry.create({ data: { storeId, reference, kind, amountCents, balanceAfterCents: store.balanceCents } });
  }

  // Balanced USD journal. Store deposits never enter the card-clearing ledger.
  private async journal(tx: Tx, reference: string, lines: [string, 'ASSET' | 'LIABILITY' | 'REVENUE', number][]) {
    if (lines.reduce((total, line) => total + line[2], 0) !== 0) fail('UNBALANCED_STORE_JOURNAL');
    const journal = await tx.ledgerTransaction.create({ data: { reference, type: 'FLUPFLAP_STORE' } });
    for (const [suffix, type, signedCents] of lines) {
      if (!signedCents) continue;
      const key = `FLUPFLAP_STORE_${this.testMode ? 'TEST_' : ''}${suffix}_USD`;
      const account = await tx.ledgerAccount.upsert({ where: { key }, update: {}, create: { key, name: key, type, currency: 'USD' } });
      await tx.ledgerEntry.create({ data: { transactionId: journal.id, accountId: account.id,
        direction: signedCents > 0 ? 'DEBIT' : 'CREDIT', amount: Math.abs(signedCents) / 100, currency: 'USD' } });
    }
  }

  async summary(owner: string) {
    const customerId = flupFlapCustomerId(owner);
    if (!customerId) fail('STORE_ACCOUNT_REQUIRED', 403);
    const store = await this.db.flupFlapStore.findUnique({ where: { customerId_testMode: { customerId: customerId!, testMode: this.testMode } } });
    if (!store) return { store: null, currency: 'USD', testMode: this.testMode, registrationCountries: [...storeCountries] };
    const [entries, funding, orders] = await Promise.all([
      this.db.flupFlapStoreEntry.findMany({ where: { storeId: store.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.db.flupFlapStoreFunding.findMany({ where: { storeId: store.id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.db.flupFlapStoreOrder.findMany({ where: { storeId: store.id }, orderBy: { createdAt: 'desc' }, take: 50,
        include: { transaction: { select: { recipientPhone: true, countryCode: true, operatorName: true, productName: true, status: true, deliveredAt: true } } } }),
    ]);
    const earnings = await this.db.flupFlapStoreOrder.aggregate({ where: { storeId: store.id, status: 'DELIVERED' }, _sum: { commissionCents: true } });
    return { store, currency: 'USD', testMode: this.testMode, canSell: store.status === 'ACTIVE' && this.countries.has(store.country),
      earnedCents: earnings._sum.commissionCents ?? 0, entries, funding, orders };
  }

  async apply(owner: string, input: unknown) {
    const data = storeApplication.parse(input);
    const customerId = flupFlapCustomerId(owner);
    if (!customerId) fail('STORE_ACCOUNT_REQUIRED', 403);
    return this.atomic(async tx => {
      await tx.$queryRaw`SELECT id FROM "FlupFlapCustomer" WHERE id = ${customerId} FOR UPDATE`;
      const customer = await tx.flupFlapCustomer.findUnique({ where: { id: customerId! } });
      if (!customer || customer.guestExpiresAt || customer.status !== 'ACTIVE') fail('REGISTERED_ACCOUNT_REQUIRED', 403);
      return tx.flupFlapStore.upsert({ where: { customerId_testMode: { customerId: customerId!, testMode: this.testMode } }, update: {}, create: { ...data, customerId: customerId!, testMode: this.testMode } });
    });
  }

  async requestFunding(owner: string, input: unknown) {
    const data = storeFunding.parse(input);
    return this.atomic(async tx => {
      const store = await this.active(tx, owner);
      const existing = await tx.flupFlapStoreFunding.findUnique({ where: { reference: data.reference } });
      if (existing) {
        if (existing.storeId !== store.id || existing.amountCents !== data.amountCents) fail('DEPOSIT_REFERENCE_ALREADY_USED');
        return existing;
      }
      return tx.flupFlapStoreFunding.create({ data: { ...data, storeId: store.id } });
    });
  }

  async review(actor: string, id: string, input: unknown) {
    const data = storeReview.parse(input);
    return this.atomic(async tx => {
      const store = await this.lock(tx, id);
      if (store.testMode !== this.testMode) fail('STORE_ENVIRONMENT_MISMATCH');
      if (data.status === 'ACTIVE' && !this.countries.has(store.country)) fail('STORE_COUNTRY_NOT_ENABLED');
      const updated = await tx.flupFlapStore.update({ where: { id }, data: { status: data.status, commissionBps: data.commissionBps } });
      await tx.auditLog.create({ data: { userId: actor, action: 'FLUPFLAP_STORE_REVIEWED', entity: 'FlupFlapStore', entityId: id,
        metadata: { ...data, previousStatus: store.status, previousCommissionBps: store.commissionBps } } });
      return updated;
    });
  }

  async reviewFunding(actor: string, id: string, approve: boolean, reason: string) {
    return this.atomic(async tx => {
      const initial = await tx.flupFlapStoreFunding.findUniqueOrThrow({ where: { id } });
      const store = await this.lock(tx, initial.storeId);
      const request = await tx.flupFlapStoreFunding.findUniqueOrThrow({ where: { id } });
      if (request.status !== 'PENDING') {
        if (request.status !== (approve ? 'APPROVED' : 'REJECTED')) fail('DEPOSIT_ALREADY_REVIEWED');
        return request;
      }
      if (store.testMode !== this.testMode) fail('STORE_ENVIRONMENT_MISMATCH');
      if (approve) {
        const customer = await tx.flupFlapCustomer.findUnique({ where: { id: store.customerId } });
        if (customer?.status !== 'ACTIVE') fail('STORE_ACCOUNT_RESTRICTED');
        if (store.status !== 'ACTIVE' || !this.countries.has(store.country)) fail('STORE_NOT_ACTIVE');
        await this.movement(tx, store.id, `deposit:${id}`, 'DEPOSIT', request.amountCents);
        await this.journal(tx, `store:deposit:${id}`, [['FUNDING_CLEARING', 'ASSET', request.amountCents], ['BALANCE', 'LIABILITY', -request.amountCents]]);
      }
      const updated = await tx.flupFlapStoreFunding.update({ where: { id }, data: { status: approve ? 'APPROVED' : 'REJECTED', reviewedBy: actor, reviewedAt: new Date() } });
      await tx.auditLog.create({ data: { userId: actor, action: 'FLUPFLAP_STORE_DEPOSIT_REVIEWED', entity: 'FlupFlapStoreFunding', entityId: id,
        metadata: { approved: approve, amountCents: request.amountCents, reason, testMode: this.testMode } } });
      return updated;
    });
  }

  // Records a return already completed outside the app; does not initiate a transfer.
  async recordBalanceReturn(actor: string, id: string, input: unknown) {
    const data = storeBalanceReturn.parse(input);
    return this.atomic(async tx => {
      const store = await this.lock(tx, id);
      if (store.testMode !== this.testMode) fail('STORE_ENVIRONMENT_MISMATCH');
      const reference = `balance-return:${data.reference}`;
      const existing = await tx.flupFlapStoreEntry.findUnique({ where: { reference } });
      if (existing) {
        if (existing.storeId !== id || existing.amountCents !== -data.amountCents) fail('BALANCE_RETURN_REFERENCE_CONFLICT');
        return existing;
      }
      if (store.balanceCents < data.amountCents) fail('STORE_INSUFFICIENT_BALANCE');
      await this.movement(tx, id, reference, 'BALANCE_RETURN', -data.amountCents);
      await this.journal(tx, `store:${reference}`, [['BALANCE', 'LIABILITY', data.amountCents], ['FUNDING_CLEARING', 'ASSET', -data.amountCents]]);
      await tx.auditLog.create({ data: { userId: actor, action: 'FLUPFLAP_STORE_BALANCE_RETURN_RECORDED', entity: 'FlupFlapStore', entityId: id,
        metadata: { amountCents: data.amountCents, reference: data.reference, testMode: this.testMode } } });
      return tx.flupFlapStoreEntry.findUniqueOrThrow({ where: { reference } });
    });
  }

  async authorize(record: MobileTopUpTransactionRecord) {
    if (record.paymentProvider !== 'STORE_BALANCE' || record.testMode !== this.testMode) fail('STORE_PAYMENT_MISMATCH');
    await this.atomic(async tx => {
      const store = await this.active(tx, record.userId);
      if (await tx.flupFlapStoreOrder.findUnique({ where: { transactionId: record.id } })) return;
      const transaction = await tx.mobileTopUpTransaction.findUniqueOrThrow({ where: { id: record.id } });
      if (transaction.flupFlapCustomerId !== store.customerId || transaction.paymentProvider !== 'STORE_BALANCE' || transaction.paymentStatus !== 'PENDING' || transaction.testMode !== this.testMode) fail('STORE_PAYMENT_MISMATCH');
      const quote = await tx.mobileTopUpQuote.findUniqueOrThrow({ where: { id: transaction.quoteId } });
      if (quote.expiresAt <= new Date()) fail('TOPUP_QUOTE_EXPIRED');
      if (await tx.promotionRedemption.findUnique({ where: { quoteId: transaction.quoteId } })) fail('STORE_PROMOTION_NOT_ALLOWED');
      const totalCents = cents(Number(transaction.totalChargeUsd)), feeCents = cents(Number(transaction.feeUsd));
      if (totalCents < feeCents || totalCents <= 0) fail('INVALID_STORE_AMOUNT');
      if (store.balanceCents < totalCents) fail('STORE_INSUFFICIENT_BALANCE');
      await tx.flupFlapStoreOrder.create({ data: { storeId: store.id, transactionId: record.id, totalCents, feeCents,
        commissionBps: store.commissionBps, commissionCents: storeCommission(feeCents, store.commissionBps) } });
      await this.movement(tx, store.id, `purchase:${record.id}`, 'RECHARGE', -totalCents);
      await this.journal(tx, `store:hold:${record.id}`, [['BALANCE', 'LIABILITY', totalCents], ['HELD', 'LIABILITY', -totalCents]]);
      await tx.mobileTopUpTransaction.update({ where: { id: record.id }, data: {
        paymentStatus: 'CAPTURED', paymentAuthorizationId: `store:${record.id}`, paymentProviderTransactionId: `store:${record.id}`, paymentStartedAt: new Date(),
      } });
    });
  }

  private async settle(record: MobileTopUpTransactionRecord, refund: boolean) {
    if (record.paymentProvider !== 'STORE_BALANCE' || record.testMode !== this.testMode) fail('STORE_PAYMENT_MISMATCH');
    await this.atomic(async tx => {
      const initial = await tx.flupFlapStoreOrder.findUniqueOrThrow({ where: { transactionId: record.id } });
      await this.lock(tx, initial.storeId);
      const order = await tx.flupFlapStoreOrder.findUniqueOrThrow({ where: { transactionId: record.id } });
      if (order.status === 'REFUNDED' || !refund && order.status === 'DELIVERED') return;
      const transaction = await tx.mobileTopUpTransaction.findUniqueOrThrow({ where: { id: record.id } });
      if (!refund && transaction.status !== 'DELIVERED' || refund && !['FAILED', 'REFUNDED'].includes(transaction.status)) fail('STORE_SETTLEMENT_NOT_CONFIRMED');
      const principal = order.totalCents - order.feeCents, netFee = order.feeCents - order.commissionCents;
      if (refund) {
        const amount = order.totalCents - (order.status === 'DELIVERED' ? order.commissionCents : 0);
        await this.movement(tx, order.storeId, `refund:${record.id}`, 'REFUND', amount);
        await this.journal(tx, `store:refund:${record.id}`, order.status === 'DELIVERED'
          ? [['PROVIDER_SETTLEMENT', 'LIABILITY', principal], ['FEE_REVENUE', 'REVENUE', netFee], ['BALANCE', 'LIABILITY', -amount]]
          : [['HELD', 'LIABILITY', amount], ['BALANCE', 'LIABILITY', -amount]]);
        await tx.mobileTopUpTransaction.update({ where: { id: record.id }, data: { paymentStatus: 'REFUNDED', paymentRecoveryCode: null } });
      } else {
        await this.movement(tx, order.storeId, `commission:${record.id}`, 'COMMISSION', order.commissionCents);
        await this.journal(tx, `store:delivery:${record.id}`, [['HELD', 'LIABILITY', order.totalCents], ['PROVIDER_SETTLEMENT', 'LIABILITY', -principal],
          ['FEE_REVENUE', 'REVENUE', -netFee], ['BALANCE', 'LIABILITY', -order.commissionCents]]);
      }
      await tx.flupFlapStoreOrder.update({ where: { transactionId: record.id }, data: { status: refund ? 'REFUNDED' : 'DELIVERED' } });
    });
  }
  delivered(record: MobileTopUpTransactionRecord) { return this.settle(record, false); }
  refund(record: MobileTopUpTransactionRecord) { return this.settle(record, true); }

  async list(offset: number) {
    const [stores, total, funding] = await Promise.all([
      this.db.flupFlapStore.findMany({ where: { testMode: this.testMode }, orderBy: { createdAt: 'desc' }, skip: offset, take: 50 }), this.db.flupFlapStore.count({ where: { testMode: this.testMode } }),
      this.db.flupFlapStoreFunding.findMany({ where: { status: 'PENDING', store: { testMode: this.testMode } }, orderBy: { createdAt: 'asc' }, take: 100, include: { store: { select: { name: true } } } }),
    ]);
    return { stores, total, funding, offset, currency: 'USD', testMode: this.testMode, enabledCountries: [...this.countries] };
  }
}
