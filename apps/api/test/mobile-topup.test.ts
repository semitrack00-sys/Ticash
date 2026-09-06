import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, resetStore } from '../src/app.js';
import type {
  MobileTopUpConfig,
  MobileTopUpOperator,
  MobileTopUpProvider,
  ProviderTopUpResult,
} from '../src/topup/types.js';

const config: MobileTopUpConfig = {
  enabled: true,
  environment: 'sandbox',
  clientId: 'test',
  clientSecret: 'test',
  authUrl: 'https://auth.reloadly.com/oauth/token',
  airtimeBaseUrl: 'https://topups-sandbox.reloadly.com',
  billingCurrency: 'USD',
  feeUsd: '0.50',
  quoteTtlSeconds: 300,
  paymentMode: 'mock',
  productionEnabled: false,
  approvedForLiveUse: false,
};

const operator: MobileTopUpOperator = {
  id: 99,
  name: 'Provider Haiti Sandbox',
  countryCode: 'HT',
  status: true,
  bundle: true,
  denominationType: 'FIXED',
  senderCurrencyCode: 'USD',
  destinationCurrencyCode: 'HTG',
  fixedAmounts: [5, 10],
  localFixedAmounts: [650, 1300],
  fixedAmountsPlanNames: { '10': '2 GB Sandbox Plan' },
  localFixedAmountsPlanNames: {},
};

class TestProvider implements MobileTopUpProvider {
  submit = vi.fn(async (): Promise<ProviderTopUpResult> => ({
    transactionId: 'reloadly-transaction-1',
    status: 'PROCESSING',
    requestedAmount: 5,
    requestedAmountCurrencyCode: 'USD',
  }));
  status: ProviderTopUpResult = {
    transactionId: 'reloadly-transaction-1', status: 'SUCCESSFUL', requestedAmount: 5,
    requestedAmountCurrencyCode: 'USD', deliveredAmount: 650, deliveredAmountCurrencyCode: 'HTG',
  };
  async listOperators() { return [operator]; }
  async detectOperator() { return operator; }
  async getOperator() { return operator; }
  async submitTopUp(input: Parameters<MobileTopUpProvider['submitTopUp']>[0]) { return this.submit(input); }
  async getTopUpStatus() { return this.status; }
}

async function auth(app: ReturnType<typeof createApp>, suffix = 'one') {
  const result = await request(app).post('/api/auth/register').send({
    email: `topup-${suffix}@example.com`, password: 'correct-horse-42', firstName: 'Ti', lastName: 'Cash',
  }).expect(201);
  return { Authorization: `Bearer ${result.body.accessToken}` };
}

async function quote(app: ReturnType<typeof createApp>, headers: Record<string, string>, productId = 'reloadly:99:data:5.00') {
  return request(app).post('/api/mobile-topups/quotes').set(headers).send({
    phone: '+50937123456', operatorId: 99, productId,
  }).expect(201);
}

describe('Haiti Mobile Recharge sandbox API', () => {
  beforeEach(resetStore);

  it('returns a controlled disabled response without provider credentials', async () => {
    const app = createApp({ mobileTopUpConfig: { ...config, enabled: false, clientId: undefined, clientSecret: undefined } });
    const headers = await auth(app, 'disabled');
    const response = await request(app).get('/api/mobile-topups/operators?country=HT').set(headers).expect(503);
    expect(response.body.code).toBe('MOBILE_TOPUP_DISABLED');
  });

  it('uses only provider-returned Haiti operators and products', async () => {
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: new TestProvider() });
    const headers = await auth(app, 'catalog');
    const operators = await request(app).get('/api/mobile-topups/operators?country=HT').set(headers).expect(200);
    expect(operators.body.operators[0].name).toBe(operator.name);
    await request(app).get('/api/mobile-topups/operators?country=DO').set(headers).expect(400);
    const products = await request(app).get('/api/mobile-topups/operators/99/products').set(headers).expect(200);
    expect(products.body.products).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'DATA', price: 5 }),
      expect.objectContaining({ kind: 'DATA', name: '2 GB Sandbox Plan', price: 10 }),
    ]));
  });

  it('creates saved recharge recipients, an authoritative quote, and an idempotent purchase', async () => {
    const provider = new TestProvider();
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: provider });
    const headers = await auth(app, 'purchase');
    const saved = await request(app).post('/api/mobile-topups/recipients').set(headers).send({
      nickname: 'Mom', phone: '37123456', operatorId: 99, operatorName: operator.name,
    }).expect(201);
    const quoted = await quote(app, headers);
    expect(quoted.body.quote).toMatchObject({ recipientPhone: '+50937123456', providerAmount: 5,
      feeUsd: 0.5, totalChargeUsd: 5.5, deliveredValue: 650, deliveredCurrency: 'HTG' });
    const payload = { quoteId: quoted.body.quote.id, recipientId: saved.body.recipient.id };
    const first = await request(app).post('/api/mobile-topups/transactions').set(headers)
      .set('Idempotency-Key', 'topup-purchase-one').send(payload).expect(201);
    const replay = await request(app).post('/api/mobile-topups/transactions').set(headers)
      .set('Idempotency-Key', 'topup-purchase-one').send(payload).expect(201);
    expect(replay.body.transaction.id).toBe(first.body.transaction.id);
    expect(provider.submit).toHaveBeenCalledTimes(1);
    expect(first.body.transaction).toMatchObject({ status: 'PROCESSING', paymentStatus: 'AUTHORIZED', testMode: true });
  });

  it('rejects expired quotes, quote reuse, phone mismatches and duplicate-key tampering', async () => {
    let time = new Date('2026-01-01T00:00:00Z');
    const provider = new TestProvider();
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: provider, mobileTopUpClock: () => time });
    const headers = await auth(app, 'guards');
    const firstQuote = await quote(app, headers);
    time = new Date('2026-01-01T00:05:01Z');
    const expired = await request(app).post('/api/mobile-topups/transactions').set(headers)
      .set('Idempotency-Key', 'topup-expired-one').send({ quoteId: firstQuote.body.quote.id }).expect(409);
    expect(expired.body.code).toBe('TOPUP_QUOTE_EXPIRED');

    time = new Date('2026-01-01T00:06:00Z');
    const active = await quote(app, headers);
    await request(app).post('/api/mobile-topups/transactions').set(headers)
      .set('Idempotency-Key', 'topup-guard-one').send({ quoteId: active.body.quote.id }).expect(201);
    const reused = await request(app).post('/api/mobile-topups/transactions').set(headers)
      .set('Idempotency-Key', 'topup-guard-two').send({ quoteId: active.body.quote.id }).expect(409);
    expect(reused.body.code).toBe('TOPUP_QUOTE_ALREADY_USED');
    const another = await quote(app, headers);
    const conflict = await request(app).post('/api/mobile-topups/transactions').set(headers)
      .set('Idempotency-Key', 'topup-guard-one').send({ quoteId: another.body.quote.id }).expect(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('refreshes authoritative provider status, history, receipt data and repeat quotes', async () => {
    const provider = new TestProvider();
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: provider });
    const headers = await auth(app, 'status');
    const quoted = await quote(app, headers);
    const purchase = await request(app).post('/api/mobile-topups/transactions').set(headers)
      .set('Idempotency-Key', 'topup-status-one').send({ quoteId: quoted.body.quote.id }).expect(201);
    const id = purchase.body.transaction.id;
    const refreshed = await request(app).get(`/api/mobile-topups/transactions/${id}?refresh=true`).set(headers).expect(200);
    expect(refreshed.body.transaction).toMatchObject({ status: 'DELIVERED', deliveredValue: 650, deliveredCurrency: 'HTG' });
    provider.status = { ...provider.status, status: 'REFUNDED' };
    const refunded = await request(app).get(`/api/mobile-topups/transactions/${id}?refresh=true`).set(headers).expect(200);
    expect(refunded.body.transaction).toMatchObject({ status: 'REFUNDED', paymentStatus: 'REFUNDED' });
    const history = await request(app).get('/api/mobile-topups/transactions').set(headers).expect(200);
    expect(history.body.transactions).toHaveLength(1);
    const repeated = await request(app).post(`/api/mobile-topups/transactions/${id}/repeat`).set(headers).expect(201);
    expect(repeated.body.quote).toMatchObject({ recipientPhone: '+50937123456', productId: 'reloadly:99:data:5.00' });
  });
});
