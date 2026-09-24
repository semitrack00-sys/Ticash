import { usdMinorUnits } from './payment-utils.js';
import { MobileTopUpError } from './types.js';

const approvedFeeGrid = new Map<number, number>([
  [usdMinorUnits(5), usdMinorUnits(0.99)],
  [usdMinorUnits(10), usdMinorUnits(1.05)],
  [usdMinorUnits(20), usdMinorUnits(1.49)],
  [usdMinorUnits(30), usdMinorUnits(1.79)],
  [usdMinorUnits(50), usdMinorUnits(2.49)],
  [usdMinorUnits(75), usdMinorUnits(3.49)],
  [usdMinorUnits(100), usdMinorUnits(4.49)],
]);

export const approvedRechargeAmountsUsd = [...approvedFeeGrid.keys()].map((value) => value / 100);

export function isApprovedRechargeAmountMinorUnits(amountMinorUnits: number): boolean {
  return approvedFeeGrid.has(amountMinorUnits);
}

export function lookupRechargeFeeMinorUnits(amountMinorUnits: number): number {
  if (!Number.isSafeInteger(amountMinorUnits) || amountMinorUnits <= 0) {
    throw new MobileTopUpError('INVALID_TOPUP_AMOUNT', 'Recharge amount must be a positive USD minor-unit amount', 400);
  }
  const feeMinorUnits = approvedFeeGrid.get(amountMinorUnits);
  if (feeMinorUnits == null) {
    throw new MobileTopUpError('UNSUPPORTED_TOPUP_DENOMINATION', 'Select a supported recharge denomination', 400);
  }
  return feeMinorUnits;
}

export function approvedRechargePrice(amountUsd: number) {
  const amountMinorUnits = usdMinorUnits(amountUsd);
  const feeMinorUnits = lookupRechargeFeeMinorUnits(amountMinorUnits);
  return {
    amountMinorUnits,
    feeMinorUnits,
    totalMinorUnits: amountMinorUnits + feeMinorUnits,
  };
}