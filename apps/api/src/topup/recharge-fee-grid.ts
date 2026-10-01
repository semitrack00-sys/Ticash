import { MobileTopUpError } from './types.js';

// Lower tier boundaries and fees in integer cents, not provider denominations.
const approvedFeeGrid = new Map<number, number>([
  [500, 99], [1000, 125], [2000, 149], [3000, 199],
  [5000, 249], [7500, 349], [10000, 449],
]);

// Legacy anchor helpers remain available, but must not filter provider catalogs.
export const approvedRechargeAmountsUsd = [...approvedFeeGrid.keys()].map(value => value / 100);
export function isApprovedRechargeAmountMinorUnits(cents: number): boolean {
  return approvedFeeGrid.has(cents);
}

export function normalizeRechargeAmountMinorUnits(amountUsd: number, minimumCents = 500): number {
  const cents = Math.round(amountUsd * 100);
  if (!Number.isFinite(amountUsd) || Math.abs(amountUsd * 100 - cents) > 1e-7 || cents < minimumCents || cents > 10000) {
    throw new MobileTopUpError('INVALID_TOPUP_AMOUNT', `Recharge amount must be between $${(minimumCents / 100).toFixed(2)} and $100.00 USD, rounded to cents`, 400);
  }
  return cents;
}

export function lookupRechargeFeeMinorUnits(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 500 || cents > 10000) {
    throw new MobileTopUpError('INVALID_TOPUP_AMOUNT', 'Recharge amount is outside the supported fee policy', 400);
  }
  return [...approvedFeeGrid].reverse().find(([minimum]) => cents >= minimum)![1];
}

export function approvedRechargePrice(amountUsd: number) {
  const amountMinorUnits = normalizeRechargeAmountMinorUnits(amountUsd);
  const feeMinorUnits = lookupRechargeFeeMinorUnits(amountMinorUnits);
  return { amountMinorUnits, feeMinorUnits, totalMinorUnits: amountMinorUnits + feeMinorUnits };
}

// Final FlupFlap AIRTIME fees, inclusive bounds in integer cents.
// Applied only when creating a new applicable quote; never reprice stored records.
const flupFlapAirtimeFeeTiers = [
  [100, 999, 124],
  [1000, 1999, 164],
  [2000, 2999, 234],
  [3000, 3999, 284],
  [4000, 4999, 334],
  [5000, 7499, 384],
  [7500, 10000, 484],
] as const;

export function flupFlapAirtimePrice(amountUsd: number) {
  const amountMinorUnits = normalizeRechargeAmountMinorUnits(amountUsd, 100);
  const tier = flupFlapAirtimeFeeTiers.find(([minimum, maximum]) => amountMinorUnits >= minimum && amountMinorUnits <= maximum)!;
  const feeMinorUnits = tier[2];
  return { amountMinorUnits, feeMinorUnits, totalMinorUnits: amountMinorUnits + feeMinorUnits };
}
