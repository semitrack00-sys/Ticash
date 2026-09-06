export type FxMode = 'disabled' | 'mock';

export const supportedSourceCurrencies = ['USD', 'CAD', 'EUR', 'MXN', 'BRL', 'CLP', 'DOP'] as const;
export type SupportedSourceCurrency = typeof supportedSourceCurrencies[number];

export interface FxConfig {
  mode: FxMode;
  quoteTtlSeconds: number;
  mockUsdHtgRate?: string;
  mockHtgRates?: Record<SupportedSourceCurrency, string>;
  ticashFeePercent: string;
  ticashMinimumFeeUsd: string;
  providerFundingFeeUsd: string;
  minimumFeesByCurrency?: Record<SupportedSourceCurrency, string>;
  providerFeesByCurrency?: Record<SupportedSourceCurrency, string>;
}

export interface FxCorridor {
  sendCountry: string;
  receiveCountry: string;
  sourceCurrency: string;
  targetCurrency: string;
}

export interface FxRateRequest {
  corridor: FxCorridor;
  sendAmount: string;
  requestedAt: Date;
}

export interface FxRateResult {
  provider: string;
  rate: string;
  expiresAt?: Date;
  testMode: boolean;
}

export interface FxProvider {
  getRate(input: FxRateRequest): Promise<FxRateResult>;
}

export class FxError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
