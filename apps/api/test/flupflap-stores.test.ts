import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pglitePrisma } from './helpers/pglite-prisma.js';
import { FlupFlapStores } from '../src/flupflap/stores.js';
import { storeCommission, storeLaunchCountries } from '../src/flupflap/store-policy.js';
import { createStoresAdminRouter, createStoresRouter } from '../src/flupflap/stores-router.js';
import { permissionsForRole, type AdminRequest } from '../src/admin-access.js';
import { FlupFlapSelfServiceDeletion } from '../src/flupflap/self-service-deletion.js';
import { flupFlapOwner } from '../src/flupflap/owner.js';
import { PrismaMobileTopUpRepository } from '../src/topup/repository.js';
import { MobileTopUpService } from '../src/topup/service.js';
import { MockMobileTopUpPaymentProvider, type MobileTopUpConfig, type MobileTopUpOperator, type MobileTopUpProvider, type ProviderTopUpResult } from '../src/topup/types.js';

const db = new PGlite();
const prisma = new PrismaClient({ adapter: pglitePrisma(db) });
const repository = new PrismaMobileTopUpRepository(prisma);
const stores = new FlupFlapStores(prisma, new Set(['US', 'CA', 'BR', 'FR']), true);
let actor: string;
beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../migrations/', import.meta.url));
  for (const dir of readdirSync(root).sort()) if (dir.includes('_')) await db.exec(readFileSync(`${root}/${dir}/migration.sql`, 'utf8'));
  actor = (await prisma.user.create({ data: { email: 'store-staff@example.test', passwordHash: 'fixture', role: 'ADMIN' } })).id;
}, 60000);
afterAll(async () => { await prisma.$disconnect(); await db.close(); });

const config: MobileTopUpConfig = { enabled: true, environment: 'sandbox', authUrl: 'https://auth.reloadly.com/oauth/token',
  airtimeBaseUrl: 'https://topups-sandbox.reloadly.com', billingCurrency: 'USD', quoteTtlSeconds: 300,
  paymentMode: 'mock', productionEnabled: false, approvedForLiveUse: false };
const operator: MobileTopUpOperator = { id: 99, provider: 'RELOADLY', name: 'Fixture Natcom', countryCode: 'HT', status: true,
  bundle: false, data: false, denominationType: 'FIXED', senderCurrencyCode: 'USD', destinationCurrencyCode: 'HTG',
  fixedAmounts: [10], localFixedAmounts: [1300], fixedAmountsPlanNames: {}, localFixedAmountsPlanNames: {} };
function engine(status = 'SUCCESSFUL') {
  const result: ProviderTopUpResult = { transactionId: randomUUID(), status, requestedAmount: 10, requestedAmountCurrencyCode: 'USD', deliveredAmount: 1300, deliveredAmountCurrencyCode: 'HTG' };
  const provider: MobileTopUpProvider = { name: 'RELOADLY', listCountries: async () => [{ code: 'HT', name: 'Haiti' }],
    listOperators: async () => [operator], detectOperator: async () => operator, getOperator: async () => operator,
    submitTopUp: vi.fn(async () => result), getTopUpStatus: vi.fn(async () => result) };
  const service = new MobileTopUpService(config, provider, new MockMobileTopUpPaymentProvider(), repository, async () => {},
    undefined, undefined, undefined, undefined, false, stores);
  return { service, provider, result };
}
async function fixture(amountCents = 10000, country = 'US') {
  const customer = await prisma.flupFlapCustomer.create({ data: { email: `${randomUUID()}@example.test`, passwordHash: 'fixture' } });
  const owner = flupFlapOwner(customer.id);
  const store = await stores.apply(owner, { name: 'Fixture Market', contactName: 'Fixture Owner', phone: '+17755550123', address: '123 Fixture Street, Reno', country });
  if (country !== 'HT') await stores.review(actor, store.id, { status: 'ACTIVE', reason: 'Business details verified' });
  if (amountCents > 0 && country !== 'HT') {
    const funding = await stores.requestFunding(owner, { amountCents, reference: randomUUID() });
    await stores.reviewFunding(actor, funding.id, true, 'Bank deposit independently verified');
  }
  return { customer, owner, store };
}
async function quote(service: MobileTopUpService, owner: string) {
  const catalog = await service.products('HT', 99, undefined, owner);
  return service.createQuote(owner, { countryCode: 'HT', phone: '+50937050210', operatorId: 99, productId: catalog.products[0].id }, true);
}
async function balance(id: string) { return (await prisma.flupFlapStore.findUniqueOrThrow({ where: { id } })).balanceCents; }
async function checkJournals() {
  const journals = await prisma.ledgerTransaction.findMany({ where: { type: 'FLUPFLAP_STORE' }, include: { entries: true } });
  for (const journal of journals) expect(journal.entries.reduce((sum, entry) => sum + (entry.direction === 'DEBIT' ? 1 : -1) * Math.round(Number(entry.amount) * 100), 0)).toBe(0);
}

describe('store accounts and balance integrity in migrated PostgreSQL', () => {
  it('uses 20% of the fee, rounds to cents, and requires explicit country activation', () => {
    expect(storeCommission(150)).toBe(30);
    expect(storeCommission(750)).toBe(150);
    expect(storeCommission(173)).toBe(35);
    expect([...storeLaunchCountries({})]).toEqual([]);
    expect([...storeLaunchCountries({ FLUPFLAP_STORE_COUNTRIES: 'US, FR, BAD' })]).toEqual(['US', 'FR']);
    expect(permissionsForRole('SUPPORT')).not.toContain('recharge.stores.funding');
    expect(permissionsForRole('OPERATIONS')).not.toContain('recharge.stores.funding');
  });
  it('cannot self-approve, change commission, or activate an unconfigured country', async () => {
    const f = await fixture(0, 'HT');
    await expect(stores.review(actor, f.store.id, { status: 'ACTIVE', reason: 'Review complete' })).rejects.toMatchObject({ code: 'STORE_COUNTRY_NOT_ENABLED' });
    await expect(stores.apply(f.owner, { name: 'Fake', contactName: 'Fake', address: 'Fake Address', phone: '+17755550123', country: 'US', status: 'ACTIVE' })).rejects.toThrow();
    await expect(stores.requestFunding(f.owner, { amountCents: 10000, reference: randomUUID() })).rejects.toMatchObject({ code: 'STORE_NOT_ACTIVE' });
  });
  it('credits a verified deposit only once, including concurrent reviews', async () => {
    const f = await fixture(0);
    const funding = await stores.requestFunding(f.owner, { amountCents: 10000, reference: randomUUID() });
    await Promise.all([stores.reviewFunding(actor, funding.id, true, 'Verified deposit'), stores.reviewFunding(actor, funding.id, true, 'Verified deposit')]);
    expect(await balance(f.store.id)).toBe(10000);
    await expect(stores.reviewFunding(actor, funding.id, false, 'Reject duplicate')).rejects.toMatchObject({ code: 'DEPOSIT_ALREADY_REVIEWED' });
    await checkJournals();
  });
  it('delivers one recharge, debits once, credits commission once and preserves the quoted fee', async () => {
    const f = await fixture(); const e = engine(); const q = await quote(e.service, f.owner);
    expect(q).toMatchObject({ feeUsd: 1.7, totalChargeUsd: 11.7 });
    const result = await e.service.purchaseFromStore(f.owner, { quoteId: q.id }, 'store-sale-idempotency');
    expect(result.status).toBe('DELIVERED'); expect(result.paymentProvider).toBe('STORE_BALANCE');
    expect(await balance(f.store.id)).toBe(8864);
    await e.service.purchaseFromStore(f.owner, { quoteId: q.id }, 'store-sale-idempotency');
    await e.service.getTransaction(f.owner, result.id, true);
    expect(e.provider.submitTopUp).toHaveBeenCalledTimes(1); expect(await balance(f.store.id)).toBe(8864);
    expect((await stores.summary(f.owner)).earnedCents).toBe(34);
    await expect(e.service.purchase(f.owner, { quoteId: q.id }, 'store-sale-idempotency')).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await checkJournals();
  });
  it('does not credit commission while delivery is pending and refunds a confirmed failure', async () => {
    const f = await fixture(); const e = engine('PROCESSING'); const q = await quote(e.service, f.owner);
    const result = await e.service.purchaseFromStore(f.owner, { quoteId: q.id }, randomUUID());
    expect(await balance(f.store.id)).toBe(8830);
    expect((await stores.summary(f.owner)).earnedCents).toBe(0);
    e.result.status = 'FAILED';
    const failed = await e.service.getTransaction(f.owner, result.id, true);
    expect(failed.paymentStatus).toBe('REFUNDED'); expect(await balance(f.store.id)).toBe(10000);
    await e.service.getTransaction(f.owner, result.id, true); expect(await balance(f.store.id)).toBe(10000);
    await checkJournals();
  });
  it('reverses a delivery commission when the provider refunds later', async () => {
    const f = await fixture(); const e = engine(); const q = await quote(e.service, f.owner);
    const result = await e.service.purchaseFromStore(f.owner, { quoteId: q.id }, randomUUID());
    e.result.status = 'REFUNDED';
    await e.service.getTransaction(f.owner, result.id, true);
    expect(await balance(f.store.id)).toBe(10000); expect((await stores.summary(f.owner)).earnedCents).toBe(0);
    await checkJournals();
  });
  it('prevents overspending across simultaneous orders', async () => {
    const f = await fixture(1170); const a = engine(), b = engine();
    const qa = await quote(a.service, f.owner), qb = await quote(b.service, f.owner);
    const results = await Promise.allSettled([a.service.purchaseFromStore(f.owner, { quoteId: qa.id }, randomUUID()), b.service.purchaseFromStore(f.owner, { quoteId: qb.id }, 'same-retry-key')]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(await balance(f.store.id)).toBe(34);
    expect(vi.mocked(a.provider.submitTopUp).mock.calls.length + vi.mocked(b.provider.submitTopUp).mock.calls.length).toBe(1);
  });
  it('retries an insufficient-balance sale with the same key after funding', async () => {
    const f = await fixture(0), e = engine(), q = await quote(e.service, f.owner);
    await expect(e.service.purchaseFromStore(f.owner, { quoteId: q.id }, 'refill-retry-key')).rejects.toMatchObject({ code: 'STORE_INSUFFICIENT_BALANCE' });
    expect(e.provider.submitTopUp).not.toHaveBeenCalled();
    const funding = await stores.requestFunding(f.owner, { amountCents: 1170, reference: randomUUID() });
    await stores.reviewFunding(actor, funding.id, true, 'Verified bank deposit');
    await e.service.purchaseFromStore(f.owner, { quoteId: q.id }, 'refill-retry-key');
    expect(await balance(f.store.id)).toBe(34); expect(e.provider.submitTopUp).toHaveBeenCalledTimes(1);
  });
  it('does not debit an expired unfunded quote after a later deposit', async () => {
    const f = await fixture(0), e = engine(), q = await quote(e.service, f.owner);
    await expect(e.service.purchaseFromStore(f.owner, { quoteId: q.id }, 'expired-store-key')).rejects.toMatchObject({ code: 'STORE_INSUFFICIENT_BALANCE' });
    await prisma.mobileTopUpQuote.update({ where: { id: q.id }, data: { expiresAt: new Date(0) } });
    const funding = await stores.requestFunding(f.owner, { amountCents: 1170, reference: randomUUID() });
    await stores.reviewFunding(actor, funding.id, true, 'Verified bank deposit');
    await expect(e.service.purchaseFromStore(f.owner, { quoteId: q.id }, 'expired-store-key')).rejects.toMatchObject({ code: 'TOPUP_QUOTE_EXPIRED' });
    expect(await balance(f.store.id)).toBe(1170); expect(e.provider.submitTopUp).not.toHaveBeenCalled();
    const transaction = await prisma.mobileTopUpTransaction.findFirstOrThrow({ where: { quoteId: q.id } });
    expect(transaction.paymentStatus).toBe('FAILED');
  });
  it('automatically cancels expired unfunded store reservations', async () => {
    const f = await fixture(0), e = engine(), q = await quote(e.service, f.owner);
    await expect(e.service.purchaseFromStore(f.owner, { quoteId: q.id }, 'abandoned-store-key')).rejects.toMatchObject({ code: 'STORE_INSUFFICIENT_BALANCE' });
    await prisma.mobileTopUpQuote.update({ where: { id: q.id }, data: { expiresAt: new Date(0) } });
    const row = await prisma.mobileTopUpTransaction.findFirstOrThrow({ where: { quoteId: q.id } });
    await prisma.mobileTopUpTransaction.update({ where: { id: row.id }, data: { updatedAt: new Date(Date.now() - 60000) } });
    await e.service.reconcilePendingTransactions();
    expect((await prisma.mobileTopUpTransaction.findUniqueOrThrow({ where: { id: row.id } })).paymentStatus).toBe('FAILED');
    expect(await balance(f.store.id)).toBe(0); expect(e.provider.submitTopUp).not.toHaveBeenCalled();
  });
  it('retains the original commission rate for a pending sale', async () => {
    const f = await fixture(), e = engine('PROCESSING'), q = await quote(e.service, f.owner);
    const sale = await e.service.purchaseFromStore(f.owner, { quoteId: q.id }, randomUUID());
    await stores.review(actor, f.store.id, { status: 'ACTIVE', commissionBps: 4000, reason: 'New rate for future sales' });
    e.result.status = 'SUCCESSFUL';
    await e.service.getTransaction(f.owner, sale.id, true);
    expect(await balance(f.store.id)).toBe(8864);
  });
  it('does not refund or resubmit after an ambiguous provider timeout', async () => {
    const f = await fixture(), e = engine(), q = await quote(e.service, f.owner);
    vi.mocked(e.provider.submitTopUp).mockRejectedValueOnce(new Error('Ambiguous provider timeout'));
    await expect(e.service.purchaseFromStore(f.owner, { quoteId: q.id }, 'unknown-provider-key')).rejects.toMatchObject({ code: 'TOPUP_SUBMISSION_UNKNOWN' });
    const replay = await e.service.purchaseFromStore(f.owner, { quoteId: q.id }, 'unknown-provider-key');
    expect(replay.status).toBe('PROCESSING'); expect(await balance(f.store.id)).toBe(8830);
    expect(e.provider.submitTopUp).toHaveBeenCalledTimes(1);
    e.provider.findTopUpByCustomIdentifier = vi.fn(async () => e.result);
    await e.service.getTransaction(f.owner, replay.id, true);
    expect(await balance(f.store.id)).toBe(8864); expect(e.provider.submitTopUp).toHaveBeenCalledTimes(1);
  });
  it('recovers a captured balance debit after interruption before provider submission', async () => {
    const f = await fixture(), e = engine(), q = await quote(e.service, f.owner);
    vi.spyOn(e.service, 'fulfillPaidRecharge').mockRejectedValueOnce(new Error('Process interrupted'));
    await expect(e.service.purchaseFromStore(f.owner, { quoteId: q.id }, 'interrupted-sale-key')).rejects.toThrow();
    expect(await balance(f.store.id)).toBe(8830); expect(e.provider.submitTopUp).not.toHaveBeenCalled();
    const row = await prisma.mobileTopUpTransaction.findFirstOrThrow({ where: { flupFlapCustomerId: f.customer.id } });
    await prisma.mobileTopUpTransaction.update({ where: { id: row.id }, data: { updatedAt: new Date(Date.now() - 60000) } });
    await e.service.reconcilePendingTransactions();
    expect(e.provider.submitTopUp).toHaveBeenCalledTimes(1); expect(await balance(f.store.id)).toBe(8864);
  });
  it('keeps sandbox funds inaccessible to a production store and denies foreign owners', async () => {
    const f = await fixture(), other = await fixture();
    const production = new FlupFlapStores(prisma, new Set(['US']), false);
    expect((await production.summary(f.owner)).store).toBeNull();
    await expect(production.review(actor, f.store.id, { status: 'ACTIVE', reason: 'Not authorized' })).rejects.toMatchObject({ code: 'STORE_ENVIRONMENT_MISMATCH' });
    const e = engine(), q = await quote(e.service, f.owner);
    await expect(e.service.purchaseFromStore(other.owner, { quoteId: q.id }, randomUUID())).rejects.toMatchObject({ code: 'TOPUP_QUOTE_NOT_FOUND' });
    await stores.review(actor, f.store.id, { status: 'SUSPENDED', reason: 'Store review required' });
    await expect(e.service.purchaseFromStore(f.owner, { quoteId: q.id }, randomUUID())).rejects.toMatchObject({ code: 'STORE_NOT_ACTIVE' });
  });
  it('preserves balances during account deletion, then erases store contact details after verified return', async () => {
    const f = await fixture(100);
    const deletion = new FlupFlapSelfServiceDeletion(prisma);
    await deletion.request(f.customer.id, 'fixture', 0);
    expect((await deletion.process(f.customer.id))?.status).toBe('DELETION_PENDING');
    await stores.recordBalanceReturn(actor, f.store.id, { amountCents: 100, reference: 'return:' + randomUUID() });
    expect((await deletion.process(f.customer.id))?.status).toBe('LOCAL_DATA_DELETED');
    expect(await prisma.flupFlapStore.findUnique({ where: { id: f.store.id } })).toMatchObject({ name: 'Deleted store', phone: 'DELETED', address: 'DELETED' });
    await checkJournals();
  });
  it('rejects mutation of historical balance entries', async () => {
    const f = await fixture();
    await expect(prisma.flupFlapStoreEntry.updateMany({ where: { storeId: f.store.id }, data: { amountCents: 1 } })).rejects.toThrow();
  });
});

describe('store route authorization', () => {
  it('rejects guests and disabled seller services', async () => {
    const e = engine();
    for (const guest of [true, false]) {
      const app = express(); app.use(express.json());
      app.use('/stores', createStoresRouter({ authenticate: (_req, _res, next) => next(), requireRechargeAllowed: (_req, _res, next) => next(),
        isGuest: async () => guest, recharge: e.service }));
      await request(app).get('/stores').expect(guest ? 403 : 503);
    }
  });
  it('requires explicit deposit-receipt confirmation and blocks unauthorized staff', async () => {
    const f = await fixture(0); const deposit = await stores.requestFunding(f.owner, { amountCents: 10000, reference: randomUUID() });
    const app = express(); app.use(express.json());
    app.use('/stores', createStoresAdminRouter({ stores, authenticate: (req: AdminRequest, _res, next) => { req.userId = actor; next(); },
      permission: () => (_req, _res, next) => next() }));
    app.use((error: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => { void error; void next; res.status(400).json({ code: 'INVALID_REQUEST' }); });
    await request(app).post(`/stores/funding/${deposit.id}/review`).send({ approve: true, fundsReceived: false, reason: 'Not received' }).expect(400);
    expect(await balance(f.store.id)).toBe(0);
    const blocked = express(); blocked.use('/stores', createStoresAdminRouter({ stores, authenticate: (_req, _res, next) => next(),
      permission: () => (_req, res) => { res.status(403).end(); } }));
    await request(blocked).get('/stores').expect(403);
  });
});
