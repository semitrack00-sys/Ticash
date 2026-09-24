import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, resetStore } from '../src/app.js';
import type { MobileTopUpConfig } from '../src/topup/types.js';

const config: MobileTopUpConfig = {
  enabled: true, environment: 'sandbox', paymentMode: 'mock', productionEnabled: false, approvedForLiveUse: false,
  authUrl: 'https://auth.reloadly.com/oauth/token', airtimeBaseUrl: 'https://topups-sandbox.reloadly.com',
  billingCurrency: 'USD', quoteTtlSeconds: 300,
};

describe('explicit proxy trust and guest rate limiting', () => {
  beforeEach(() => {
    resetStore();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('TRUST_PROXY_HOPS', undefined);
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([undefined, '', '  '])('leaves direct local/test proxy trust disabled for %j', async (value) => {
    vi.stubEnv('TRUST_PROXY_HOPS', value);
    const app = createApp({ mobileTopUpConfig: config });
    expect(app.get('trust proxy')).toBe(false);
    const guest = await request(app).post('/api/auth/guest').expect(201);
    await request(app).get('/api/mobile-topups/status').set('Authorization', `Bearer ${guest.body.accessToken}`).expect(200);
  });

  it.each(['0', '-1', '11', '1.5', '1e0', '1junk', 'true', 'false', 'NaN', 'Infinity'])('rejects invalid proxy configuration %j', (value) => {
    vi.stubEnv('TRUST_PROXY_HOPS', value);
    expect(() => createApp({ mobileTopUpConfig: config })).toThrow('TRUST_PROXY_HOPS must be blank or an integer from 1 to 10');
  });

  it.each(['1', ' 2 ', '10'])('uses a bounded numeric proxy setting for %j', (value) => {
    vi.stubEnv('TRUST_PROXY_HOPS', value);
    const app = createApp({ mobileTopUpConfig: config });
    expect(app.get('trust proxy')).toBe(Number(value));
    expect(app.get('trust proxy')).not.toBe(true);
  });

  it('limits each forwarded client independently and ignores forged entries beyond the trusted hop', async () => {
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    const app = createApp({ mobileTopUpConfig: config });
    for (let index = 0; index < 5; index++) {
      await request(app).post('/api/auth/guest').set('X-Forwarded-For', '198.51.100.10').expect(201);
    }
    const limited = await request(app).post('/api/auth/guest').set('X-Forwarded-For', '198.51.100.10').expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
    await request(app).post('/api/auth/guest').set('X-Forwarded-For', '203.0.113.99, 198.51.100.10').expect(429);
    await request(app).post('/api/auth/guest').set('X-Forwarded-For', '198.51.100.11').expect(201);
  });

  it.each([undefined, '', '  '])('fails closed for production guests without proxy hops (%j), while permanent customers still work', async (value) => {
    const local = createApp({ mobileTopUpConfig: config });
    const guest = await request(local).post('/api/auth/guest').expect(201);
    const logoutGuest = await request(local).post('/api/auth/guest').expect(201);
    const customer = await request(local).post('/api/auth/register').send({
      email: 'proxy-customer@example.com', password: 'correct-horse-42', firstName: 'Real', lastName: 'Customer',
    }).expect(201);
    // Keep isolated in-memory storage while exercising production app configuration.
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TRUST_PROXY_HOPS', value);
    const production = createApp({ mobileTopUpConfig: config });
    expect(production.get('trust proxy')).toBe(false);
    const create = await request(production).post('/api/auth/guest').expect(403);
    expect(create.body.code).toBe('GUEST_PROXY_CONFIGURATION_REQUIRED');
    expect(create.body).not.toHaveProperty('accessToken');
    expect(create.body).not.toHaveProperty('refreshToken');
    const access = await request(production).get('/api/mobile-topups/status').set('Authorization', `Bearer ${guest.body.accessToken}`).expect(403);
    expect(access.body.code).toBe('GUEST_PROXY_CONFIGURATION_REQUIRED');
    const refresh = await request(production).post('/api/auth/refresh').send({ refreshToken: guest.body.refreshToken }).expect(403);
    expect(refresh.body.code).toBe('GUEST_PROXY_CONFIGURATION_REQUIRED');
    await request(production).post('/api/auth/logout').send({ refreshToken: logoutGuest.body.refreshToken }).expect(204);
    await request(production).post('/api/auth/refresh').send({ refreshToken: logoutGuest.body.refreshToken }).expect(401);
    await request(production).get('/api/users/me').set('Authorization', `Bearer ${customer.body.accessToken}`).expect(200);
    await request(production).post('/api/auth/refresh').send({ refreshToken: customer.body.refreshToken }).expect(200);
  });

  it('allows existing sandbox guests in production when the proxy hops are explicitly configured', async () => {
    const local = createApp({ mobileTopUpConfig: config });
    const guest = await request(local).post('/api/auth/guest').expect(201);
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    const production = createApp({ mobileTopUpConfig: config });
    await request(production).get('/api/mobile-topups/status').set('Authorization', `Bearer ${guest.body.accessToken}`).expect(200);
    await request(production).post('/api/auth/refresh').send({ refreshToken: guest.body.refreshToken }).expect(200);
  });
});
