import { z } from 'zod';
import { supportedSourceCurrencies, type FxConfig, type SupportedSourceCurrency } from './types.js';

const decimalString = z.string().regex(/^\d+(?:\.\d+)?$/);

export function loadFxConfig(env: NodeJS.ProcessEnv = process.env): FxConfig {
  const production = env.NODE_ENV === 'production';
  const mode = z.enum(['disabled', 'mock']).parse(
    (env.FX_MODE ?? (production ? 'disabled' : 'mock')).toLowerCase(),
  );
  if (production && mode === 'mock') {
    throw new Error('FX_MODE=mock is test-only and cannot run with NODE_ENV=production');
  }
  const quoteTtlSeconds = z.coerce.number().int().min(30).max(3600)
    .parse(env.FX_QUOTE_TTL_SECONDS ?? '300');
  const defaultMockRates: Record<SupportedSourceCurrency, string> = {
    USD: '132.500000',
    CAD: '97.000000',
    EUR: '145.000000',
    MXN: '7.500000',
    BRL: '26.000000',
    CLP: '0.140000',
    DOP: '2.200000',
  };
  const mockHtgRates = Object.fromEntries(supportedSourceCurrencies.map((currency) => {
    const configured = env[`MOCK_FX_${currency}_HTG_RATE`]?.trim();
    const rate = configured || (production ? undefined : defaultMockRates[currency]);
    if (mode === 'mock' && !rate) {
      throw new Error(`MOCK_FX_${currency}_HTG_RATE is required when FX_MODE=mock`);
    }
    return [currency, rate ? decimalString.parse(rate) : undefined];
  }).filter((entry): entry is [SupportedSourceCurrency, string] => typeof entry[1] === 'string')) as
    Partial<Record<SupportedSourceCurrency, string>>;
  const mockUsdHtgRate = mockHtgRates.USD;
  const minimumFeesByCurrency = Object.fromEntries(supportedSourceCurrencies.map((currency) => [
    currency,
    decimalString.parse(env[`TICASH_MINIMUM_FEE_${currency}`] ?? (currency === 'USD' ? env.TICASH_MINIMUM_FEE_USD : undefined) ?? '1.99'),
  ])) as Record<SupportedSourceCurrency, string>;
  const providerFeesByCurrency = Object.fromEntries(supportedSourceCurrencies.map((currency) => [
    currency,
    decimalString.parse(env[`FX_PROVIDER_FUNDING_FEE_${currency}`] ?? (currency === 'USD' ? env.FX_PROVIDER_FUNDING_FEE_USD : undefined) ?? '0.00'),
  ])) as Record<SupportedSourceCurrency, string>;
  return {
    mode,
    quoteTtlSeconds,
    mockUsdHtgRate: mockUsdHtgRate ? decimalString.parse(mockUsdHtgRate) : undefined,
    mockHtgRates: Object.keys(mockHtgRates).length === supportedSourceCurrencies.length
      ? mockHtgRates as Record<SupportedSourceCurrency, string>
      : undefined,
    ticashFeePercent: decimalString.parse(env.TICASH_FEE_PERCENT ?? '2.5'),
    ticashMinimumFeeUsd: decimalString.parse(env.TICASH_MINIMUM_FEE_USD ?? '1.99'),
    providerFundingFeeUsd: decimalString.parse(env.FX_PROVIDER_FUNDING_FEE_USD ?? '0.00'),
    minimumFeesByCurrency,
    providerFeesByCurrency,
  };
}
