import { describe, expect, it } from 'vitest';
import { loadMobileTopUpConfig } from '../src/topup/config.js';

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
      .toThrow(/production activation/);
    expect(() => loadMobileTopUpConfig({ RELOADLY_ENVIRONMENT: 'production' } as NodeJS.ProcessEnv)).toThrow();
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

});
