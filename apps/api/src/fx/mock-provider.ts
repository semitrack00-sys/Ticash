import type { FxProvider, FxRateResult } from './types.js';

export class MockTestFxProvider implements FxProvider {
  constructor(private readonly usdHtgRate: string) {}

  async getRate(): Promise<FxRateResult> {
    return {
      provider: 'mock_test_fx',
      rate: this.usdHtgRate,
      testMode: true,
    };
  }
}
