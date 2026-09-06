import { FxError, type FxProvider, type FxRateRequest, type FxRateResult } from './types.js';

export class MockTestFxProvider implements FxProvider {
  private readonly htgRates: Record<string, string>;

  constructor(htgRates: string | Record<string, string>) {
    this.htgRates = typeof htgRates === 'string' ? { USD: htgRates } : htgRates;
  }

  async getRate(input: FxRateRequest): Promise<FxRateResult> {
    const rate = this.htgRates[input.corridor.sourceCurrency];
    if (!rate) {
      throw new FxError('UNSUPPORTED_CURRENCY', 'No test FX rate is configured for the selected currency', 422);
    }
    return {
      provider: 'mock_test_fx',
      rate,
      testMode: true,
    };
  }
}
