import { describe, expect, it } from 'vitest';
import { loadStripeConfig } from '../src/topup/stripe-config.js';

const completeStripeEnv = {
  STRIPE_ENABLED: 'true',
  STRIPE_ENVIRONMENT: 'sandbox',
  STRIPE_SECRET_KEY: 'sk_test_fixture_secret',
  STRIPE_PUBLIC_KEY: 'pk_test_fixture_public',
  STRIPE_WEBHOOK_SECRET: 'whsec_fixture_signing_key',
  STRIPE_SUCCESS_URL: 'https://website.example/success',
  STRIPE_FAILURE_URL: 'https://website.example/failure',
} as const;

describe('stripe config loading', () => {
  it('does not crash startup when stripe is incomplete and mobile topup mode is not stripe_sandbox', () => {
    const config = loadStripeConfig({
      STRIPE_ENABLED: 'true',
      STRIPE_ENVIRONMENT: 'sandbox',
      MOBILE_TOPUP_PAYMENT_MODE: 'mock',
    });
    expect(config.enabled).toBe(false);
  });

  it('remains strict when stripe_sandbox mode is required', () => {
    expect(() => loadStripeConfig({
      STRIPE_ENABLED: 'true',
      STRIPE_ENVIRONMENT: 'sandbox',
      MOBILE_TOPUP_PAYMENT_MODE: 'stripe_sandbox',
    })).toThrow(/complete test credentials, webhook secret and redirect URLs/);
  });

  it('reports boolean-only diagnostics on strict stripe_sandbox validation failure', () => {
    const secret = 'sk_test_fixture_secret';
    const publicKey = 'pk_test_fixture_public';
    const webhook = 'whsec_fixture_signing_key';
    try {
      loadStripeConfig({
        STRIPE_ENABLED: 'true',
        STRIPE_ENVIRONMENT: 'sandbox',
        MOBILE_TOPUP_PAYMENT_MODE: 'stripe_sandbox',
        STRIPE_SECRET_KEY: secret,
        STRIPE_PUBLIC_KEY: publicKey,
        STRIPE_WEBHOOK_SECRET: webhook,
        STRIPE_SUCCESS_URL: 'https://website.example/success',
      });
      throw new Error('Expected strict validation to fail for missing failure URL');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain('diagnostics=');
      expect(message).toContain('secretKeyPresent');
      expect(message).toContain('secretKeyTestPrefix');
      expect(message).toContain('publicKeyPresent');
      expect(message).toContain('publicKeyTestPrefix');
      expect(message).toContain('webhookSecretPresent');
      expect(message).toContain('webhookSecretPrefix');
      expect(message).toContain('successUrlPresent');
      expect(message).toContain('failureUrlPresent');
      expect(message).not.toContain(secret);
      expect(message).not.toContain(publicKey);
      expect(message).not.toContain(webhook);
    }
  });

  it('reports boolean-only diagnostics on redirect URL validation failure', () => {
    try {
      loadStripeConfig({
        ...completeStripeEnv,
        MOBILE_TOPUP_PAYMENT_MODE: 'stripe_sandbox',
        STRIPE_SUCCESS_URL: 'https://website.example/success?token=bad',
      });
      throw new Error('Expected redirect URL validation to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toContain('diagnostics=');
      expect(message).toContain('successUrlPresent');
      expect(message).toContain('failureUrlPresent');
      expect(message).not.toContain(completeStripeEnv.STRIPE_SECRET_KEY);
      expect(message).not.toContain(completeStripeEnv.STRIPE_PUBLIC_KEY);
      expect(message).not.toContain(completeStripeEnv.STRIPE_WEBHOOK_SECRET);
    }
  });

  it('keeps stripe enabled when complete sandbox credentials are present', () => {
    const config = loadStripeConfig({
      ...completeStripeEnv,
      MOBILE_TOPUP_PAYMENT_MODE: 'stripe_sandbox',
    });
    expect(config.enabled).toBe(true);
  });
});
