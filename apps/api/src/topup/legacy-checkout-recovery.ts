import type { MobileTopUpTransaction, PrismaClient } from '@prisma/client';
import { reconcilePromotion } from '../flupflap/marketing-recharge.js';

const failureCode = 'LEGACY_CHECKOUT_EXPIRED';

export function assertRecoverableCheckout(row: MobileTopUpTransaction, sessionId: string) {
  if (!row.flupFlapCustomerId || row.userId || row.testMode ||
      row.paymentEnvironment !== 'PRODUCTION' || row.rechargeEnvironment !== 'PRODUCTION' ||
      row.paymentProvider !== 'STRIPE' || row.paymentSessionId !== sessionId ||
      row.status !== 'PENDING' || row.paymentStatus !== 'SESSION_CREATED' ||
      row.paymentAuthorizationId || row.paymentProviderTransactionId || row.providerTransactionId ||
      row.operatorTransactionId || row.fulfillmentStartedAt || row.recoveryStartedAt ||
      row.deliveredAt || row.refundedAt) {
    throw new Error('RECOVERY_RECORD_NOT_ELIGIBLE');
  }
}

export async function recoverLegacyCheckout(input: {
  transactionId: string; sessionId: string; accountId: string; secretKey: string;
  apply: boolean;
}, db: PrismaClient, transport: typeof fetch = fetch) {
  if (!/^[a-f0-9-]{36}$/.test(input.transactionId) || !/^cs_live_[A-Za-z0-9_]+$/.test(input.sessionId) ||
      !/^acct_[A-Za-z0-9]+$/.test(input.accountId) || !/^(sk|rk)_live_[A-Za-z0-9]+$/.test(input.secretKey)) {
    throw new Error('RECOVERY_INPUT_INVALID');
  }
  // Dedicated operator credential: never replace the key used for new checkouts.
  const request = async (path: string, expire = false) => {
    let response: Response;
    try {
      response = await transport(`https://api.stripe.com/v1/${path}`, {
        method: expire ? 'POST' : 'GET', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${input.secretKey}`,
          ...(expire ? { 'Idempotency-Key': `${input.transactionId}:legacy-expire` } : {}) },
      });
    } catch { throw new Error('RECOVERY_STRIPE_UNREACHABLE'); }
    // Never print provider bodies, checkout URLs, tokens or credentials.
    if (!response.ok) throw new Error(`RECOVERY_STRIPE_HTTP_${response.status}`);
    try { return await response.json() as Record<string, unknown>; }
    catch { throw new Error('RECOVERY_STRIPE_INVALID_RESPONSE'); }
  };
  const account = await request('account');
  if (account.id !== input.accountId) throw new Error('RECOVERY_ACCOUNT_MISMATCH');
  const row = await db.mobileTopUpTransaction.findUniqueOrThrow({ where: { id: input.transactionId } });
  if (row.status === 'FAILED' && row.paymentStatus === 'FAILED' && row.failureCode === failureCode &&
      row.paymentSessionId === input.sessionId) return { result: 'ALREADY_RECOVERED' };
  assertRecoverableCheckout(row, input.sessionId);
  const amount = Math.round(Number(row.totalChargeUsd) * 100);
  const assertSession = (session: Record<string, unknown>) => {
    const metadata = session.metadata as Record<string, unknown> | null;
    if (session.id !== input.sessionId || session.livemode !== true || session.mode !== 'payment' ||
        session.client_reference_id !== row.id || metadata?.transactionId !== row.id ||
        session.currency !== 'usd' || !Number.isSafeInteger(amount) || amount <= 0 ||
        session.amount_total !== amount || session.payment_status !== 'unpaid' ||
        session.payment_intent !== null || !['open', 'expired'].includes(String(session.status))) {
      throw new Error('RECOVERY_SESSION_NOT_UNPAID_OR_BINDING_MISMATCH');
    }
  };
  const path = `checkout/sessions/${encodeURIComponent(input.sessionId)}`;
  let session = await request(path);
  assertSession(session);
  if (!input.apply) return { result: 'DRY_RUN', transactionId: row.id, accountId: input.accountId,
    amountMinor: amount, checkoutStatus: session.status };
  if (session.status === 'open') {
    session = await request(`${path}/expire`, true);
    assertSession(session);
    if (session.status !== 'expired') throw new Error('RECOVERY_EXPIRATION_NOT_CONFIRMED');
  }
  // Re-read authoritative state after expiration; a race or ambiguous result fails closed.
  session = await request(path);
  assertSession(session);
  if (session.status !== 'expired') throw new Error('RECOVERY_EXPIRATION_NOT_CONFIRMED');
  await db.$transaction(async tx => {
    const changed = await tx.mobileTopUpTransaction.updateMany({ where: {
      id: row.id, updatedAt: row.updatedAt, paymentSessionId: input.sessionId,
      status: 'PENDING', paymentStatus: 'SESSION_CREATED', paymentProvider: 'STRIPE',
      testMode: false, paymentEnvironment: 'PRODUCTION', rechargeEnvironment: 'PRODUCTION',
      paymentAuthorizationId: null, paymentProviderTransactionId: null, providerTransactionId: null,
      operatorTransactionId: null, fulfillmentStartedAt: null, recoveryStartedAt: null,
      deliveredAt: null, refundedAt: null,
    }, data: { status: 'FAILED', paymentStatus: 'FAILED', failureCode, failedAt: new Date(),
      checkoutResumeTokenHash: null, checkoutResumeTokenExpiresAt: null } });
    if (changed.count !== 1) throw new Error('RECOVERY_RECORD_CHANGED_RETRY_REQUIRED');
    await reconcilePromotion(tx, row.id);
    await tx.auditLog.create({ data: {
      action: 'FLUPFLAP_LEGACY_CHECKOUT_EXPIRED', entity: 'MobileTopUpTransaction', entityId: row.id,
      flupFlapCustomerId: row.flupFlapCustomerId,
      metadata: { source: 'OPERATOR_RECOVERY_CLI', stripeAccountId: input.accountId,
        checkoutSessionId: input.sessionId, amountMinor: amount, paymentStatus: 'unpaid', checkoutStatus: 'expired' },
    } });
  });
  return { result: 'RECOVERED', transactionId: row.id };
}
