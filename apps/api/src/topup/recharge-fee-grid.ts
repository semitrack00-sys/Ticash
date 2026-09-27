import { MobileTopUpError } from './types.js';

// Integer cents. This business policy does not define provider denominations.
const feeTiers = [[999, 99], [1999, 125], [2999, 149], [4999, 199], [7499, 249], [9999, 349], [10000, 449]] as const;
export function normalizeRechargeAmountMinorUnits(amountUsd: number): number {
  const cents = Math.round(amountUsd * 100);
  if (!Number.isFinite(amountUsd) || Math.abs(amountUsd * 100 - cents) > 1e-7 || cents < 500 || cents > 10000) {
    throw new MobileTopUpError('INVALID_TOPUP_AMOUNT', 'Recharge amount must be between $5.00 and $100.00 USD, rounded to cents', 400);
  }
  return cents;
}
export function lookupRechargeFeeMinorUnits(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 500 || cents > 10000) {
    throw new MobileTopUpError('INVALID_TOPUP_AMOUNT', 'Recharge amount is outside the supported fee policy', 400);
  }
  return feeTiers.find(([maximum]) => cents <= maximum)![1];
}
export function approvedRechargePrice(amountUsd: number) {
  const amountMinorUnits = normalizeRechargeAmountMinorUnits(amountUsd);
  const feeMinorUnits = lookupRechargeFeeMinorUnits(amountMinorUnits);
  return { amountMinorUnits, feeMinorUnits, totalMinorUnits: amountMinorUnits + feeMinorUnits };
}
