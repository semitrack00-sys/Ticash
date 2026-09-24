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

const minCustomRechargeMinorUnits = usdMinorUnits(5);
const maxCustomRechargeMinorUnits = usdMinorUnits(100);

export const approvedRechargeAmountsUsd = [...approvedFeeGrid.keys()].map((value) => value / 100);

export function isApprovedRechargeAmountMinorUnits(amountMinorUnits: number): boolean {
  return approvedFeeGrid.has(amountMinorUnits);
}

export function normalizeRechargeAmountMinorUnits(amountUsd: number): number {
  if (!Number.isFinite(amountUsd)) {
    throw new MobileTopUpError('INVALID_TOPUP_AMOUNT', 'Recharge amount must be a finite USD value', 400);
  }
  const amountMinorUnits = Math.round(amountUsd * 100);
  if (Math.abs(amountUsd * 100 - amountMinorUnits) > 1e-7) {
    throw new MobileTopUpError('INVALID_TOPUP_AMOUNT', 'Recharge amount must be rounded to cents', 400);
  }
  if (amountMinorUnits < minCustomRechargeMinorUnits || amountMinorUnits > maxCustomRechargeMinorUnits || amountMinorUnits <= 0) {
    throw new MobileTopUpError('INVALID_TOPUP_AMOUNT', 'Recharge amount must be between $5.00 and $100.00 USD', 400);
  }
  return amountMinorUnits;
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
  const amountMinorUnits = normalizeRechargeAmountMinorUnits(amountUsd);
  const exactFeeMinorUnits = approvedFeeGrid.get(amountMinorUnits);
  if (exactFeeMinorUnits != null) {
    return {
      amountMinorUnits,
      feeMinorUnits: exactFeeMinorUnits,
      totalMinorUnits: amountMinorUnits + exactFeeMinorUnits,
    };
  }

  const anchors = [...approvedFeeGrid.entries()].sort((left, right) => left[0] - right[0]);
  const lowerAnchor = [...anchors].reverse().find(([minorUnits]) => minorUnits < amountMinorUnits);
  const upperAnchor = anchors.find(([minorUnits]) => minorUnits > amountMinorUnits);
  if (!lowerAnchor || !upperAnchor) {
    throw new MobileTopUpError('INVALID_TOPUP_AMOUNT', 'Recharge amount must be between $5.00 and $100.00 USD', 400);
  }

  const [lowerAmountMinorUnits, lowerFeeMinorUnits] = lowerAnchor;
  const [upperAmountMinorUnits, upperFeeMinorUnits] = upperAnchor;
  const deltaAmountMinorUnits = amountMinorUnits - lowerAmountMinorUnits;
  const amountSpanMinorUnits = upperAmountMinorUnits - lowerAmountMinorUnits;
  const feeDeltaMinorUnits = upperFeeMinorUnits - lowerFeeMinorUnits;
  const interpolatedFeeMinorUnits = lowerFeeMinorUnits + Math.round((deltaAmountMinorUnits * feeDeltaMinorUnits) / amountSpanMinorUnits);

  return {
    amountMinorUnits,
    feeMinorUnits: interpolatedFeeMinorUnits,
    totalMinorUnits: amountMinorUnits + interpolatedFeeMinorUnits,
  };
}