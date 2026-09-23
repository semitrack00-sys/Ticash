import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, resetStore } from '../src/app.js';
import {
  PasswordResetEmailDeliveryError,
  type PasswordResetEmailService,
} from '../src/password-reset-email.js';

const account = {
  email: 'recover@example.com',
  password: 'correct-horse-42',
  firstName: 'Recover',
  lastName: 'Customer',
};

class MemoryPasswordResetEmailService implements PasswordResetEmailService {
  readonly configured = true;
  readonly deliveries: Array<{ to: string; resetUrl: string; expiresAt: Date }> = [];

  async sendPasswordReset(input: {
    to: string;
    resetUrl: string;
    expiresAt: Date;
  }): Promise<void> {
    this.deliveries.push(input);
  }
}

class FailingPasswordResetEmailService implements PasswordResetEmailService {
  readonly configured = true;

  async sendPasswordReset(): Promise<void> {
    throw new PasswordResetEmailDeliveryError();
  }
}

function issuedResetToken(service: MemoryPasswordResetEmailService): string {
  const latest = service.deliveries.at(-1);
  expect(latest).toBeDefined();
  const token = new URL(latest!.resetUrl).searchParams.get('token');
  expect(token).toBeTruthy();
  return token!;
}

describe('password recovery', () => {
  const originalResetUrlBase = process.env.PASSWORD_RESET_URL_BASE;

  beforeEach(() => {
    resetStore();
    process.env.PASSWORD_RESET_URL_BASE = 'https://ticash.test/recharge/reset-password';
  });
  afterEach(() => {
    vi.useRealTimers();
    if (originalResetUrlBase === undefined) delete process.env.PASSWORD_RESET_URL_BASE;
    else process.env.PASSWORD_RESET_URL_BASE = originalResetUrlBase;
  });

  it('returns the same public forgot-password response for known and unknown emails', async () => {
    const emailService = new MemoryPasswordResetEmailService();
    const app = createApp({ passwordResetEmailService: emailService });
    await request(app).post('/api/auth/register').send(account).expect(201);

    const existing = await request(app).post('/api/auth/forgot-password').send({
      email: account.email,
    }).expect(202);
    const unknown = await request(app).post('/api/auth/forgot-password').send({
      email: 'missing@example.com',
    }).expect(202);

    expect(existing.body).toEqual({
      message: 'If an account exists for this email, we sent password reset instructions.',
    });
    expect(unknown.body).toEqual(existing.body);
    expect(existing.body.resetToken).toBeUndefined();
    expect(emailService.deliveries).toHaveLength(1);
  });

  it('returns an error when a configured provider cannot deliver the reset email', async () => {
    const app = createApp({ passwordResetEmailService: new FailingPasswordResetEmailService() });
    await request(app).post('/api/auth/register').send(account).expect(201);

    const response = await request(app).post('/api/auth/forgot-password').send({
      email: account.email,
    }).expect(503);

    expect(response.body.code).toBe('PASSWORD_RESET_UNAVAILABLE');
  });

  it('resets the password, revokes all refresh sessions, and rejects token reuse', async () => {
    const emailService = new MemoryPasswordResetEmailService();
    const app = createApp({ passwordResetEmailService: emailService });
    const registered = await request(app).post('/api/auth/register').send(account).expect(201);
    const loggedIn = await request(app).post('/api/auth/login').send({
      email: account.email,
      password: account.password,
    }).expect(200);

    await request(app).post('/api/auth/forgot-password').send({
      email: account.email,
    }).expect(202);

    const token = issuedResetToken(emailService);
    await request(app).post('/api/auth/reset-password').send({
      token,
      newPassword: 'NewSecurePass123',
    }).expect(204);

    await request(app).post('/api/auth/refresh').send({
      refreshToken: registered.body.refreshToken,
    }).expect(401);
    await request(app).post('/api/auth/refresh').send({
      refreshToken: loggedIn.body.refreshToken,
    }).expect(401);
    await request(app).post('/api/auth/login').send({
      email: account.email,
      password: account.password,
    }).expect(401);
    await request(app).post('/api/auth/login').send({
      email: account.email,
      password: 'NewSecurePass123',
    }).expect(200);

    const reused = await request(app).post('/api/auth/reset-password').send({
      token,
      newPassword: 'AnotherSecurePass123',
    }).expect(400);
    expect(reused.body.code).toBe('INVALID_RESET_TOKEN');
  });

  it('invalidates older reset links when a newer one is requested', async () => {
    const emailService = new MemoryPasswordResetEmailService();
    const app = createApp({ passwordResetEmailService: emailService });
    await request(app).post('/api/auth/register').send(account).expect(201);

    await request(app).post('/api/auth/forgot-password').send({
      email: account.email,
    }).expect(202);
    const firstToken = issuedResetToken(emailService);

    await request(app).post('/api/auth/forgot-password').send({
      email: account.email,
    }).expect(202);
    const secondToken = issuedResetToken(emailService);

    const firstAttempt = await request(app).post('/api/auth/reset-password').send({
      token: firstToken,
      newPassword: 'AnotherSecurePass123',
    }).expect(400);
    expect(firstAttempt.body.code).toBe('INVALID_RESET_TOKEN');

    await request(app).post('/api/auth/reset-password').send({
      token: secondToken,
      newPassword: 'AnotherSecurePass123',
    }).expect(204);
  });

  it('rejects expired reset tokens', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-23T12:00:00.000Z'));

    const emailService = new MemoryPasswordResetEmailService();
    const app = createApp({ passwordResetEmailService: emailService });
    await request(app).post('/api/auth/register').send(account).expect(201);
    await request(app).post('/api/auth/forgot-password').send({
      email: account.email,
    }).expect(202);

    const token = issuedResetToken(emailService);
    vi.advanceTimersByTime(31 * 60 * 1000);

    const response = await request(app).post('/api/auth/reset-password').send({
      token,
      newPassword: 'ExpiredPass123',
    }).expect(400);
    expect(response.body.code).toBe('INVALID_RESET_TOKEN');
  });

  it('rejects malformed and wrong reset tokens', async () => {
    const emailService = new MemoryPasswordResetEmailService();
    const app = createApp({ passwordResetEmailService: emailService });
    await request(app).post('/api/auth/register').send(account).expect(201);
    await request(app).post('/api/auth/forgot-password').send({
      email: account.email,
    }).expect(202);

    await request(app).post('/api/auth/reset-password').send({
      token: 'not a valid token',
      newPassword: 'AnotherSecurePass123',
    }).expect(400);

    const wrong = await request(app).post('/api/auth/reset-password').send({
      token: randomBytes(32).toString('base64url'),
      newPassword: 'AnotherSecurePass123',
    }).expect(400);
    expect(wrong.body.code).toBe('INVALID_RESET_TOKEN');
  });

  it('enforces the existing password rules during reset', async () => {
    const emailService = new MemoryPasswordResetEmailService();
    const app = createApp({ passwordResetEmailService: emailService });
    await request(app).post('/api/auth/register').send(account).expect(201);
    await request(app).post('/api/auth/forgot-password').send({
      email: account.email,
    }).expect(202);

    const token = issuedResetToken(emailService);
    const response = await request(app).post('/api/auth/reset-password').send({
      token,
      newPassword: 'short',
    }).expect(400);

    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it('rejects resetting to the current password', async () => {
    const samePasswordAccount = {
      ...account,
      email: 'strong-recover@example.com',
      password: 'CurrentSecurePass123',
    };
    const emailService = new MemoryPasswordResetEmailService();
    const app = createApp({ passwordResetEmailService: emailService });
    await request(app).post('/api/auth/register').send(samePasswordAccount).expect(201);
    await request(app).post('/api/auth/forgot-password').send({
      email: samePasswordAccount.email,
    }).expect(202);

    const token = issuedResetToken(emailService);
    const response = await request(app).post('/api/auth/reset-password').send({
      token,
      newPassword: samePasswordAccount.password,
    }).expect(400);

    expect(response.body.code).toBe('INVALID_PASSWORD');
    expect(response.body.error).toBe('New password must be different from the current password');
  });

  it('rate limits forgot-password attempts', async () => {
    const app = createApp({ passwordResetEmailService: new MemoryPasswordResetEmailService() });

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app).post('/api/auth/forgot-password').send({
        email: `rate-limit-${attempt}@example.com`,
      }).expect(202);
    }

    const limited = await request(app).post('/api/auth/forgot-password').send({
      email: 'rate-limit-6@example.com',
    }).expect(429);
    expect(limited.body.code).toBe('RATE_LIMITED');
  });
});
