import { MobileTopUpError } from './types.js';

export type PurchaseHistory = { createdAt: string; totalChargeUsd: number; paymentStatus: string; attemptExempt?: boolean };
/** Count all reservations, including failed and hidden orders, to resist retries. */
export function assertPurchaseLimits(amount: number, history: PurchaseHistory[], now: Date, newAccount: boolean) {
  const blocked = (at: number) => {
  const day = history.filter(r => Date.parse(r.createdAt) >= at - 86400000);
  const attempts = day.filter(r => !r.attemptExempt);
  const hour = attempts.filter(r => Date.parse(r.createdAt) >= at - 3600000);
  // Account age no longer lowers monetary limits; retain the argument for callers.
  void newAccount;
  const limit = 200;
  return amount > 100 || day.reduce((n, r) => n + Math.round(r.totalChargeUsd * 100), 0) + Math.round(amount * 100) > limit * 100 ||
      hour.length >= 3 || attempts.length >= 10 || hour.filter(r => r.paymentStatus === 'FAILED').length >= 3;
  };
  if (blocked(now.getTime())) {
    const retryAt = amount > 100 ? undefined : [...new Set(history.flatMap(r => [3600000,86400000].map(window => Date.parse(r.createdAt)+window+1)))].sort((a,b)=>a-b)
      .find(at=>at>now.getTime()&&!blocked(at));
    throw new MobileTopUpError('RECHARGE_LIMIT_REACHED', 'Purchase limit reached. Try again later or contact support.', 429,
      retryAt===undefined ? {mode:'CHANGE_AMOUNT',serverTime:now.toISOString()} : temporaryPurchaseAccess(retryAt,now));
  }
}

export function temporaryPurchaseAccess(retryAt:number,now:Date) {
  return {mode:'TEMPORARY_LIMIT' as const,serverTime:now.toISOString(),retryAt:new Date(retryAt).toISOString(),retryAfterSeconds:Math.max(0,Math.ceil((retryAt-now.getTime())/1000))};
}

/** Report the latest applicable reset, not just whichever gate ran first. */
export function throwPurchaseBlocks(blocks: MobileTopUpError[], now:Date) {
  if(!blocks.length)return;
  const permanent=blocks.find(b=>b.purchaseAccess?.mode==='CHANGE_AMOUNT');
  const first=permanent??blocks[0]!;
  const retryAt=Math.max(...blocks.map(b=>Date.parse(b.purchaseAccess?.retryAt??'')).filter(Number.isFinite));
  throw new MobileTopUpError(first.code,first.message,first.statusCode,permanent?.purchaseAccess??(Number.isFinite(retryAt)?temporaryPurchaseAccess(retryAt,now):first.purchaseAccess));
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
  if (!e.fingerprint) return 'PAYMENT_AUTHENTICATION_REVIEW';
  // Automatic 3DS can legitimately complete without authentication. Stripe's
  // succeeded/captured payment check still enforces issuer-required actions.
  // Explicit failed, incomplete or unknown authentication stays held.
  if (e.authentication !== undefined &&
      !['authenticated', 'exempted', 'not_supported'].includes(e.authentication)) return 'PAYMENT_AUTHENTICATION_REVIEW';
  // Use the network response, not the provisional 3DS ECI. Authentication
  // can be downgraded during authorization. This is not a liability guarantee.
  if (e.authentication === 'authenticated' && e.responseEci && ((e.cardNetwork === 'visa' && e.responseEci !== '05') ||
      (e.cardNetwork === 'mastercard' && e.responseEci !== '02'))) return 'PAYMENT_AUTHENTICATION_REVIEW';
  return undefined;
}
