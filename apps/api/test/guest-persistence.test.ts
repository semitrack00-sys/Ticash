import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MobileTopUpConfig } from '../src/topup/types.js';

// Exercise the real database branch without connecting to a live database.
const database = vi.hoisted(() => ({
  user: { create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  session: { create: vi.fn(), deleteMany: vi.fn() },
  auditLog: { create: vi.fn() },
  loginSecurityState: { findUnique: vi.fn(), deleteMany: vi.fn() },
}));
vi.mock('../src/database.js', () => ({ databaseEnabled: true, prisma: database }));
import { createApp } from '../src/app.js';

const config: MobileTopUpConfig = {
  enabled: true, environment: 'sandbox', paymentMode: 'mock', productionEnabled: false, approvedForLiveUse: false,
  authUrl: 'https://auth.reloadly.com/oauth/token', airtimeBaseUrl: 'https://topups-sandbox.reloadly.com',
  billingCurrency: 'USD', feeUsd: '3.50', quoteTtlSeconds: 300,
};

describe('database-backed guest and permanent accounts', () => {
  afterEach(() => vi.unstubAllEnvs());
  beforeEach(() => {
    vi.resetAllMocks();
    database.user.create.mockImplementation(async ({ data }) => ({
      id: 'db-customer', phone: null, countryCode: null, addressLine1: null, addressLine2: null, city: null,
      region: null, postalCode: null, restrictionReason: null, createdAt: new Date(),
      role: 'CUSTOMER', kycStatus: 'NOT_STARTED', accountLocked: false, fundingRestricted: false, payoutRestricted: false, ...data,
    }));
  });

  it('persists a random guest identity, hashed password and bounded refresh session as CUSTOMER', async () => {
    const response = await request(createApp({ mobileTopUpConfig: config })).post('/api/auth/guest').expect(201);
    const identity = database.user.create.mock.calls[0][0].data;
    expect(identity).toMatchObject({ role: 'CUSTOMER', kycStatus: 'NOT_STARTED', payoutRestricted: true, accountLocked: false, fundingRestricted: false });
    expect(identity.email).toMatch(/^guest-[\da-f-]+@guest\.ticash\.invalid$/);
    expect(identity.passwordHash).toMatch(/^\$2[aby]\$12\$/);
    expect(identity.guestExpiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(await bcrypt.compare(identity.email, identity.passwordHash)).toBe(false);
    const session = database.session.create.mock.calls[0][0].data;
    expect(session.expiresAt).toEqual(identity.guestExpiresAt);
    expect(session.refreshHash).toMatch(/^[a-f0-9]{64}$/);
    expect(session.refreshHash).not.toBe(response.body.refreshToken);
    expect(response.body).toMatchObject({ guest: true, user: { id: 'db-customer', role: 'CUSTOMER' } });
    expect(response.body).not.toHaveProperty('password');
    expect(response.body.user).not.toHaveProperty('passwordHash');
  });

  it('preserves permanent registration persistence, tokens and subsequent password login', async () => {
    const account = { firstName: 'Ti', lastName: 'Cash', email: 'customer@example.com', password: 'correct-horse-42' };
    const app = createApp({ mobileTopUpConfig: config });
    const registered = await request(app).post('/api/auth/register').send(account).expect(201);
    const identity = database.user.create.mock.calls[0][0].data;
    expect(identity.email).toBe(account.email); expect(identity.guestExpiresAt).toBeUndefined();
    expect(await bcrypt.compare(account.password, identity.passwordHash)).toBe(true);
    const stored = await database.user.create.mock.results[0].value;
    database.user.findUnique.mockResolvedValue(stored);
    const loggedIn = await request(app).post('/api/auth/login').send(account).expect(200);
    expect(loggedIn.body.user.id).toBe(registered.body.user.id);
    expect(loggedIn.body.accessToken).toBeTypeOf('string'); expect(loggedIn.body.refreshToken).toBeTypeOf('string');
    expect(database.user.create).toHaveBeenCalledTimes(1);
  });

  it('checks stored guest expiry even if a token has not expired', async () => {
    const app = createApp({ mobileTopUpConfig: config });
    const guest = await request(app).post('/api/auth/guest').expect(201);
    database.user.findUnique.mockResolvedValue({ accountLocked: false, guestExpiresAt: new Date(Date.now() - 1000) });
    await request(app).get('/api/mobile-topups/status').set('Authorization', `Bearer ${guest.body.accessToken}`).expect(401);
  });

  it('never grants admin permissions to a guest even if a stored role is corrupted', async () => {
    const app = createApp({ mobileTopUpConfig: config });
    const guest = await request(app).post('/api/auth/guest').expect(201);
    database.user.findUnique.mockResolvedValue({ accountLocked: false, role: 'ADMIN', guestExpiresAt: new Date(Date.now() + 60_000) });
    const response = await request(app).get('/api/admin/session').set('Authorization', `Bearer ${guest.body.accessToken}`).expect(403);
    expect(response.body.code).toBe('GUEST_SCOPE_RESTRICTED');
  });

  it('rejects guest profile writes before touching permanent account fields in the database', async () => {
    const app = createApp({ mobileTopUpConfig: config });
    const guest = await request(app).post('/api/auth/guest').expect(201);
    database.user.findUnique.mockResolvedValue(await database.user.create.mock.results[0].value);
    const response = await request(app).patch('/api/users/me').set('Authorization', `Bearer ${guest.body.accessToken}`)
      .send({ firstName: 'Guest', lastName: 'Profile', phoneNumber: '+50937050210' }).expect(403);
    expect(response.body.code).toBe('GUEST_SCOPE_RESTRICTED');
    expect(database.user.update).not.toHaveBeenCalled();
    expect(database.user.findUnique).toHaveBeenCalledTimes(1);
  });

  it('creates no database customer or tokens when production proxy configuration is absent', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TRUST_PROXY_HOPS', '');
    const response = await request(createApp({ mobileTopUpConfig: config })).post('/api/auth/guest').expect(403);
    expect(response.body.code).toBe('GUEST_PROXY_CONFIGURATION_REQUIRED');
    expect(response.body).not.toHaveProperty('accessToken');
    expect(response.body).not.toHaveProperty('refreshToken');
    expect(database.user.create).not.toHaveBeenCalled();
    expect(database.session.create).not.toHaveBeenCalled();
  });

  it('allows database-backed sandbox guest creation with explicit production proxy hops', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('TRUST_PROXY_HOPS', '1');
    const response = await request(createApp({ mobileTopUpConfig: config })).post('/api/auth/guest')
      .set('X-Forwarded-For', '198.51.100.20').expect(201);
    expect(response.body).toMatchObject({ guest: true, user: { role: 'CUSTOMER' } });
    expect(database.user.create).toHaveBeenCalledTimes(1);
    expect(database.session.create).toHaveBeenCalledTimes(1);
  });
});
