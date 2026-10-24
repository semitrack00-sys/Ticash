import { MobileTopUpError } from './types.js';
import type { PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { MobileTopUpTransactionRecord } from './repository.js';
import type { StripeHostedCheckoutProvider } from './stripe-provider.js';
import { paymentReviewReason } from './fraud-policy.js';

export function createRechargeFraudGate(db: PrismaClient, stripe?: StripeHostedCheckoutProvider) {
  return async (record: MobileTopUpTransactionRecord): Promise<string | undefined> => {
    const customerId = record.userId.slice('flupflap:'.length);
    const customer = await db.flupFlapCustomer.findUnique({ where: { id: customerId } });
    if (!customer || customer.guestExpiresAt || customer.status !== 'ACTIVE' || customer.rechargeRestricted) return 'ACCOUNT_REVIEW_REQUIRED';
    if (record.paymentProvider !== 'STRIPE') return 'PAYMENT_METHOD_REVIEW';
    if (!stripe) return 'PAYMENT_RISK_UNAVAILABLE';
    const evidence = await stripe.fraudEvidence(record.paymentProviderTransactionId ?? record.paymentAuthorizationId ?? '', record.id);
    const fingerprint = evidence.fingerprint ? createHash('sha256').update(evidence.fingerprint).digest('hex') : null;
    return db.$transaction(async tx => {
      // One account cannot race multiple cards past the limit across workers.
      await tx.$queryRaw`SELECT id FROM "FlupFlapCustomer" WHERE id = ${customerId} FOR UPDATE`;
      if (fingerprint) {
        // Same-card attempts across different customers must see each other's
        // assessment, including concurrent attempts on separate API workers.
        const cardLock = `recharge-card:${fingerprint}`;
        await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${cardLock}, 0))`;
      }
      const current = await tx.flupFlapCustomer.findUnique({ where: { id: customerId } });
      if (!current || current.status !== 'ACTIVE' || current.rechargeRestricted || current.guestExpiresAt) return 'ACCOUNT_REVIEW_REQUIRED';
      const saved = await tx.rechargeFraudAssessment.findUnique({ where: { transactionId: record.id } });
      // Reviews remain held on webhook retries and reconciliation.
      if (saved?.reason && !saved.reviewedAt) return saved.reason;
      const recent = await tx.rechargeFraudAssessment.findMany({ where: { customerId,
        createdAt: { gte: new Date(Date.now() - 86400000) }, transactionId: { not: record.id } } });
      const cards = new Set(recent.map(r => r.fingerprint).filter(Boolean));
      if (fingerprint) cards.add(fingerprint);
      const reviewed = saved?.reviewedAt && saved.chargeId === evidence.chargeId && saved.fingerprint === fingerprint;
      const linked = fingerprint ? await tx.rechargeFraudAssessment.findMany({ where: {
        fingerprint, customerId: { not: customerId }, createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
      }, select: { customerId: true } }) : [];
      const restrictedLink = linked.length > 0 && await tx.flupFlapCustomer.findFirst({ where: {
        id: { in: linked.map(r => r.customerId) }, OR: [{ rechargeRestricted: true }, { status: { not: 'ACTIVE' } }],
      }, select: { id: true } });
      const reason = paymentReviewReason(evidence) ?? (restrictedLink ? 'LINKED_ACCOUNT_REVIEW' : undefined) ??
        (!reviewed && linked.length > 0 ? 'SHARED_CARD_REVIEW' : undefined) ??
        (!reviewed && cards.size > 2 ? 'CARD_SWITCHING_REVIEW' : undefined);
      const data = { customerId, fingerprint, chargeId: evidence.chargeId, risk: evidence.risk,
        authentication: evidence.authentication ?? null, reason: reason ?? null };
      await tx.rechargeFraudAssessment.upsert({ where: { transactionId: record.id }, create: { transactionId: record.id, ...data }, update: data });
      return reason;
    });
  };
}

/** Staff may release a card-velocity hold only after fresh Stripe evidence passes.
 * A review never overrides disputed/refunded payments or failed authentication. */
export async function approveRechargeReview(db: PrismaClient, stripe: StripeHostedCheckoutProvider | undefined,
  record: MobileTopUpTransactionRecord, actor: string, note: string) {
  if (!stripe || record.paymentProvider !== 'STRIPE' || record.testMode || !record.userId.startsWith('flupflap:')) {
    throw new MobileTopUpError('FRAUD_REVIEW_UNAVAILABLE', 'Review is unavailable for this order.', 409);
  }
  const evidence = await stripe.fraudEvidence(record.paymentProviderTransactionId ?? record.paymentAuthorizationId ?? '', record.id);
  if (paymentReviewReason(evidence)) throw new MobileTopUpError('FRAUD_REVIEW_NOT_CLEAR', 'Stripe evidence does not permit release. Investigate the payment before proceeding.', 409);
  const customerId = record.userId.slice('flupflap:'.length);
  const fingerprint = createHash('sha256').update(evidence.fingerprint!).digest('hex');
  await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "FlupFlapCustomer" WHERE id = ${customerId} FOR UPDATE`;
    const customer = await tx.flupFlapCustomer.findUnique({ where: { id: customerId } });
    const current = await tx.mobileTopUpTransaction.findUnique({ where: { id: record.id } });
    if (!customer || customer.status !== 'ACTIVE' || customer.guestExpiresAt || customer.rechargeRestricted ||
        !current || current.flupFlapCustomerId !== customerId || current.status !== 'PENDING' || current.paymentStatus !== 'CAPTURED' ||
        current.fulfillmentStartedAt || current.providerTransactionId || current.failureCode !== 'FRAUD_REVIEW_REQUIRED') {
      throw new MobileTopUpError('FRAUD_REVIEW_CONFLICT', 'Order or account state changed. Refresh before reviewing.', 409);
    }
    const data = { customerId, fingerprint, chargeId: evidence.chargeId, risk: evidence.risk, authentication: evidence.authentication,
      reason: null, reviewedBy: actor, reviewedAt: new Date(), reviewNote: note };
    await tx.rechargeFraudAssessment.upsert({ where: { transactionId: record.id }, create: {transactionId:record.id,...data}, update:data });
    await tx.auditLog.create({ data: { userId: actor, flupFlapCustomerId: customerId, action: 'FLUPFLAP_FRAUD_REVIEW_APPROVED',
      entity: 'MobileTopUpTransaction', entityId: record.id, metadata: { reason: note, chargeId: evidence.chargeId } } });
  });
}
