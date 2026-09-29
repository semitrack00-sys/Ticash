import { describe, expect, it } from 'vitest';
import { assertMobileTopUpConfigurationCoherence, loadMobileTopUpConfig } from '../src/topup/config.js';
import { loadStripeConfig } from '../src/topup/stripe-config.js';

const liveGateEnv = {
  MOBILE_TOPUP_PRODUCTION_ENABLED: 'true',
  MOBILE_TOPUP_APPROVED_FOR_LIVE_USE: 'true',
  APPROVED_FOR_LIVE_USE: 'true',
  LIVE_MONEY_ENABLED: 'true',
} as const;

describe('mobile top-up configuration', () => {
  it('is disabled, sandbox-only and credential-optional by default', () => {
    expect(loadMobileTopUpConfig({} as NodeJS.ProcessEnv)).toMatchObject({
      enabled: false,
      environment: 'sandbox',
      paymentMode: 'mock',
      productionEnabled: false,
      approvedForLiveUse: false,
    });
  });

  it('requires backend Reloadly credentials only when enabled', () => {
    expect(() => loadMobileTopUpConfig({ MOBILE_TOPUP_ENABLED: 'true' } as NodeJS.ProcessEnv))
      .toThrow(/RELOADLY_CLIENT_ID/);
    expect(loadMobileTopUpConfig({
      MOBILE_TOPUP_ENABLED: 'true',
      RELOADLY_CLIENT_ID: 'sandbox-id',
      RELOADLY_CLIENT_SECRET: 'sandbox-secret',
    } as NodeJS.ProcessEnv).enabled).toBe(true);
  });

  it('refuses production flags and non-sandbox endpoints', () => {
    expect(() => loadMobileTopUpConfig({ MOBILE_TOPUP_PRODUCTION_ENABLED: 'true' } as NodeJS.ProcessEnv))
      .toThrow(/requires MOBILE_TOPUP_PRODUCTION_ENABLED/);
    expect(() => loadMobileTopUpConfig({ RELOADLY_AIRTIME_BASE_URL: 'https://example.com' } as NodeJS.ProcessEnv))
      .toThrow(/Sandbox URL/);
  });
  it('accepts only the explicit Stripe sandbox payment mode', () => {
    expect(loadMobileTopUpConfig({
      MOBILE_TOPUP_PAYMENT_MODE: 'stripe_sandbox',
    } as NodeJS.ProcessEnv).paymentMode).toBe('stripe_sandbox');

    expect(() => loadMobileTopUpConfig({
      MOBILE_TOPUP_PAYMENT_MODE: 'checkout_sandbox',
    } as NodeJS.ProcessEnv)).toThrow();

    expect(() => loadMobileTopUpConfig({
      MOBILE_TOPUP_PAYMENT_MODE: 'live',
    } as NodeJS.ProcessEnv)).toThrow();

    expect(loadMobileTopUpConfig({
      ...liveGateEnv,
      RELOADLY_ENVIRONMENT: 'production',
      MOBILE_TOPUP_PAYMENT_MODE: 'stripe_live',
      RELOADLY_LIVE_CLIENT_ID: 'live-client-id',
      RELOADLY_LIVE_CLIENT_SECRET: 'live-client-secret',
    } as NodeJS.ProcessEnv).paymentMode).toBe('stripe_live');
  });

  it('uses an independent checkout resume TTL default and validates bounded integers', () => {
    expect(loadMobileTopUpConfig({} as NodeJS.ProcessEnv).checkoutResumeTtlSeconds).toBe(3600);

    expect(loadMobileTopUpConfig({
      MOBILE_TOPUP_CHECKOUT_RESUME_TTL_SECONDS: '120',
    } as NodeJS.ProcessEnv).checkoutResumeTtlSeconds).toBe(120);

    expect(() => loadMobileTopUpConfig({
      MOBILE_TOPUP_CHECKOUT_RESUME_TTL_SECONDS: '59',
    } as NodeJS.ProcessEnv)).toThrow();

    expect(() => loadMobileTopUpConfig({
      MOBILE_TOPUP_CHECKOUT_RESUME_TTL_SECONDS: '86401',
    } as NodeJS.ProcessEnv)).toThrow();

    expect(() => loadMobileTopUpConfig({
      MOBILE_TOPUP_CHECKOUT_RESUME_TTL_SECONDS: '1.5',
    } as NodeJS.ProcessEnv)).toThrow();
  });

  it('keeps sandbox mode fail-closed when live credentials are supplied', () => {
    expect(() => loadMobileTopUpConfig({
      RELOADLY_LIVE_CLIENT_ID: 'live-client-id',
      RELOADLY_LIVE_CLIENT_SECRET: 'live-client-secret',
    } as NodeJS.ProcessEnv)).toThrow(/must not include Reloadly live credentials/);
  });

  it('requires all live gates and exact production Reloadly URLs for production mode', () => {
    expect(() => loadMobileTopUpConfig({
      RELOADLY_ENVIRONMENT: 'production',
      MOBILE_TOPUP_PAYMENT_MODE: 'stripe_live',
      RELOADLY_LIVE_CLIENT_ID: 'live-client-id',
      RELOADLY_LIVE_CLIENT_SECRET: 'live-client-secret',
    } as NodeJS.ProcessEnv)).toThrow(/requires MOBILE_TOPUP_PRODUCTION_ENABLED/);

    expect(() => loadMobileTopUpConfig({
      ...liveGateEnv,
      RELOADLY_ENVIRONMENT: 'production',
      MOBILE_TOPUP_PAYMENT_MODE: 'stripe_live',
      RELOADLY_LIVE_CLIENT_ID: 'live-client-id',
      RELOADLY_LIVE_CLIENT_SECRET: 'live-client-secret',
      RELOADLY_AIRTIME_BASE_URL: 'https://example.com',
    } as NodeJS.ProcessEnv)).toThrow(/must match the reviewed value/);

    const config = loadMobileTopUpConfig({
      ...liveGateEnv,
      RELOADLY_ENVIRONMENT: 'production',
      MOBILE_TOPUP_PAYMENT_MODE: 'stripe_live',
      MOBILE_TOPUP_ENABLED: 'true',
      RELOADLY_LIVE_CLIENT_ID: 'live-client-id',
      RELOADLY_LIVE_CLIENT_SECRET: 'live-client-secret',
    } as NodeJS.ProcessEnv);
    expect(config).toMatchObject({
      environment: 'production',
      paymentMode: 'stripe_live',
      airtimeBaseUrl: 'https://topups.reloadly.com',
      liveRechargeEnabled: true,
      productionEnabled: true,
      approvedForLiveUse: true,
    });
  });

  it('fails when production credentials are missing or mixed with sandbox credentials', () => {
    expect(() => loadMobileTopUpConfig({
      ...liveGateEnv,
      MOBILE_TOPUP_ENABLED: 'true',
      RELOADLY_ENVIRONMENT: 'production',
      MOBILE_TOPUP_PAYMENT_MODE: 'stripe_live',
      RELOADLY_LIVE_CLIENT_ID: 'live-client-id',
    } as NodeJS.ProcessEnv)).toThrow(/RELOADLY_LIVE_CLIENT_ID and RELOADLY_LIVE_CLIENT_SECRET/);

    expect(() => loadMobileTopUpConfig({
      ...liveGateEnv,
      RELOADLY_ENVIRONMENT: 'production',
      MOBILE_TOPUP_PAYMENT_MODE: 'stripe_live',
      RELOADLY_CLIENT_ID: 'sandbox-client-id',
      RELOADLY_CLIENT_SECRET: 'sandbox-client-secret',
      RELOADLY_LIVE_CLIENT_ID: 'live-client-id',
      RELOADLY_LIVE_CLIENT_SECRET: 'live-client-secret',
    } as NodeJS.ProcessEnv)).toThrow(/must not include Reloadly sandbox credentials/);
  });

  it('rejects incoherent stripe/reloadly environment combinations at startup', () => {
    const coherentLiveTopup = loadMobileTopUpConfig({
      ...liveGateEnv,
      MOBILE_TOPUP_ENABLED: 'true',
      RELOADLY_ENVIRONMENT: 'production',
      MOBILE_TOPUP_PAYMENT_MODE: 'stripe_live',
      RELOADLY_LIVE_CLIENT_ID: 'live-client-id',
      RELOADLY_LIVE_CLIENT_SECRET: 'live-client-secret',
    } as NodeJS.ProcessEnv);

    const sandboxStripe = loadStripeConfig({
      MOBILE_TOPUP_PAYMENT_MODE: 'stripe_sandbox',
      STRIPE_ENABLED: 'true',
      STRIPE_ENVIRONMENT: 'sandbox',
      STRIPE_SECRET_KEY: 'sk_test_fixture_secret',
      STRIPE_PUBLIC_KEY: 'pk_test_fixture_public',
      STRIPE_WEBHOOK_SECRET: 'whsec_fixture_signing_key',
      STRIPE_SUCCESS_URL: 'https://ticash-app.com/success',
      STRIPE_FAILURE_URL: 'https://flupflap.com/failure',
    } as NodeJS.ProcessEnv);

    expect(() => assertMobileTopUpConfigurationCoherence(coherentLiveTopup, sandboxStripe))
      .toThrow(/environments must match exactly/);

    const coherentSandboxTopup = loadMobileTopUpConfig({
      MOBILE_TOPUP_ENABLED: 'true',
      RELOADLY_CLIENT_ID: 'sandbox-client-id',
      RELOADLY_CLIENT_SECRET: 'sandbox-client-secret',
      MOBILE_TOPUP_PAYMENT_MODE: 'stripe_sandbox',
    } as NodeJS.ProcessEnv);

    const liveStripe = loadStripeConfig({
      MOBILE_TOPUP_PAYMENT_MODE: 'stripe_live',
      STRIPE_ENABLED: 'true',
      STRIPE_ENVIRONMENT: 'production',
      STRIPE_LIVE_SECRET_KEY: 'sk_live_fixture_secret',
      STRIPE_LIVE_PUBLIC_KEY: 'pk_live_fixture_public',
      STRIPE_LIVE_WEBHOOK_SECRET: 'whsec_live_fixture_signing_key',
      STRIPE_SUCCESS_URL: 'https://ticash-app.com/success',
      STRIPE_FAILURE_URL: 'https://flupflap.com/failure',
    } as NodeJS.ProcessEnv);

    expect(() => assertMobileTopUpConfigurationCoherence(coherentSandboxTopup, liveStripe))
      .toThrow(/environments must match exactly/);
  });

});
