import request from 'supertest';
import jwt from 'jsonwebtoken';
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
import { getCountries, getCountryCallingCode } from 'libphonenumber-js';

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

  it('requires authentication on mobile top-up endpoints', async () => {
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: new TestProvider() });
    await request(app).get('/api/mobile-topups/countries').expect(401);
  });

  it('supports explicit CORS allowlists and preflight headers without wildcard origins', async () => {
    const previousAllowed = process.env.CORS_ALLOWED_ORIGINS;
    const previousOrigin = process.env.CORS_ORIGIN;
    process.env.CORS_ALLOWED_ORIGINS = 'https://ticash-app.com,https://www.ticash-app.com';
    process.env.CORS_ORIGIN = '';
    try {
      const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: new TestProvider() });
      const headers = await auth(app, 'cors');
      const allowed = await request(app)
        .get('/api/mobile-topups/status')
        .set(headers)
        .set('Origin', 'https://ticash-app.com')
        .expect(200);
      expect(allowed.headers['access-control-allow-origin']).toBe('https://ticash-app.com');

      const preflight = await request(app)
        .options('/api/mobile-topups/transactions')
        .set('Origin', 'https://ticash-app.com')
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'Authorization, Content-Type, Idempotency-Key')
        .expect(204);
      expect(preflight.headers['access-control-allow-origin']).toBe('https://ticash-app.com');
      expect(preflight.headers['access-control-allow-headers']).toContain('Authorization');
      expect(preflight.headers['access-control-allow-headers']).toContain('Content-Type');
      expect(preflight.headers['access-control-allow-headers']).toContain('Idempotency-Key');
      expect(preflight.headers['access-control-allow-origin']).not.toBe('*');

      const localhost = await request(app)
        .get('/api/mobile-topups/status')
        .set(headers)
        .set('Origin', 'http://localhost:3000')
        .expect(200);
      expect(localhost.headers['access-control-allow-origin']).toBe('http://localhost:3000');

      await request(app)
        .get('/api/mobile-topups/status')
        .set(headers)
        .set('Origin', 'https://unknown.example.com')
        .expect(403);
    } finally {
      process.env.CORS_ALLOWED_ORIGINS = previousAllowed;
      process.env.CORS_ORIGIN = previousOrigin;
    }
  });

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
    expect(countries.body.countries).toEqual(supportedCountries.map((c) => ({ ...c, callingCode: c.code === 'HT' ? '+509' : '+1' })));
  });

  it('creates unique guest customers with valid rotating tokens, catalog access and a mock purchase', async () => {
    const provider = new TestProvider();
    const app = createApp({ mobileTopUpConfig: { ...config, feeUsd: '3.50' }, mobileTopUpProvider: provider });
    const guest = await request(app).post('/api/auth/guest').expect(201);
    const other = await request(app).post('/api/auth/guest').expect(201);
    expect(guest.body).toMatchObject({ guest: true, user: { role: 'CUSTOMER', kycStatus: 'NOT_STARTED' } });
    expect(guest.body.user).not.toHaveProperty('passwordHash');
    expect(other.body.user.id).not.toBe(guest.body.user.id);
    expect(other.body.user.email).not.toBe(guest.body.user.email);
    expect(Date.parse(guest.body.expiresAt) - Date.now()).toBeLessThanOrEqual(60 * 60_000);
    const headers = { Authorization: `Bearer ${guest.body.accessToken}` };
    await request(app).get('/api/mobile-topups/status').set(headers).expect(200);
    await request(app).get('/api/mobile-topups/countries').set(headers).expect(200);
    await request(app).get('/api/admin/session').set(headers).expect(403);
    const quoted = await quote(app, headers, { countryCode: 'HT', phone: '+50937050210', operatorId: 99, productId: 'reloadly:HT:99:data:5.00' });
    expect(quoted.body.quote).toMatchObject({ providerAmount: 5, feeUsd: 3.5, totalChargeUsd: 8.5 });
    const purchased = await request(app).post('/api/mobile-topups/transactions').set(headers)
      .set('Idempotency-Key', 'guest-purchase-test').send({ quoteId: quoted.body.quote.id }).expect(201);
    expect(purchased.body.transaction).toMatchObject({ testMode: true, paymentStatus: 'AUTHORIZED', totalChargeUsd: 8.5 });
    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: guest.body.refreshToken }).expect(200);
    expect(refreshed.body.refreshToken).not.toBe(guest.body.refreshToken);
    await request(app).get('/api/mobile-topups/countries').set('Authorization', `Bearer ${refreshed.body.accessToken}`).expect(200);
    await request(app).post('/api/auth/refresh').send({ refreshToken: guest.body.refreshToken }).expect(401);
    await request(app).post('/api/mobile-topups/transactions').send({ quoteId: quoted.body.quote.id }).expect(401);
    await request(app).post('/api/auth/logout').send({ refreshToken: refreshed.body.refreshToken }).expect(204);
    await request(app).post('/api/auth/refresh').send({ refreshToken: refreshed.body.refreshToken }).expect(401);
  });

  it('restricts guest credentials to recharge and preserves permanent customer account routes', async () => {
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: new TestProvider() });
    const guest = await request(app).post('/api/auth/guest').expect(201);
    const guestHeaders = { Authorization: `Bearer ${guest.body.accessToken}` };
    const profile = { firstName: 'Real', lastName: 'Customer', phoneNumber: '+50937050210' };
    const routes = [
      request(app).get('/api/users/me'),
      request(app).patch('/api/users/me').send(profile),
      request(app).put('/api/users/me/password').send({ currentPassword: 'unknown-guest-password', newPassword: 'correct-horse-43' }),
      request(app).get('/api/kyc/status'),
      request(app).post('/api/kyc/submit').send({ attested: true }),
      request(app).get('/api/funding/status'),
      request(app).post('/api/funding/dwolla/customer').send({}),
      request(app).get('/api/transfers'),
      request(app).post('/api/transfers/quote').send({}),
      request(app).get('/api/recipients'),
      request(app).get('/api/admin/session'),
    ];
    for (const route of routes) {
      const response = await route.set(guestHeaders).expect(403);
      expect(response.body.code).toBe('GUEST_SCOPE_RESTRICTED');
    }
    const headers = await auth(app, 'permanent-scope');
    await request(app).get('/api/users/me').set(headers).expect(200);
    // A rejected guest profile update must not reserve this unique phone number.
    const updated = await request(app).patch('/api/users/me').set(headers).send(profile).expect(200);
    expect(updated.body.user.phoneNumber).toBe(profile.phoneNumber);
    await request(app).put('/api/users/me/password').set(headers)
      .send({ currentPassword: 'correct-horse-42', newPassword: 'correct-horse-43' }).expect(204);
    await request(app).get('/api/kyc/status').set(headers).expect(200);
    await request(app).get('/api/funding/status').set(headers).expect(200);
    await request(app).get('/api/transfers').set(headers).expect(200);
  });

  it.each([
    { environment: 'production' }, { paymentMode: 'live' }, { productionEnabled: true },
    { approvedForLiveUse: true }, { enabled: false }, { productionEnabled: undefined },
    { airtimeBaseUrl: 'https://topups.reloadly.com' },
  ])('rejects guest access when configuration is unsafe or incomplete: %j', async (unsafe) => {
    const app = createApp({ mobileTopUpConfig: { ...config, ...unsafe } as MobileTopUpConfig, mobileTopUpProvider: new TestProvider() });
    const response = await request(app).post('/api/auth/guest').expect(403);
    expect(response.body.code).toBe('GUEST_SANDBOX_REQUIRED');
    expect(response.body).not.toHaveProperty('accessToken');
  });

  it('rejects guest-supplied identity/privileges and rate-limits successful guest creation', async () => {
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: new TestProvider() });
    await request(app).post('/api/auth/guest').send({ role: 'ADMIN', email: 'fake@example.com' }).expect(400);
    for (let index = 0; index < 4; index++) await request(app).post('/api/auth/guest').expect(201);
    const limited = await request(app).post('/api/auth/guest').expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
  });

  it('retains account-lock and funding restrictions for guests', async () => {
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: new TestProvider() });
    const guest = await request(app).post('/api/auth/guest').expect(201);
    const admin = await request(app).post('/api/auth/login').send({ email: 'admin@ticash.local', password: 'AdminPass123!' }).expect(200);
    const headers = { Authorization: `Bearer ${guest.body.accessToken}` };
    for (const locked of [false, true]) {
      await request(app).patch(`/api/admin/users/${guest.body.user.id}/restrictions`)
        .set('Authorization', `Bearer ${admin.body.accessToken}`)
        .send({ accountLocked: locked, fundingRestricted: true, payoutRestricted: true, reason: 'Guest security regression' }).expect(200);
      const response = await request(app).get('/api/mobile-topups/countries').set(headers).expect(locked ? 423 : 403);
      expect(response.body.code).toBe(locked ? 'ACCOUNT_LOCKED' : 'FUNDING_RESTRICTED');
    }
    // Restricting the account revokes its existing refresh sessions.
    await request(app).post('/api/auth/refresh').send({ refreshToken: guest.body.refreshToken }).expect(401);
    const promote = await request(app).patch(`/api/admin/staff/${guest.body.user.id}/role`)
      .set('Authorization', `Bearer ${admin.body.accessToken}`).send({ role: 'SUPER_ADMIN', reason: 'Attempt guest promotion' }).expect(403);
    expect(promote.body.code).toBe('GUEST_ROLE_RESTRICTED');
  });

  it('expires guest access and refresh without extending lifetime or altering normal accounts', async () => {
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: new TestProvider() });
    const guest = await request(app).post('/api/auth/guest').expect(201);
    const account = { email: 'persistent@example.com', password: 'correct-horse-42', firstName: 'Real', lastName: 'Customer' };
    const registered = await request(app).post('/api/auth/register').send(account).expect(201);
    await request(app).post('/api/auth/logout').send({ refreshToken: registered.body.refreshToken }).expect(204);
    const login = await request(app).post('/api/auth/login').send(account).expect(200);
    expect(login.body.user.id).toBe(registered.body.user.id);
    expect(login.body.user.role).toBe('CUSTOMER');
    const guestDeadline = Date.parse(guest.body.expiresAt);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(guestDeadline - 5 * 60_000);
    try {
      const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: guest.body.refreshToken }).expect(200);
      const token = jwt.decode(refreshed.body.accessToken) as jwt.JwtPayload;
      expect(token.exp! * 1000).toBeLessThanOrEqual(guestDeadline);
      expect(token.exp! - token.iat!).toBeLessThanOrEqual(15 * 60);
      await request(app).get('/api/mobile-topups/status').set('Authorization', `Bearer ${refreshed.body.accessToken}`).expect(200);
      clock.mockReturnValue(guestDeadline + 1000);
      await request(app).get('/api/mobile-topups/countries').set('Authorization', `Bearer ${guest.body.accessToken}`).expect(401);
      await request(app).post('/api/auth/refresh').send({ refreshToken: refreshed.body.refreshToken }).expect(401);
      await request(app).post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken }).expect(200);
    } finally { vi.restoreAllMocks(); }
  });

  it('uses the complete calling-code dataset and preserves shared-prefix ISO identities', async () => {
    const provider = new TestProvider(); provider.countries = getCountries().map((code) => ({ code, name: code }));
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: provider });
    const headers = await auth(app, 'all-countries');
    const response = await request(app).get('/api/mobile-topups/countries').set(headers).expect(200);
    expect(response.body.countries).toHaveLength(getCountries().length);
    for (const destination of response.body.countries) {
      expect(destination.callingCode).toMatch(/^\+[1-9]\d{0,2}$/);
      expect(destination.callingCode).toBe(`+${getCountryCallingCode(destination.code)}`);
    }
    for (const [code, callingCode] of Object.entries({ HT: '+509', US: '+1', CA: '+1', DO: '+1', JM: '+1', FR: '+33', BR: '+55', MX: '+52', GB: '+44', NG: '+234' })) {
      expect(response.body.countries).toContainEqual({ code, name: code, callingCode });
    }
  });

  it('omits legacy AN while returning and caching Haiti with its real calling code', async () => {
    const provider = new TestProvider();
    provider.countries = [{ code: 'HT', name: 'Haiti' }, { code: 'AN', name: 'Netherlands Antilles' }];
    const list = vi.spyOn(provider, 'listCountries');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: provider });
    try {
      const headers = await auth(app, 'legacy-code');
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await request(app).get('/api/mobile-topups/countries').set(headers).expect(200);
        expect(response.body.countries).toEqual([{ code: 'HT', name: 'Haiti', callingCode: '+509' }]);
      }
      expect(list).toHaveBeenCalledTimes(1);
      expect(warning.mock.calls).toEqual([['Mobile recharge skipped unsupported country codes:', ['AN']]]);
    } finally { warning.mockRestore(); list.mockRestore(); }
  });

  it.each([{ codes: ['ZZ'] }, { codes: ['AN'] }, { codes: ['AN', 'ZZ'] }])('fails closed when all provider destinations lack calling-code metadata: $codes', async ({ codes }) => {
    const provider = new TestProvider(); provider.countries = codes.map((code) => ({ code, name: 'Unsupported destination' }));
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: provider });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const headers = await auth(app, 'unknown-codes');
      const response = await request(app).get('/api/mobile-topups/countries').set(headers).expect(502);
      expect(response.body.code).toBe('UNSUPPORTED_CALLING_CODE');
      expect(response.body).not.toHaveProperty('countries');
      provider.countries = [{ code: 'HT', name: 'Haiti' }];
      const recovered = await request(app).get('/api/mobile-topups/countries').set(headers).expect(200);
      expect(recovered.body.countries).toEqual([{ code: 'HT', name: 'Haiti', callingCode: '+509' }]);
    } finally { warning.mockRestore(); }
  });

  it.each([
    null, {}, { code: 'H1', name: 'Invalid' }, { code: 'HTI', name: 'Invalid' },
    { code: 'AN\nsecret', name: 'Invalid' }, { code: 42, name: 'Invalid' }, { code: 'ß', name: 'Invalid' },
    { code: 'HT', name: null }, { code: 'AN', name: null },
  ])('rejects malformed provider destinations instead of skipping them: %j', async (malformed) => {
    const provider = new TestProvider();
    provider.countries = [{ code: 'HT', name: 'Haiti' }, malformed] as MobileTopUpCountry[];
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: provider });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const response = await request(app).get('/api/mobile-topups/countries').set(await auth(app, 'malformed-code')).expect(502);
      expect(response.body).toEqual({ error: 'Provider returned an invalid recharge country', code: 'INVALID_PROVIDER_RESPONSE' });
      expect(warning).not.toHaveBeenCalled();
    } finally { warning.mockRestore(); }
  });

  it('rejects a malformed provider catalog instead of reporting an empty healthy catalog', async () => {
    const provider = new TestProvider(); provider.countries = null as unknown as MobileTopUpCountry[];
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: provider });
    const response = await request(app).get('/api/mobile-topups/countries').set(await auth(app, 'malformed-catalog')).expect(502);
    expect(response.body.code).toBe('INVALID_PROVIDER_RESPONSE');
  });

  it('blocks existing guest tokens and refresh if sandbox configuration becomes unsafe', async () => {
    const mutable = { ...config };
    const app = createApp({ mobileTopUpConfig: mutable, mobileTopUpProvider: new TestProvider() });
    const guest = await request(app).post('/api/auth/guest').expect(201);
    mutable.enabled = false;
    await request(app).get('/api/mobile-topups/countries').set('Authorization', `Bearer ${guest.body.accessToken}`).expect(403);
    await request(app).post('/api/auth/refresh').send({ refreshToken: guest.body.refreshToken }).expect(403);
  });

  it('does not trust fee/total values supplied by the customer', async () => {
    const app = createApp({ mobileTopUpConfig: { ...config, feeUsd: '3.50' }, mobileTopUpProvider: new TestProvider() });
    const headers = await auth(app, 'fee-tamper');
    await request(app).post('/api/mobile-topups/quotes').set(headers).send({
      countryCode: 'HT', phone: '+50937050210', operatorId: 99, productId: 'reloadly:HT:99:data:5.00', feeUsd: 0, totalChargeUsd: 5,
    }).expect(400);
    const response = await quote(app, headers, { countryCode: 'HT', phone: '+50937050210', operatorId: 99, productId: 'reloadly:HT:99:data:5.00' });
    expect(response.body.quote).toMatchObject({ providerAmount: 5, feeUsd: 3.5, totalChargeUsd: 8.5 });
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

    const jamaicaQuote = await request(app).post('/api/mobile-topups/quotes').set(headers).send({
      countryCode: 'JM',
      phone: '8765551234',
      operatorId: 77,
      productId: 'reloadly:JM:77:airtime:7.50',
    }).expect(201);
    expect(jamaicaQuote.body.quote.recipientPhone).toBe('+18765551234');

    const mismatch = await request(app)
      .get('/api/mobile-topups/operators/detect?country=HT&phone=%2B18765551234')
      .set(headers)
      .expect(400);
    expect(mismatch.body.code).toBe('INVALID_TOPUP_PHONE');
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

  it('requires idempotency keys and rejects conflicting duplicate purchase payloads', async () => {
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: new TestProvider() });
    const headers = await auth(app, 'idempotency');
    const quoted = await quote(app, headers);

    await request(app).post('/api/mobile-topups/transactions')
      .set(headers)
      .send({ quoteId: quoted.body.quote.id })
      .expect(400)
      .expect((response) => {
        expect(response.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
      });

    const first = await request(app).post('/api/mobile-topups/transactions')
      .set(headers)
      .set('Idempotency-Key', 'topup-conflict-key')
      .send({ quoteId: quoted.body.quote.id })
      .expect(201);

    await request(app).post('/api/mobile-topups/transactions')
      .set(headers)
      .set('Idempotency-Key', 'topup-conflict-key')
      .send({ quoteId: first.body.transaction.quoteId, recipientId: '11111111-1111-4111-8111-111111111111' })
      .expect(409)
      .expect((response) => {
        expect(response.body.code).toBe('IDEMPOTENCY_CONFLICT');
      });
  });
});
