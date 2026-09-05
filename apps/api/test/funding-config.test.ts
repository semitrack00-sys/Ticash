import { describe, expect, it } from 'vitest';
import { loadFundingConfig } from '../src/funding/config.js';

describe('Dwolla funding configuration', () => {
  it('defaults to disabled sandbox mode without requiring secrets', () => {
    const config = loadFundingConfig({});
    expect(config.enabled).toBe(false);
    expect(config.environment).toBe('sandbox');
  });

  it('requires credentials only when Dwolla is enabled', () => {
    expect(() => loadFundingConfig({ DWOLLA_ENABLED: 'true' })).toThrow(/required/);
  });

  it('refuses production unless every explicit live approval gate is true', () => {
    const base = {
      DWOLLA_ENABLED: 'true',
      DWOLLA_ENVIRONMENT: 'production',
      DWOLLA_CLIENT_ID: 'id',
      DWOLLA_CLIENT_SECRET: 'secret',
      DWOLLA_WEBHOOK_SECRET: 'webhook',
    };
    expect(() => loadFundingConfig(base)).toThrow(/production requires/);
    expect(() => loadFundingConfig({
      ...base,
      DWOLLA_PRODUCTION_ENABLED: 'true',
      DWOLLA_LIVE_FUNDING_ENABLED: 'true',
      DWOLLA_APPROVED_FOR_LIVE_USE: 'true',
    })).toThrow(/sandbox\/UAT/);
  });

  it('rejects invalid boolean and environment values', () => {
    expect(() => loadFundingConfig({ DWOLLA_ENABLED: 'yes' })).toThrow();
    expect(() => loadFundingConfig({ DWOLLA_ENVIRONMENT: 'live' })).toThrow();
  });
});
