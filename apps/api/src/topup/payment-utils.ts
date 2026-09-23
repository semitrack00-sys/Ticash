import { MobileTopUpError } from './types.js';

export function usdMinorUnits(value: number): number {
  const minor = Math.round(value * 100);
  if (!Number.isFinite(value) || value <= 0 || !Number.isSafeInteger(minor) || Math.abs(value * 100 - minor) > 1e-7) {
    throw new MobileTopUpError('INVALID_PAYMENT_AMOUNT', 'Payment amount must be a positive USD minor-unit amount', 400);
  }
  return minor;
}
