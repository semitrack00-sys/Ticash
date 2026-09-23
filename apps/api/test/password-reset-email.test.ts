import { describe, expect, it } from 'vitest';
import {
  loadPasswordResetEmailService,
  PasswordResetEmailDeliveryError,
  passwordResetUrl,
} from '../src/password-reset-email.js';

describe('password reset email configuration', () => {
  it('accepts an HTTPS reset URL in production', () => {
    const environment = {
      NODE_ENV: 'production',
      PASSWORD_RESET_EMAIL_PROVIDER: 'resend',
      PASSWORD_RESET_EMAIL_FROM: 'noreply@ticash.test',
      PASSWORD_RESET_URL_BASE: 'https://ticash.test/recharge/reset-password',
      RESEND_API_KEY: 'resend_test_key',
    } satisfies NodeJS.ProcessEnv;

    const service = loadPasswordResetEmailService(environment);
    expect(service.configured).toBe(true);
    expect(passwordResetUrl('secure-token', environment))
      .toBe('https://ticash.test/recharge/reset-password?token=secure-token');
  });

  it('rejects an HTTP reset URL in production and fails closed', () => {
    const environment = {
      NODE_ENV: 'production',
      PASSWORD_RESET_EMAIL_PROVIDER: 'resend',
      PASSWORD_RESET_EMAIL_FROM: 'noreply@ticash.test',
      PASSWORD_RESET_URL_BASE: 'http://ticash.test/recharge/reset-password',
      RESEND_API_KEY: 'resend_test_key',
    } satisfies NodeJS.ProcessEnv;

    const service = loadPasswordResetEmailService(environment);
    expect(service.configured).toBe(false);
    expect(() => passwordResetUrl('secure-token', environment))
      .toThrow(PasswordResetEmailDeliveryError);
  });
});
