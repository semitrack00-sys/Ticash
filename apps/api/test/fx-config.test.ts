import { describe, expect, it } from 'vitest';
import { loadFxConfig } from '../src/fx/config.js';

describe('FX configuration', () => {
  it('defaults production to disabled instead of exposing the mock rate', () => {
    const config = loadFxConfig({ NODE_ENV: 'production' });
    expect(config.mode).toBe('disabled');
    expect(config.mockUsdHtgRate).toBeUndefined();
  });

  it('rejects the mock provider in production', () => {
    expect(() => loadFxConfig({
      NODE_ENV: 'production',
      FX_MODE: 'mock',
      MOCK_FX_USD_HTG_RATE: '132.5',
    })).toThrow(/test-only/);
  });

  it('validates TTL and decimal fee settings', () => {
    expect(() => loadFxConfig({ FX_QUOTE_TTL_SECONDS: '29' })).toThrow();
    expect(() => loadFxConfig({ TICASH_FEE_PERCENT: '-1' })).toThrow();
    expect(() => loadFxConfig({ FX_PROVIDER_FUNDING_FEE_USD: 'free' })).toThrow();
  });
});
