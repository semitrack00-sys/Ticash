/** USD-only server-side pricing; inputs must come from verified provider/config data. */
export interface GiftCardPricingInput {
  currency: 'USD';
  faceValueMinorUnits: number;
  /** Complete wallet debit, including provider fees, SMS and discounts. */
  providerCostMinorUnits: number;
  /** Percentage withheld from deposits (500 means $100 deposits credit $95). */
  fundingDeductionBps: number;
  processorRateBps: number;
  processorFixedFeeMinorUnits: number;
}

export const GIFT_CARD_MARGIN_MINOR_UNITS = 200;
const BPS = 10000n;
const ceilDivide = (value: bigint, divisor: bigint) => (value + divisor - 1n) / divisor;

function integer(name: string, value: number, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Invalid gift-card pricing input: ${name}`);
  }
  return BigInt(value);
}

/**
 * Smallest cent-denominated total covering a $2 margin under supplied costs.
 * Fee estimates round UP to protect the margin; actual settlement may differ.
 * No guessed Stripe rates or funding defaults. Not a public quote endpoint.
 */
export function priceGiftCard(input: GiftCardPricingInput) {
  if (!input || input.currency !== 'USD') throw new Error('Gift-card pricing requires USD costs');
  const face = integer('faceValueMinorUnits', input.faceValueMinorUnits, 1);
  const provider = integer('providerCostMinorUnits', input.providerCostMinorUnits, 1);
  const funding = integer('fundingDeductionBps', input.fundingDeductionBps, 0, 9999);
  const rate = integer('processorRateBps', input.processorRateBps, 0, 9999);
  const fixed = integer('processorFixedFeeMinorUnits', input.processorFixedFeeMinorUnits, 0);
  const fundedCost = ceilDivide(provider * BPS, BPS - funding);
  const required = fundedCost + fixed + BigInt(GIFT_CARD_MARGIN_MINOR_UNITS);
  const calculated = ceilDivide(required * BPS, BPS - rate);
  // A deeply discounted product can have more than $2 margin at face value.
  const total = calculated > face ? calculated : face;
  const processing = ceilDivide(total * rate, BPS) + fixed;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Gift-card total exceeds safe integer range');
  return {
    currency: 'USD' as const,
    faceValueMinorUnits: Number(face),
    providerCostMinorUnits: Number(provider),
    fundingCostMinorUnits: Number(fundedCost - provider),
    processorFeeMinorUnits: Number(processing),
    serviceFeeMinorUnits: Number(total - face),
    totalMinorUnits: Number(total),
    estimatedMarginMinorUnits: Number(total - fundedCost - processing),
    targetMarginMinorUnits: GIFT_CARD_MARGIN_MINOR_UNITS,
  };
}
