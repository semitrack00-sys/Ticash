import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { beforeAll, afterAll, afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { pglitePrisma } from './helpers/pglite-prisma.js';
import { FlupFlapMarketing } from '../src/flupflap/marketing.js';
import { campaignInput } from '../src/flupflap/marketing-policy.js';
import { reserveQuotePromotion, reconcilePromotion } from '../src/flupflap/marketing-recharge.js';
import request from 'supertest';
import { createApp, resetStore } from '../src/app.js';
import { FlupFlapIdentityRepository } from '../src/flupflap/repository.js';
import { PrismaMobileTopUpRepository } from '../src/topup/repository.js';
import { MobileTopUpService } from '../src/topup/service.js';
import { MockMobileTopUpPaymentProvider, type MobileTopUpConfig, type MobileTopUpProvider } from '../src/topup/types.js';
import { StripeSandboxPaymentProvider } from '../src/topup/stripe-provider.js';
import { loadStripeConfig } from '../src/topup/stripe-config.js';
import { flupFlapOwner } from '../src/flupflap/owner.js';

const db = new PGlite();
const prisma = new PrismaClient({ adapter: pglitePrisma(db) });
const marketing = new FlupFlapMarketing(prisma);
let customerId: string, staffId: string, promoterId: string;
beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../migrations/', import.meta.url));
  for (const dir of readdirSync(root).sort()) {
    if (!dir.includes('_')) continue;
    await db.exec(readFileSync(`${root}/${dir}/migration.sql`, 'utf8'));
  }
}, 60000);
afterAll(async () => { await prisma.$disconnect(); await db.close(); });
afterEach(() => vi.unstubAllEnvs());
beforeEach(async () => {
  // New identities/campaigns per test, preserving immutable audit records.
  const staff = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only-hash', role: 'ADMIN' } });
  staffId = staff.id;
  customerId = (await prisma.flupFlapCustomer.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only-hash' } })).id;
  promoterId = (await marketing.createPromoter(staffId, { name: 'Test promoter' })).id;
});
const input = () => campaignInput.parse({ name: 'Integration test campaign', promoterId, startsAt: '2026-01-01T00:00:00Z',
  endsAt: '2099-01-01T00:00:00Z', status: 'ACTIVE', reason: 'Test configuration', rules: {
    maxRedemptions: 2, maxPerCustomer: 1, newCustomerOnly: false, firstRechargeOnly: true,
    benefit: { type: 'FIXED_DISCOUNT', cents: 50 }, reward: { type: 'FIXED_CUSTOMER', cents: 25 },
  } });
async function attributed() {
  const campaign = await marketing.saveCampaign(staffId, input());
  const visit = await marketing.visit({ promo: campaign.code });
  await marketing.claim(customerId, visit.capability);
  return campaign;
}
async function quote(id = customerId, benefits = true, testMode = true) {
  return prisma.$transaction(async tx => {
    const q = await tx.mobileTopUpQuote.create({ data: { flupFlapCustomerId: id, provider: 'RELOADLY',
      recipientPhone: '+50937050210', countryCode: 'HT', operatorId: 7, operatorName: 'Test operator',
      productId: 'real-catalog-fixture', productName: 'Test product', kind: 'AIRTIME', providerAmount: 10,
      providerCurrency: 'USD', deliveredValue: 100, deliveredCurrency: 'HTG', feeUsd: 1.79, totalChargeUsd: 11.79,
      expiresAt: new Date(Date.now() + 600000), testMode,
    } });
    return reserveQuotePromotion(tx, q, benefits);
  });
}
async function delivered(quoteId: string) {
  const q = await prisma.mobileTopUpQuote.findUniqueOrThrow({ where: { id: quoteId } });
  return prisma.mobileTopUpTransaction.create({ data: {
    flupFlapCustomerId: q.flupFlapCustomerId, quoteId, recipientPhone: q.recipientPhone, countryCode: q.countryCode,
    operatorId: q.operatorId, operatorName: q.operatorName, productId: q.productId, productName: q.productName, kind: q.kind,
    providerAmount: q.providerAmount, providerCurrency: q.providerCurrency, deliveredCurrency: q.deliveredCurrency,
    feeUsd: q.feeUsd, totalChargeUsd: q.totalChargeUsd, customIdentifier: randomUUID(), idempotencyKey: randomUUID(), requestHash: 'test-only',
    status: 'DELIVERED', paymentStatus: 'CAPTURED', paymentProvider: 'STRIPE', providerTransactionId: randomUUID(),
    paymentProviderTransactionId: randomUUID(), deliveredAt: new Date(), testMode: true,
  } });
}
const reconcile = (id: string) => prisma.$transaction(tx => reconcilePromotion(tx, id));

describe('persistent FlupFlap marketing with migrated PostgreSQL', () => {
  it('existing quote/reservation/Stripe code uses the reviewed promotional total, never provider principal', async () => {
    await attributed(); vi.stubEnv('FLUPFLAP_MARKETING_ENABLED', 'true'); vi.stubEnv('FLUPFLAP_MARKETING_SANDBOX_BENEFITS', 'true');
    const operator = { id: 7, name: 'Test provider operator', countryCode: 'HT', status: true, bundle: false, denominationType: 'FIXED' as const,
      senderCurrencyCode: 'USD', destinationCurrencyCode: 'HTG', fixedAmounts: [10], localFixedAmounts: [100], fixedAmountsPlanNames: {}, localFixedAmountsPlanNames: {} };
    const provider: MobileTopUpProvider = { listCountries: async () => [{ code: 'HT', name: 'Haiti' }], listOperators: async () => [operator],
      getOperator: async () => operator, detectOperator: async () => operator,
      submitTopUp: vi.fn(async () => { throw new Error('Provider submission forbidden'); }), getTopUpStatus: async () => { throw new Error('Provider status request forbidden'); } };
    const transport = vi.fn<typeof fetch>(async (_url, options) => {
      const body = new URLSearchParams(String(options?.body));
      expect(body.get('line_items[0][price_data][unit_amount]')).toBe('1123');
      return new Response(JSON.stringify({ id: 'cs_test_marketing', url: 'https://checkout.stripe.com/c/pay/cs_test_marketing' }), { status: 200 });
    });
    const stripe = new StripeSandboxPaymentProvider(loadStripeConfig({ STRIPE_ENABLED: 'true', STRIPE_ENVIRONMENT: 'sandbox',
      STRIPE_SECRET_KEY: 'sk_test_fixture_secret', STRIPE_PUBLIC_KEY: 'pk_test_fixture_public', STRIPE_WEBHOOK_SECRET: 'whsec_fixture_signing_key',
      STRIPE_SUCCESS_URL: 'https://www.flupflap.com/', STRIPE_FAILURE_URL: 'https://www.flupflap.com/' }), transport);
    const config: MobileTopUpConfig = { enabled: true, environment: 'sandbox', clientId: 'test-only', clientSecret: 'test-only',
      authUrl: 'https://auth.reloadly.com/oauth/token', airtimeBaseUrl: 'https://topups-sandbox.reloadly.com', billingCurrency: 'USD', quoteTtlSeconds: 300,
      paymentMode: 'stripe_sandbox', productionEnabled: false, approvedForLiveUse: false };
    const repository = new PrismaMobileTopUpRepository(prisma);
    const service = new MobileTopUpService(config, provider, new MockMobileTopUpPaymentProvider(), repository, async () => {}, () => new Date(), stripe);
    const owner = flupFlapOwner(customerId);
    const q = await service.createQuote(owner, { countryCode: 'HT', phone: '+50937050210', operatorId: 7, productId: 'reloadly:HT:7:airtime:10.00' });
    expect(q).toMatchObject({ providerAmount: 10, feeUsd: 1.23, totalChargeUsd: 11.23, deliveredValue: 100, deliveredCurrency: 'HTG' });
    const result = await service.createPaymentSession(owner, { quoteId: q.id }, 'marketing-key-0001', 'US');
    expect(result.amountMinor).toBe(1123); expect(transport).toHaveBeenCalledTimes(1); expect(provider.submitTopUp).not.toHaveBeenCalled();
    expect((await prisma.mobileTopUpTransaction.findUniqueOrThrow({ where: { quoteId: q.id } })).providerAmount.toString()).toBe('10');
  });
  it('global caps reject additional redemptions, expired reservations release capacity', async () => {
    const c = await marketing.saveCampaign(staffId, { ...input(), rules: { ...input().rules, maxRedemptions: 1 } });
    const visit = await marketing.visit({ promo: c.code }); await marketing.claim(customerId, visit.capability);
    const q = await quote();
    await expect(marketing.visit({ promo: c.code })).rejects.toThrow('This promotion cannot be applied');
    await prisma.promotionRedemption.update({ where: { quoteId: q.id }, data: { expiresAt: new Date(0) } });
    await prisma.mobileTopUpQuote.update({ where: { id: q.id }, data: { expiresAt: new Date(0) } });
    const fresh = await quote(); expect(fresh.feeUsd.toString()).toBe('1.29');
    expect((await prisma.promotionRedemption.findUniqueOrThrow({ where: { quoteId: q.id } })).status).toBe('EXPIRED');
  });
  it('a milestone with no reward stays final when earlier events are replayed later', async () => {
    const c = await marketing.saveCampaign(staffId, { ...input(), rules: { ...input().rules, firstRechargeOnly: false, maxPerCustomer: 3,
      reward: { type: 'MILESTONE', every: 2, cents: 100 } } });
    const visit = await marketing.visit({ promo: c.code }); await marketing.claim(customerId, visit.capability);
    const a = await delivered((await quote()).id); await reconcile(a.id);
    const b = await delivered((await quote()).id); await reconcile(b.id);
    await reconcile(a.id); await reconcile(b.id);
    expect(await prisma.promoterReward.count({ where: { redemption: { campaignId: c.id } } })).toBe(1);
    expect(await prisma.promoterReward.findUnique({ where: { transactionId: a.id } })).toBeNull();
  });
  it('protects marketing with real identity/admin middleware and rejects browser reward manipulation', async () => {
    resetStore();
    const app = createApp({ flupFlapMarketing: marketing, flupFlapRepository: new FlupFlapIdentityRepository(prisma),
      flupFlapConfig: { enabled: true, accessSecret: 'test-only-flupflap-access-secret-at-least-32-characters' } });
    await request(app).get('/api/admin/flupflap/promotions').expect(401);
    const flup = await request(app).post('/api/flupflap/auth/register').send({ firstName: 'Test', lastName: 'Customer',
      phone: '+15550009876', email: `${randomUUID()}@example.invalid`, password: 'test-only-password-123' }).expect(201);
    const auth = { Authorization: `Bearer ${flup.body.accessToken}` };
    await request(app).get('/api/admin/flupflap/promotions').set(auth).expect(401);
    const share = await request(app).get('/api/flupflap/marketing/share').set(auth).expect(200);
    expect(share.body.url).toMatch(/^https:\/\/www\.flupflap\.com\/join\?r=[a-f0-9]{32}$/);
    const qr = await request(app).get('/api/flupflap/marketing/share/qr').set(auth).expect(200);
    expect(qr.body.dataUrl).toMatch(/^data:image\/png;base64,/);
    await request(app).post('/api/flupflap/marketing/attribution').set(auth).send({ capability: 'a'.repeat(43), reward: 999 }).expect(400);
    await request(app).post('/api/flupflap/marketing/visits').send({ promo: 'JEAN20', fee: 0 }).expect(400);
    const ti = await request(app).post('/api/auth/register').send({ firstName: 'Ti', lastName: 'User', email: `${randomUUID()}@example.invalid`, password: 'test-only-password-123' }).expect(201);
    const tiAuth = { Authorization: `Bearer ${ti.body.accessToken}` };
    await request(app).get('/api/flupflap/marketing/share').set(tiAuth).expect(401);
    await request(app).get('/api/admin/flupflap/promotions').set(tiAuth).expect(403);
    const admin = await request(app).post('/api/auth/login').send({ email: 'admin@ticash.local', password: 'AdminPass123!' }).expect(200);
    const adminAuth = { Authorization: `Bearer ${admin.body.accessToken}` };
    await request(app).get('/api/admin/flupflap/promotions').set(adminAuth).expect(200);
    await request(app).patch(`/api/admin/staff/${ti.body.user.id}/role`).set(adminAuth).send({ role: 'SUPPORT', reason: 'Test marketing permissions' }).expect(200);
    await request(app).post('/api/admin/flupflap/promotions/campaigns').set(tiAuth).send(input()).expect(403);
    await prisma.flupFlapCustomer.update({ where: { id: flup.body.user.id }, data: { rechargeRestricted: true } });
    await request(app).get('/api/flupflap/marketing/share').set(auth).expect(403);
  });
  it('reuses the expiring HttpOnly visit receipt across landing/signup without double-counting clicks', async () => {
    const c = await marketing.saveCampaign(staffId, input());
    const first = await marketing.visit({ promo: c.code });
    const repeated = await marketing.visit({ promo: c.code }, first.capability);
    expect(repeated.capability).toBe(first.capability);
    expect(await prisma.campaignEvent.count({ where: { visit: { campaignId: c.id }, type: 'LANDING_VIEWED' } })).toBe(1);
  });
  it('stores only visit capability hashes, generates stable referral and valid share links', async () => {
    const link = await marketing.referral(customerId);
    expect(await marketing.referral(customerId)).toEqual(link);
    expect(link.url).not.toContain(customerId);
    const visit = await marketing.visit({ r: link.code });
    const stored = await prisma.campaignVisit.findFirstOrThrow({ where: { referralCode: link.code } });
    expect(JSON.stringify(stored)).not.toContain(visit.capability);
    await expect(marketing.claim(customerId, visit.capability)).rejects.toThrow();
  });
  it('claims referral once after real account creation and never changes attribution on replay', async () => {
    const ref = await marketing.referral(customerId);
    const visit = await marketing.visit({ r: ref.code });
    await marketing.signupStarted(visit.capability);
    const newCustomer = await prisma.flupFlapCustomer.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only-hash' } });
    await marketing.claim(newCustomer.id, visit.capability);
    await marketing.claim(newCustomer.id, visit.capability);
    expect(await prisma.referralAttribution.count({ where: { customerId: newCustomer.id } })).toBe(1);
    expect(await prisma.campaignEvent.count({ where: { visit: { attribution: { customerId: newCustomer.id } } } })).toBe(3);
    const other = await marketing.visit({ r: ref.code });
    await expect(marketing.claim(newCustomer.id, other.capability)).rejects.toThrow();
  });
  it('rejects invalid/expired/disabled/revoked campaign codes with the same safe response', async () => {
    await expect(marketing.visit({ promo: 'UNKNOWN20' })).rejects.toThrow('This promotion cannot be applied');
    for (const status of ['PAUSED', 'DISABLED', 'EXPIRED', 'REVOKED'] as const) {
      const campaign = await marketing.saveCampaign(staffId, { ...input(), status });
      await expect(marketing.visit({ promo: campaign.code })).rejects.toThrow('This promotion cannot be applied');
    }
  });
  it('rejects expired capability and promoter self-attribution', async () => {
    await prisma.promoter.update({ where: { id: promoterId }, data: { customerId } });
    const campaign = await marketing.saveCampaign(staffId, input());
    const visit = await marketing.visit({ promo: campaign.code });
    await expect(marketing.claim(customerId, visit.capability)).rejects.toThrow();
    await prisma.campaignVisit.updateMany({ where: { campaignId: campaign.id }, data: { expiresAt: new Date(0) } });
    await expect(marketing.signupStarted(visit.capability)).rejects.toThrow();
  });
  it('promo wins conflicting referral unless explicit co-attribution is allowed; no double reward', async () => {
    const ref = await marketing.referral(customerId);
    const c = await marketing.saveCampaign(staffId, input());
    await marketing.visit({ promo: c.code, r: ref.code });
    expect((await prisma.campaignVisit.findFirstOrThrow({ where: { campaignId: c.id } })).referralCode).toBeNull();
  });
  it('reserves exact server fee reduction and preserves provider principal/receiver data', async () => {
    await attributed();
    const q = await quote();
    expect(q.feeUsd.toString()).toBe('1.29');
    expect(q.totalChargeUsd.toString()).toBe('11.29');
    expect(q.providerAmount.toString()).toBe('10');
    expect(q.deliveredValue?.toString()).toBe('100');
    expect(q.deliveredCurrency).toBe('HTG');
    expect((await quote()).feeUsd.toString()).toBe('1.79'); // first-recharge reservation already exists
  });
  it('benefits stay disabled by default and cannot affect production quotes', async () => {
    await attributed();
    expect((await quote(customerId, false)).feeUsd.toString()).toBe('1.79');
    expect((await quote(customerId, true, false)).feeUsd.toString()).toBe('1.79');
  });
  it('concurrent quote creation respects per-customer and campaign caps', async () => {
    const c = await attributed();
    await Promise.all([quote(), quote(), quote()]);
    expect(await prisma.promotionRedemption.count({ where: { campaignId: c.id } })).toBe(1);
  });
  it('repeated payment/provider reconciliation creates exactly one pending reward', async () => {
    await attributed(); const q = await quote(); const tx = await delivered(q.id);
    await Promise.all([reconcile(tx.id), reconcile(tx.id), reconcile(tx.id)]);
    expect(await prisma.promoterReward.count({ where: { transactionId: tx.id } })).toBe(1);
    expect(await prisma.promoterReward.findUnique({ where: { transactionId: tx.id } })).toMatchObject({ amountCents: 25, status: 'PENDING', testMode: true });
  });
  it('unpaid/failed fulfillment never earns compensation; refund reverses reward once', async () => {
    await attributed(); const q = await quote(); const tx = await delivered(q.id);
    await prisma.mobileTopUpTransaction.update({ where: { id: tx.id }, data: { paymentStatus: 'AUTHORIZED' } });
    await reconcile(tx.id);
    expect(await prisma.promoterReward.count({ where: { transactionId: tx.id } })).toBe(0);
    await prisma.mobileTopUpTransaction.update({ where: { id: tx.id }, data: { paymentStatus: 'CAPTURED' } });
    await reconcile(tx.id);
    await prisma.mobileTopUpTransaction.update({ where: { id: tx.id }, data: { paymentStatus: 'REFUNDED', refundedAt: new Date() } });
    await reconcile(tx.id); await reconcile(tx.id);
    const reward = await prisma.promoterReward.findUniqueOrThrow({ where: { transactionId: tx.id } });
    expect(reward.status).toBe('REVERSED');
    expect(await prisma.promotionAuditEvent.count({ where: { rewardId: reward.id, action: 'REWARD_REVERSED' } })).toBe(1);
  });
  it('campaign edits never reprice historical quote snapshots; audit is immutable in SQL', async () => {
    const c = await attributed(); const q = await quote();
    await marketing.saveCampaign(staffId, { ...input(), rules: { ...input().rules, benefit: { type: 'WAIVED_FEE' } } }, c.id);
    expect((await prisma.mobileTopUpQuote.findUniqueOrThrow({ where: { id: q.id } })).totalChargeUsd.toString()).toBe('11.29');
    await expect(db.query('UPDATE "PromotionAuditEvent" SET reason=$1 WHERE "campaignId"=$2', ['tamper', c.id])).rejects.toThrow('append-only');
  });
  it('reports only campaign aggregates without customer/payment/auth PII', async () => {
    const c = await attributed(); const q = await quote(); const tx = await delivered(q.id); await reconcile(tx.id);
    const report = await marketing.report(promoterId);
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ id: c.id, successfulRecharges: 1, promotionalCostCents: 50, attributableFeeCents: 129 });
    expect(JSON.stringify(report)).not.toMatch(/recipientPhone|email|paymentSessionId|password|capabilityHash|customerId/);
    expect(await marketing.report(randomUUID())).toEqual([]);
  });
  it('SQL rejects malformed or monetary live campaign rules independently of API validation', async () => {
    const c = await marketing.saveCampaign(staffId, input());
    await expect(db.query('UPDATE "PromotionCampaign" SET "testMode"=false, rules=$1 WHERE id=$2', ['{}', c.id])).rejects.toThrow('PromotionCampaign_no_live_money');
    await expect(db.query('UPDATE "PromotionCampaign" SET "testMode"=false WHERE id=$1', [c.id])).rejects.toThrow('PromotionCampaign_no_live_money');
  });
  it('reward approvals are ordered, auditable and cannot record a sandbox reward as paid', async () => {
    await attributed(); const tx = await delivered((await quote()).id); await reconcile(tx.id);
    const reward = await prisma.promoterReward.findUniqueOrThrow({ where: { transactionId: tx.id } });
    await expect(marketing.changeReward(staffId, reward.id, 'PAYABLE', 'Test approval')).rejects.toThrow();
    await marketing.changeReward(staffId, reward.id, 'APPROVED', 'Verified sandbox reward');
    await marketing.changeReward(staffId, reward.id, 'PAYABLE', 'Verified sandbox ledger');
    await expect(marketing.changeReward(staffId, reward.id, 'PAID', 'No real payout permitted')).rejects.toThrow();
    await marketing.changeReward(staffId, reward.id, 'REVERSED', 'Administrative fraud review');
    expect((await prisma.promoterReward.findUniqueOrThrow({ where: { id: reward.id } })).status).toBe('REVERSED');
    expect(await prisma.promotionAuditEvent.count({ where: { rewardId: reward.id, actorId: staffId } })).toBe(3);
  });
  it('campaign dates are enforced even when status incorrectly remains ACTIVE', async () => {
    const c = await marketing.saveCampaign(staffId, { ...input(), startsAt: '2020-01-01T00:00:00Z', endsAt: '2021-01-01T00:00:00Z' });
    await expect(marketing.visit({ promo: c.code })).rejects.toThrow('This promotion cannot be applied');
  });
  it('explicit co-attribution retains one referral and one campaign without awarding a signup', async () => {
    const ref = await marketing.referral(customerId);
    const c = await marketing.saveCampaign(staffId, { ...input(), rules: { ...input().rules, allowReferralAttribution: true } });
    const visit = await marketing.visit({ promo: c.code, r: ref.code });
    const customer = await prisma.flupFlapCustomer.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'test-only-hash' } });
    await marketing.claim(customer.id, visit.capability);
    expect(await prisma.referralAttribution.findUnique({ where: { customerId: customer.id } })).toMatchObject({ referralCode: ref.code, campaignId: c.id });
    expect(await prisma.promoterReward.count({ where: { redemption: { customerId: customer.id } } })).toBe(0);
    const guest = await prisma.flupFlapCustomer.create({ data: { guestExpiresAt: new Date(Date.now() + 60000) } });
    await expect(marketing.referral(guest.id)).rejects.toThrow();
  });

});
