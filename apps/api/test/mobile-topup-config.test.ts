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
});
