import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp, resetStore } from '../src/app.js';
import { detectLedgerImbalances } from '../src/reconciliation.js';
import { assessRisk, loadSecurityConfig, redactAuditMetadata } from '../src/security.js';

const account = {
  email: 'security@example.com', password: 'correct-horse-42', firstName: 'Secure', lastName: 'Customer',
};
const recipient = {
  fullName: 'Jean Security', country: 'HT', phoneNumber: '+50939123456',
  address: '12 Rue Capois', city: 'Port-au-Prince', department: 'Ouest', payoutMethod: 'MONCASH',
};

function securityConfig(overrides: Record<string, string> = {}) {
  return loadSecurityConfig({
    LOGIN_MAX_FAILURES: '3', LOGIN_LOCK_MINUTES: '15',
    TRANSFER_LIMITS_ENABLED: 'false', SANDBOX_COMPLIANCE_AUTO_CLEAR: 'false',
    APPROVED_FOR_LIVE_USE: 'false', LIVE_MONEY_ENABLED: 'false',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

async function approvedAccount(app: ReturnType<typeof createApp>) {
  const registered = await request(app).post('/api/auth/register').send(account).expect(201);
  const admin = await request(app).post('/api/auth/login').send({
    email: 'admin@ticash.local', password: 'AdminPass123!',
  }).expect(200);
  const adminAuth = { Authorization: `Bearer ${admin.body.accessToken}` };
  await request(app).patch(`/api/admin/users/${registered.body.user.id}/kyc`)
    .set(adminAuth).send({ status: 'APPROVED' }).expect(200);
  return {
    userId: registered.body.user.id as string,
    auth: { Authorization: `Bearer ${registered.body.accessToken}` },
    adminAuth,
  };
}

async function createQuote(app: ReturnType<typeof createApp>, auth: { Authorization: string }, amount: number) {
  return request(app).post('/api/transfers/quote').set(auth).send({
    recipient, amount, sourceCurrency: 'USD', targetCurrency: 'HTG',
  }).expect(200);
}

describe('security and compliance hardening', () => {
  beforeEach(resetStore);

  it('locks repeated sign-in failures without revealing whether the account exists', async () => {
    const app = createApp({ securityConfig: securityConfig() });
    await request(app).post('/api/auth/register').send(account).expect(201);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await request(app).post('/api/auth/login').send({
        email: account.email, password: 'incorrect-password',
      }).expect(401);
      expect(response.body.code).toBe('INVALID_CREDENTIALS');
    }
    const locked = await request(app).post('/api/auth/login').send({
      email: account.email, password: account.password,
    }).expect(429);
    expect(locked.body.code).toBe('ACCOUNT_TEMPORARILY_LOCKED');
  });

  it('prevents client-side KYC and admin privilege bypasses', async () => {
    const app = createApp();
    const registered = await request(app).post('/api/auth/register').send(account).expect(201);
    const auth = { Authorization: `Bearer ${registered.body.accessToken}` };
    const blocked = await request(app).post('/api/transfers/quote').set(auth).send({
      recipient, amount: 10, sourceCurrency: 'USD', targetCurrency: 'HTG', kycVerified: true, isAdmin: true,
    }).expect(403);
    expect(blocked.body.code).toBe('KYC_REQUIRED');
    await request(app).get('/api/admin/overview').set(auth).expect(403);
  });

  it('enforces server-side account funding restrictions and revokes locked sessions', async () => {
    const app = createApp();
    const context = await approvedAccount(app);
    await request(app).patch(`/api/admin/users/${context.userId}/restrictions`).set(context.adminAuth).send({
      accountLocked: false, fundingRestricted: true, payoutRestricted: false, reason: 'Manual sandbox review',
    }).expect(200);
    const blocked = await request(app).post('/api/transfers/quote').set(context.auth).send({
      recipient, amount: 10, sourceCurrency: 'USD', targetCurrency: 'HTG',
    }).expect(403);
    expect(blocked.body.code).toBe('FUNDING_RESTRICTED');
    await request(app).patch(`/api/admin/users/${context.userId}/restrictions`).set(context.adminAuth).send({
      accountLocked: true, fundingRestricted: true, payoutRestricted: true, reason: 'Account security hold',
    }).expect(200);
    const locked = await request(app).get('/api/users/me').set(context.auth).expect(423);
    expect(locked.body.code).toBe('ACCOUNT_LOCKED');
  });

  it('enforces configured aggregate limits under concurrent transfer requests', async () => {
    const app = createApp({ securityConfig: securityConfig({
      TRANSFER_LIMITS_ENABLED: 'true', TRANSFER_LIMIT_PER_TRANSACTION_USD: '125',
      TRANSFER_LIMIT_DAILY_USD: '150', TRANSFER_LIMIT_WEEKLY_USD: '500', TRANSFER_LIMIT_MONTHLY_USD: '1000',
    }) });
    const context = await approvedAccount(app);
    const firstQuote = await createQuote(app, context.auth, 100);
    const secondQuote = await createQuote(app, context.auth, 100);
    const inputs = [firstQuote.body.quote.quoteId, secondQuote.body.quote.quoteId].map((quoteId) => ({
      recipient, amount: 100, sourceCurrency: 'USD', targetCurrency: 'HTG', quoteId,
    }));
    const responses = await Promise.all(inputs.map((input, index) => request(app).post('/api/transfers')
      .set(context.auth).set('Idempotency-Key', `concurrent-transfer-${index}`).send(input)));
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)?.body.code).toBe('DAILY_LIMIT_EXCEEDED');
  });

  it('flags risk signals for review without representing them as regulatory decisions', () => {
    const config = securityConfig({
      RISK_REVIEW_AMOUNT_USD: '100', RISK_MAX_TRANSFERS_24H: '2',
      RISK_MAX_DISTINCT_RECIPIENTS_24H: '1', RISK_MAX_FAILED_FUNDING_24H: '2',
      RISK_RECIPIENT_CHANGE_WINDOW_MINUTES: '60',
    });
    const flags = assessRisk(config, {
      amountUsd: 150, recipientId: 'recipient-b', failedFundingAttempts24h: 2,
      historicalTransfers: [
        { amountUsd: 20, recipientId: 'recipient-a', createdAt: new Date(), status: 'PROCESSING' },
        { amountUsd: 25, recipientId: 'recipient-a', createdAt: new Date(), status: 'COMPLETED' },
      ],
    });
    expect(flags).toEqual(expect.arrayContaining([
      'UNUSUAL_AMOUNT_REVIEW', 'TRANSACTION_VELOCITY_REVIEW', 'RECIPIENT_VELOCITY_REVIEW',
      'REPEATED_FUNDING_FAILURES_REVIEW', 'RAPID_RECIPIENT_CHANGE_REVIEW',
    ]));
  });

  it('detects ledger imbalance and never mutates or silently corrects it', () => {
    const discrepancies = detectLedgerImbalances([{
      id: 'ledger-1', reference: 'test:imbalanced', entries: [
        { direction: 'DEBIT', amount: 10, currency: 'USD' },
        { direction: 'CREDIT', amount: 9, currency: 'USD' },
      ],
    }]);
    expect(discrepancies).toHaveLength(1);
    expect(discrepancies[0].code).toBe('LEDGER_TRANSACTION_IMBALANCE');
  });

  it('redacts secrets and financial account fields from audit metadata', () => {
    expect(redactAuditMetadata({ token: 'secret', accountNumber: '123456', reason: 'review' }))
      .toEqual({ token: '[REDACTED]', accountNumber: '[REDACTED]', reason: 'review' });
  });

  it('rejects incomplete limits and every attempt to enable live money', () => {
    expect(() => securityConfig({ TRANSFER_LIMITS_ENABLED: 'true' })).toThrow(/All transfer limit/);
    expect(() => securityConfig({ LIVE_MONEY_ENABLED: 'true' })).toThrow(/Live money movement/);
    expect(() => securityConfig({ APPROVED_FOR_LIVE_USE: 'true' })).toThrow(/Live money movement/);
  });
});
