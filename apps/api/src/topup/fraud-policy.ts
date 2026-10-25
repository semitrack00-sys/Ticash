import { MobileTopUpError } from './types.js';

export type PurchaseHistory = { createdAt: string; totalChargeUsd: number; paymentStatus: string };
/** Count all reservations, including failed and hidden orders, to resist retries. */
export function assertPurchaseLimits(amount: number, history: PurchaseHistory[], now: Date, newAccount: boolean) {
  const day = history.filter(r => Date.parse(r.createdAt) >= now.getTime() - 86400000);
  const hour = day.filter(r => Date.parse(r.createdAt) >= now.getTime() - 3600000);
  const limit = newAccount ? 50 : 200;
  if (amount > (newAccount ? 25 : 100) || day.reduce((n, r) => n + Math.round(r.totalChargeUsd * 100), 0) + Math.round(amount * 100) > limit * 100 ||
      hour.length >= 3 || day.length >= 10 || hour.filter(r => r.paymentStatus === 'FAILED').length >= 3) {
    throw new MobileTopUpError('RECHARGE_LIMIT_REACHED', 'Purchase limit reached. Try again later or contact support.', 429);
  }
}

export type PaymentEvidence = {
  chargeId: string; fingerprint?: string; risk: string; authentication?: string;
  cardNetwork?: string; responseEci?: string;
  postalCodeCheck?: string; cvcCheck?: string; streetCheck?: string;
  paymentType: string; review: boolean; disputed: boolean; refunded: boolean;
};
export function paymentReviewReason(e: PaymentEvidence): string | undefined {
  if (e.disputed || e.refunded) return 'PAYMENT_REVERSED_OR_DISPUTED';
  if (e.review || e.risk !== 'normal') return 'PAYMENT_RISK_REVIEW';
  if (e.paymentType !== 'card') return 'PAYMENT_METHOD_REVIEW';
  // An issuer may authorize even when AVS/CVC fails. Normal risk and 3DS
  // authentication must never override missing, unavailable or non-passing verification.
  if (e.postalCodeCheck !== 'pass' || e.cvcCheck !== 'pass') return 'PAYMENT_CARD_CHECK_FAILED';
  if (e.streetCheck === 'fail') return 'PAYMENT_STREET_CHECK_FAILED';
  if (!e.fingerprint || e.authentication !== 'authenticated') return 'PAYMENT_AUTHENTICATION_REVIEW';
  // Use the network response, not the provisional 3DS ECI. Authentication
  // can be downgraded during authorization. This is not a liability guarantee.
  if (e.responseEci && ((e.cardNetwork === 'visa' && e.responseEci !== '05') ||
      (e.cardNetwork === 'mastercard' && e.responseEci !== '02'))) return 'PAYMENT_AUTHENTICATION_REVIEW';
  return undefined;
}
