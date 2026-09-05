import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp, resetStore } from '../src/app.js';

const account = {
  email: 'ops-test@example.com', password: 'correct-horse-42', firstName: 'Operations', lastName: 'Tester',
};

async function adminContext(app: ReturnType<typeof createApp>) {
  const admin = await request(app).post('/api/auth/login').send({
    email: 'admin@ticash.local', password: 'AdminPass123!',
  }).expect(200);
  const user = await request(app).post('/api/auth/register').send(account).expect(201);
  return {
    adminAuth: { Authorization: `Bearer ${admin.body.accessToken}` },
    userAuth: { Authorization: `Bearer ${user.body.accessToken}` },
    userId: user.body.user.id as string,
  };
}

describe('admin and operations dashboard API', () => {
  beforeEach(resetStore);

  it('rejects unauthenticated and customer admin access', async () => {
    const app = createApp();
    const context = await adminContext(app);
    await request(app).get('/api/admin/session').expect(401);
    const denied = await request(app).get('/api/admin/session').set(context.userAuth).expect(403);
    expect(denied.body.code).toBe('ADMIN_PERMISSION_REQUIRED');
  });

  it('enforces role permissions server-side and blocks support compliance actions', async () => {
    const app = createApp();
    const context = await adminContext(app);
    await request(app).patch(`/api/admin/staff/${context.userId}/role`).set(context.adminAuth)
      .send({ role: 'SUPPORT', reason: 'Assign support test role' }).expect(200);
    const session = await request(app).get('/api/admin/session').set(context.userAuth).expect(200);
    expect(session.body.role).toBe('SUPPORT');
    expect(session.body.permissions).toContain('customers.view');
    expect(session.body.permissions).not.toContain('compliance.decide');
    await request(app).patch(`/api/admin/users/${context.userId}/restrictions`).set(context.userAuth)
      .send({ accountLocked: false, fundingRestricted: true, payoutRestricted: false, reason: 'Unauthorized change' }).expect(403);
    await request(app).patch('/api/admin/transfers/missing/compliance').set(context.userAuth)
      .send({ status: 'CLEAR', reason: 'Unauthorized compliance decision' }).expect(403);
    await request(app).patch('/api/admin/staff/missing/role').set(context.userAuth)
      .send({ role: 'SUPER_ADMIN', reason: 'Privilege escalation attempt' }).expect(403);
    await request(app).post('/api/admin/transfers/missing/reversal').set(context.userAuth)
      .send({ reasonCode: 'OPERATIONS_CORRECTION', note: 'Unauthorized reversal attempt' }).expect(403);
  });

  it('rejects manual KYC approval when Didit is the authoritative provider', async () => {
    const app = createApp({ diditConfig: {
      enabled: true, apiKey: 'test-key', webhookSecret: 'test-secret', workflowId: 'test-workflow',
      baseUrl: 'https://verification.didit.me',
    } });
    const context = await adminContext(app);
    const result = await request(app).patch(`/api/admin/users/${context.userId}/kyc`).set(context.adminAuth)
      .send({ status: 'APPROVED' }).expect(409);
    expect(result.body.code).toBe('KYC_PROVIDER_AUTHORITATIVE');
  });

  it('returns real operational metric names without invented revenue', async () => {
    const app = createApp();
    const context = await adminContext(app);
    const overview = await request(app).get('/api/admin/overview').set(context.adminAuth).expect(200);
    expect(overview.body.metrics).toMatchObject({
      totalCustomers: 1, transfersToday: 0, transfersProcessing: 0,
      completedTransfers: 0, failedTransfers: 0, complianceReviews: 0,
      fundingFailures: 0, payoutFailures: 0, reconciliationDiscrepancies: 0,
    });
    expect(overview.body.metrics).not.toHaveProperty('revenue');
    expect(overview.body.users[0].email).toContain('***@');
  });

  it('audits account restrictions and never exposes the full customer email', async () => {
    const app = createApp();
    const context = await adminContext(app);
    await request(app).patch(`/api/admin/users/${context.userId}/restrictions`).set(context.adminAuth).send({
      accountLocked: false, fundingRestricted: true, payoutRestricted: true, reason: 'Compliance investigation hold',
    }).expect(200);
    const customer = await request(app).get(`/api/admin/customers/${context.userId}`).set(context.adminAuth).expect(200);
    expect(customer.body.customer).toMatchObject({ fundingRestricted: true, payoutRestricted: true });
    expect(customer.body.customer.email).not.toBe(account.email);
    const audit = await request(app).get('/api/admin/audit?q=ACCOUNT_RESTRICTIONS').set(context.adminAuth).expect(200);
    expect(audit.body.events[0].action).toBe('ACCOUNT_RESTRICTIONS_UPDATED');
  });

  it('supports audited payout suspension but blocks unsafe production activation', async () => {
    const app = createApp();
    const context = await adminContext(app);
    const suspended = await request(app).patch('/api/admin/providers/payouts/MONCASH').set(context.adminAuth)
      .send({ state: 'SUSPENDED', reason: 'Provider incident under investigation' }).expect(200);
    expect(suspended.body.configuration.state).toBe('SUSPENDED');
    const customerMethods = await request(app).get('/api/payout-methods').expect(200);
    expect(customerMethods.body.methods.map((item: { id: string }) => item.id)).not.toContain('MONCASH');
    const activation = await request(app).patch('/api/admin/providers/payouts/MONCASH').set(context.adminAuth)
      .send({ state: 'ACTIVE', reason: 'Attempt unsafe production activation' }).expect(409);
    expect(activation.body.code).toBe('PRODUCTION_ACTIVATION_BLOCKED');
    const providers = await request(app).get('/api/admin/providers').set(context.adminAuth).expect(200);
    expect(providers.body.corridor.approvedForLiveUse).toBe(false);
  });

  it('versions and audits fee/limit changes without inventing regulatory limits', async () => {
    const app = createApp();
    const context = await adminContext(app);
    const values = {
      ticashFeePercent: 2.5, ticashMinimumFeeUsd: 2, providerFundingFeeUsd: 0,
      limitsEnabled: true, perTransactionUsd: 100, dailyUsd: 500, weeklyUsd: 1000, monthlyUsd: 3000,
    };
    const first = await request(app).post('/api/admin/configuration/fees-limits').set(context.adminAuth)
      .send({ ...values, reason: 'Initial approved sandbox limits' }).expect(201);
    const second = await request(app).post('/api/admin/configuration/fees-limits').set(context.adminAuth)
      .send({ ...values, dailyUsd: 600, reason: 'Approved daily sandbox limit update' }).expect(201);
    expect(second.body.configuration.version).toBe(first.body.configuration.version + 1);
    const result = await request(app).get('/api/admin/configuration/fees-limits').set(context.adminAuth).expect(200);
    expect(result.body.active.version).toBe(second.body.configuration.version);
    await request(app).patch(`/api/admin/users/${context.userId}/kyc`).set(context.adminAuth)
      .send({ status: 'APPROVED' }).expect(200);
    const quote = await request(app).post('/api/transfers/quote').set(context.userAuth).send({
      recipient: { fullName: 'Jean Ops', country: 'HT', phoneNumber: '+50939123456', address: '12 Rue Capois',
        city: 'Port-au-Prince', department: 'Ouest', payoutMethod: 'MONCASH' },
      amount: 100, sourceCurrency: 'USD', targetCurrency: 'HTG',
    }).expect(200);
    expect(quote.body.quote.ticashFee).toBe(2.5);
    expect(quote.body.quote.configurationVersionId).toBe(second.body.configuration.id);
  });

  it('keeps ledger immutable and requires a dedicated authorized reversal workflow', async () => {
    const app = createApp();
    const context = await adminContext(app);
    await request(app).patch('/api/admin/ledger/arbitrary-entry').set(context.adminAuth)
      .send({ amount: 1000 }).expect(404);
    const invalid = await request(app).post('/api/admin/transfers/missing/reversal').set(context.adminAuth)
      .send({ reasonCode: 'OPERATIONS_CORRECTION', note: 'Correct through controlled reversal' }).expect(404);
    expect(invalid.body.code).toBe('TRANSFER_NOT_FOUND');
  });

  it('reports memory-mode reconciliation as a discrepancy instead of silently correcting it', async () => {
    const app = createApp();
    const context = await adminContext(app);
    const result = await request(app).post('/api/admin/reconciliation/run').set(context.adminAuth).expect(409);
    expect(result.body.autoCorrected).toBe(false);
    expect(result.body.discrepancies[0].code).toBe('PERSISTENT_LEDGER_UNAVAILABLE');
  });
});
