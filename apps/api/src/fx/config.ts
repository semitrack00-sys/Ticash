import { z } from 'zod';
import type { FxConfig } from './types.js';

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
  const mockUsdHtgRate = env.MOCK_FX_USD_HTG_RATE?.trim() || (
    production ? undefined : '132.500000'
  );
  if (mode === 'mock' && !mockUsdHtgRate) {
    throw new Error('MOCK_FX_USD_HTG_RATE is required when FX_MODE=mock');
  }
  return {
    mode,
    quoteTtlSeconds,
    mockUsdHtgRate: mockUsdHtgRate ? decimalString.parse(mockUsdHtgRate) : undefined,
    ticashFeePercent: decimalString.parse(env.TICASH_FEE_PERCENT ?? '2.5'),
    ticashMinimumFeeUsd: decimalString.parse(env.TICASH_MINIMUM_FEE_USD ?? '1.99'),
    providerFundingFeeUsd: decimalString.parse(env.FX_PROVIDER_FUNDING_FEE_USD ?? '0.00'),
  };
}
