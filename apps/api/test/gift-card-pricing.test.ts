import { describe, expect, it } from 'vitest';
import { priceGiftCard, type GiftCardPricingInput } from '../src/flupflap/gift-card-pricing.js';

const base: GiftCardPricingInput = {
  currency: 'USD', faceValueMinorUnits: 2000, providerCostMinorUnits: 2111,
  fundingDeductionBps: 0, processorRateBps: 290, processorFixedFeeMinorUnits: 30,
};

describe('FlupFlap $2 gift-card margin', () => {
  it('covers provider and processing costs at the minimum cent total', () => {
    expect(priceGiftCard(base)).toMatchObject({ totalMinorUnits: 2411, serviceFeeMinorUnits: 411,
      processorFeeMinorUnits: 100, estimatedMarginMinorUnits: 200 });
  });
  it('grosses up a deposit deduction, not a surcharge on provider cost', () => {
    expect(priceGiftCard({ ...base, fundingDeductionBps: 500 })).toMatchObject({
      totalMinorUnits: 2527, fundingCostMinorUnits: 112, estimatedMarginMinorUnits: 200,
    });
  });
  it('prices the user supplied $403.01 provider cost without assuming a brand discount', () => {
    expect(priceGiftCard({ ...base, faceValueMinorUnits: 40000, providerCostMinorUnits: 40301 }))
      .toMatchObject({ totalMinorUnits: 41742, estimatedMarginMinorUnits: 200 });
  });
  it('never marks a discounted card below face value', () => {
    expect(priceGiftCard({ ...base, providerCostMinorUnits: 1000 })).toMatchObject({
      totalMinorUnits: 2000, serviceFeeMinorUnits: 0, estimatedMarginMinorUnits: 912,
    });
  });
  it('preserves margin and minimum total over varying costs and fee schedules', () => {
    for (const funding of [0, 125, 500]) for (const rate of [0, 290, 440]) {
      for (let provider = 500; provider <= 200000; provider += 137) {
        const quote = priceGiftCard({ ...base, faceValueMinorUnits: 500,
          providerCostMinorUnits: provider, fundingDeductionBps: funding, processorRateBps: rate });
        const fundedCost = Math.ceil(provider * 10000 / (10000 - funding));
        const margin = (total: number) => total - fundedCost - Math.ceil(total * rate / 10000) - 30;
        expect(margin(quote.totalMinorUnits)).toBeGreaterThanOrEqual(200);
        expect(margin(quote.totalMinorUnits - 1)).toBeLessThan(200);
      }
    }
  });
  it.each(['faceValueMinorUnits', 'providerCostMinorUnits', 'fundingDeductionBps',
    'processorRateBps', 'processorFixedFeeMinorUnits'] as const)('rejects missing or invalid %s', key => {
    for (const value of [undefined, null, '290', NaN, Infinity, -1, 1.5]) {
      expect(() => priceGiftCard({ ...base, [key]: value } as GiftCardPricingInput)).toThrow();
    }
  });
  it('rejects unsupported currency, impossible rates and overflowing totals', () => {
    expect(() => priceGiftCard({ ...base, currency: 'EUR' } as unknown as GiftCardPricingInput)).toThrow();
    expect(() => priceGiftCard({ ...base, fundingDeductionBps: 10000 })).toThrow();
    expect(() => priceGiftCard({ ...base, processorRateBps: 10000 })).toThrow();
    expect(() => priceGiftCard({ ...base, providerCostMinorUnits: Number.MAX_SAFE_INTEGER })).toThrow();
  });
});
