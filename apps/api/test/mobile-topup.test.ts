import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, resetStore } from '../src/app.js';
import type {
  MobileTopUpConfig,
  MobileTopUpCountry,
  MobileTopUpOperator,
  MobileTopUpProvider,
  ProviderTopUpResult,
} from '../src/topup/types.js';
import { MobileTopUpError } from '../src/topup/types.js';

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

const haitiOperator: MobileTopUpOperator = {
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

const jamaicaOperator: MobileTopUpOperator = {
  id: 77,
  name: 'Provider Jamaica Sandbox',
  countryCode: 'JM',
  status: true,
  bundle: false,
  denominationType: 'FIXED',
  senderCurrencyCode: 'USD',
  destinationCurrencyCode: 'JMD',
  fixedAmounts: [7.5],
  localFixedAmounts: [1170],
  fixedAmountsPlanNames: {},
  localFixedAmountsPlanNames: {},
};

const supportedCountries: MobileTopUpCountry[] = [
  { code: 'HT', name: 'Haiti' },
  { code: 'JM', name: 'Jamaica' },
];

class TestProvider implements MobileTopUpProvider {
  countries = [...supportedCountries];
  operatorsByCountry = new Map<string, MobileTopUpOperator[]>([
    ['HT', [haitiOperator]],
    ['JM', [jamaicaOperator]],
  ]);
  operatorsById = new Map<number, MobileTopUpOperator>([
    [haitiOperator.id, haitiOperator],
    [jamaicaOperator.id, jamaicaOperator],
  ]);
  detectedByCountry = new Map<string, MobileTopUpOperator>([
    ['HT', haitiOperator],
    ['JM', jamaicaOperator],
  ]);
  submit = vi.fn(async (input: Parameters<MobileTopUpProvider['submitTopUp']>[0]): Promise<ProviderTopUpResult> => ({
    transactionId: 'reloadly-transaction-1',
    status: 'PROCESSING',
    requestedAmount: input.amount,
    requestedAmountCurrencyCode: 'USD',
  }));
  status: ProviderTopUpResult = {
    transactionId: 'reloadly-transaction-1',
    status: 'SUCCESSFUL',
    requestedAmount: 7.5,
    requestedAmountCurrencyCode: 'USD',
    deliveredAmount: 1170,
    deliveredAmountCurrencyCode: 'JMD',
  };

  async listCountries() { return this.countries; }
  async listOperators(countryCode: string) { return this.operatorsByCountry.get(countryCode) ?? []; }
  async detectOperator(_phone: string, countryCode: string) {
    return this.detectedByCountry.get(countryCode) ?? jamaicaOperator;
  }
  async getOperator(operatorId: number) {
    const operator = this.operatorsById.get(operatorId);
    if (!operator) throw new Error(`Unknown operator ${operatorId}`);
    return operator;
  }
  async submitTopUp(input: Parameters<MobileTopUpProvider['submitTopUp']>[0]) { return this.submit(input); }
  async getTopUpStatus() { return this.status; }
}

async function auth(app: ReturnType<typeof createApp>, suffix = 'one') {
  const result = await request(app).post('/api/auth/register').send({
    email: `topup-${suffix}@example.com`, password: 'correct-horse-42', firstName: 'Ti', lastName: 'Cash',
  }).expect(201);
  return { Authorization: 'Bearer ' + result.body.accessToken };
}

async function quote(
  app: ReturnType<typeof createApp>,
  headers: Record<string, string>,
  input: { countryCode?: string; phone?: string; operatorId?: number; productId?: string; amount?: number } = {},
) {
  return request(app).post('/api/mobile-topups/quotes').set(headers).send({
    countryCode: input.countryCode ?? 'JM',
    phone: input.phone ?? '+18765551234',
    operatorId: input.operatorId ?? 77,
    productId: input.productId ?? 'reloadly:JM:77:airtime:7.50',
    ...(input.amount === undefined ? {} : { amount: input.amount }),
  }).expect(201);
}

describe('Worldwide mobile recharge sandbox API', () => {
  beforeEach(resetStore);

  it('reports a fail-closed sandbox environment and provider-backed countries', async () => {
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: new TestProvider() });
    const headers = await auth(app, 'status');
    const response = await request(app).get('/api/mobile-topups/status').set(headers).expect(200);
    expect(response.body).toMatchObject({
      enabled: true,
      environment: 'SANDBOX',
      billingCurrency: 'USD',
      paymentMode: 'MOCK',
      testMode: true,
      supportedGeographicScope: 'Provider-supported Reloadly Sandbox catalog countries only',
      productionEnabled: false,
      approvedForLiveUse: false,
      liveRechargeEnabled: false,
    });

    const countries = await request(app).get('/api/mobile-topups/countries').set(headers).expect(200);
    expect(countries.body.countries).toEqual(supportedCountries);
  });

  it('returns a controlled disabled response without provider credentials', async () => {
    const app = createApp({ mobileTopUpConfig: { ...config, enabled: false, clientId: undefined, clientSecret: undefined } });
    const headers = await auth(app, 'disabled');
    const response = await request(app).get('/api/mobile-topups/operators?country=HT').set(headers).expect(503);
    expect(response.body.code).toBe('MOBILE_TOPUP_DISABLED');
  });

  it('returns the expected error shape when provider-backed countries are unavailable', async () => {
    const provider = new TestProvider();
    provider.listCountries = async () => {
      throw new MobileTopUpError('RELOADLY_UNAVAILABLE', 'Mobile recharge is unavailable', 502);
    };
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: provider });
    const headers = await auth(app, 'countries-error');
    const response = await request(app).get('/api/mobile-topups/countries').set(headers).expect(502);
    expect(response.body.code).toBe('RELOADLY_UNAVAILABLE');
  });

  it('requires a valid country and safe international phone normalization while keeping HT working', async () => {
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: new TestProvider() });
    const headers = await auth(app, 'validation');

    const invalidCountry = await request(app).get('/api/mobile-topups/operators?country=1').set(headers).expect(400);
    expect(invalidCountry.body.code).toBe('INVALID_TOPUP_COUNTRY');

    const detected = await request(app)
      .get('/api/mobile-topups/operators/detect?country=HT&phone=3712-3456')
      .set(headers)
      .expect(200);
    expect(detected.body.operator).toMatchObject({ id: 99, countryCode: 'HT' });

    const invalidPhone = await request(app).post('/api/mobile-topups/quotes').set(headers).send({
      countryCode: 'JM',
      phone: '8765551234',
      operatorId: 77,
      productId: 'reloadly:JM:77:airtime:7.50',
    }).expect(400);
    expect(invalidPhone.body.code).toBe('INVALID_TOPUP_PHONE');
  });

  it('uses provider-returned operators and products for multiple supported countries', async () => {
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: new TestProvider() });
    const headers = await auth(app, 'catalog');

    const operators = await request(app).get('/api/mobile-topups/operators?country=jm').set(headers).expect(200);
    expect(operators.body.operators).toEqual([
      expect.objectContaining({ id: 77, countryCode: 'JM', destinationCurrencyCode: 'JMD' }),
    ]);

    const products = await request(app).get('/api/mobile-topups/operators/77/products?country=JM').set(headers).expect(200);
    expect(products.body.products).toEqual([
      expect.objectContaining({
        id: 'reloadly:JM:77:airtime:7.50',
        countryCode: 'JM',
        price: 7.5,
        deliveredCurrency: 'JMD',
      }),
    ]);
  });

  it('fails closed on provider country mismatches for detection and products', async () => {
    const provider = new TestProvider();
    provider.detectedByCountry.set('HT', jamaicaOperator);
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: provider });
    const headers = await auth(app, 'mismatch');

    const detected = await request(app)
      .get('/api/mobile-topups/operators/detect?country=HT&phone=37123456')
      .set(headers)
      .expect(400);
    expect(detected.body.code).toBe('TOPUP_OPERATOR_COUNTRY_MISMATCH');

    const productMismatch = await request(app)
      .get('/api/mobile-topups/operators/77/products?country=HT')
      .set(headers)
      .expect(400);
    expect(productMismatch.body.code).toBe('TOPUP_OPERATOR_COUNTRY_MISMATCH');
  });

  it('persists country on recipients, quotes and transactions, binds purchases to the quote country, and stays idempotent', async () => {
    const provider = new TestProvider();
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: provider });
    const headers = await auth(app, 'purchase');

    const savedJamaica = await request(app).post('/api/mobile-topups/recipients').set(headers).send({
      nickname: 'Auntie',
      phone: '+1 (876) 555-1234',
      countryCode: 'jm',
      operatorId: 77,
    }).expect(201);
    expect(savedJamaica.body.recipient).toMatchObject({
      countryCode: 'JM',
      phone: '+18765551234',
      operatorId: 77,
      operatorName: jamaicaOperator.name,
    });

    const savedHaiti = await request(app).post('/api/mobile-topups/recipients').set(headers).send({
      nickname: 'Mom',
      phone: '37123456',
      countryCode: 'HT',
      operatorId: 99,
    }).expect(201);

    const quoted = await quote(app, headers);
    expect(quoted.body.quote).toMatchObject({
      countryCode: 'JM',
      recipientPhone: '+18765551234',
      providerAmount: 7.5,
      feeUsd: 0.5,
      totalChargeUsd: 8,
      deliveredValue: 1170,
      deliveredCurrency: 'JMD',
    });

    await request(app).post('/api/mobile-topups/transactions').set(headers)
      .set('Idempotency-Key', 'topup-recipient-country')
      .send({ quoteId: quoted.body.quote.id, recipientId: savedHaiti.body.recipient.id })
      .expect(400);

    const payload = { quoteId: quoted.body.quote.id, recipientId: savedJamaica.body.recipient.id };
    const first = await request(app).post('/api/mobile-topups/transactions').set(headers)
      .set('Idempotency-Key', 'topup-purchase-one').send(payload).expect(201);
    const replay = await request(app).post('/api/mobile-topups/transactions').set(headers)
      .set('Idempotency-Key', 'topup-purchase-one').send(payload).expect(201);
    expect(replay.body.transaction.id).toBe(first.body.transaction.id);
    expect(provider.submit).toHaveBeenCalledTimes(1);
    expect(provider.submit.mock.calls[0]?.[0]).toMatchObject({
      recipientCountryCode: 'JM',
      recipientPhone: '+18765551234',
    });
    expect(first.body.transaction).toMatchObject({
      countryCode: 'JM',
      status: 'PROCESSING',
      paymentStatus: 'AUTHORIZED',
      testMode: true,
    });
  });

  it('supports safe empty catalogs, refresh/refund history, and repeat revalidation', async () => {
    let time = new Date('2026-01-01T00:00:00Z');
    const provider = new TestProvider();
    provider.countries = [];
    provider.operatorsByCountry.set('DO', []);
    const app = createApp({
      mobileTopUpConfig: config,
      mobileTopUpProvider: provider,
      mobileTopUpClock: () => time,
    });
    const headers = await auth(app, 'history');

    await expect(request(app).get('/api/mobile-topups/countries').set(headers))
      .resolves.toMatchObject({ status: 200, body: { countries: [] } });
    await expect(request(app).get('/api/mobile-topups/operators?country=DO').set(headers))
      .resolves.toMatchObject({ status: 200, body: { operators: [] } });

    const quoted = await quote(app, headers);
    const purchase = await request(app).post('/api/mobile-topups/transactions').set(headers)
      .set('Idempotency-Key', 'topup-status-one').send({ quoteId: quoted.body.quote.id }).expect(201);
    const id = purchase.body.transaction.id;

    const refreshed = await request(app).get(`/api/mobile-topups/transactions/${id}?refresh=true`).set(headers).expect(200);
    expect(refreshed.body.transaction).toMatchObject({
      countryCode: 'JM',
      status: 'DELIVERED',
      deliveredValue: 1170,
      deliveredCurrency: 'JMD',
    });

    provider.status = { ...provider.status, status: 'REFUNDED' };
    const refunded = await request(app).get(`/api/mobile-topups/transactions/${id}?refresh=true`).set(headers).expect(200);
    expect(refunded.body.transaction).toMatchObject({ status: 'REFUNDED', paymentStatus: 'REFUNDED' });

    const history = await request(app).get('/api/mobile-topups/transactions').set(headers).expect(200);
    expect(history.body.transactions).toHaveLength(1);
    expect(history.body.transactions[0].countryCode).toBe('JM');

    const expiredQuote = await quote(app, headers);
    time = new Date('2026-01-01T00:05:01Z');
    const expired = await request(app).post('/api/mobile-topups/transactions').set(headers)
      .set('Idempotency-Key', 'topup-expired-one').send({ quoteId: expiredQuote.body.quote.id }).expect(409);
    expect(expired.body.code).toBe('TOPUP_QUOTE_EXPIRED');

    provider.operatorsById.set(77, { ...jamaicaOperator, status: false });
    provider.operatorsByCountry.set('JM', [{ ...jamaicaOperator, status: false }]);
    const repeated = await request(app).post(`/api/mobile-topups/transactions/${id}/repeat`).set(headers).expect(404);
    expect(repeated.body.code).toBe('TOPUP_OPERATOR_UNAVAILABLE');
  });
});
