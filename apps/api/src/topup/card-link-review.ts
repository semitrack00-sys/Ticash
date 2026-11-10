import type { Prisma, PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import type { StripeHostedCheckoutProvider } from './stripe-provider.js';
import { paymentReviewReason } from './fraud-policy.js';
import { MobileTopUpError } from './types.js';

export const cardLinkReviewApproved = 'FLUPFLAP_DELETED_CARD_LINK_APPROVED';
export const cardLinkReviewRevoked = 'FLUPFLAP_DELETED_CARD_LINK_REVOKED';

/** Admin-only recovery for an already-refunded, false-positive association.
 * Does not replay the old order, restore a deleted account, or approve a charge.
 */
export async function reviewDeletedCardLink(db: PrismaClient, stripe: StripeHostedCheckoutProvider | undefined,
  transactionId: string, linkedCustomerId: string, actor: string, note: string, approve: boolean) {
  const reject = () => new MobileTopUpError('CARD_LINK_REVIEW_NOT_ALLOWED', 'Card association cannot be reviewed in its current state.', 409);
  if (!actor || note.trim().length < 20 || note.length > 500) throw reject();
  const order = await db.mobileTopUpTransaction.findUnique({ where: { id: transactionId } });
  const assessment = await db.rechargeFraudAssessment.findUnique({ where: { transactionId } });
  if (!order || !assessment?.fingerprint || !order.flupFlapCustomerId ||
      assessment.customerId !== order.flupFlapCustomerId || linkedCustomerId === assessment.customerId ||
      order.testMode || order.paymentProvider !== 'STRIPE' || order.paymentStatus !== 'REFUNDED' ||
      order.status !== 'FAILED' || !['LINKED_ACCOUNT_REVIEW', 'SHARED_CARD_REVIEW'].includes(assessment.reason ?? '')) throw reject();
  if (approve) {
    if (!stripe || !order.paymentProviderTransactionId) throw reject();
    const evidence = await stripe.fraudEvidence(order.paymentProviderTransactionId, order.id);
    // A refund is expected here; all other current issuer/Radar checks must pass.
    if (!evidence.refunded || evidence.chargeId !== assessment.chargeId || !evidence.fingerprint ||
        createHash('sha256').update(evidence.fingerprint).digest('hex') !== assessment.fingerprint ||
        paymentReviewReason({ ...evidence, refunded: false })) throw reject();
  }
  return db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${`recharge-card:${assessment.fingerprint}`}, 0))`;
    const customer = await tx.flupFlapCustomer.findUnique({ where: { id: assessment.customerId } });
    const linked = await tx.flupFlapCustomer.findUnique({ where: { id: linkedCustomerId } });
    const associated = await tx.rechargeFraudAssessment.findFirst({ where: {
      customerId: linkedCustomerId, fingerprint: assessment.fingerprint,
      createdAt: { gte: new Date(Date.now() - 30 * 86400000) },
    } });
    if (!associated || (approve && (!customer || customer.status !== 'ACTIVE' || customer.rechargeRestricted ||
        customer.guestExpiresAt || linked?.status !== 'DELETED'))) throw reject();
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    await tx.auditLog.create({ data: {
      userId: actor,
      entity: 'FlupFlapCustomer', entityId: assessment.customerId,
      action: approve ? cardLinkReviewApproved : cardLinkReviewRevoked,
      metadata: { transactionId, linkedCustomerId, fingerprint: assessment.fingerprint, note: note.trim(), expiresAt },
    } });
    return { approved: approve, expiresAt: approve ? expiresAt : null, originalOrderUnchanged: true };
  });
}

/** A support-reviewed association, never an exemption from payment checks.
 * Reviews are scoped to one buyer, one hashed card, and one deleted account.
 * The newest decision wins, including an expired or revoked decision.
 */
export async function unreviewedCardLinks(db: Prisma.TransactionClient, customerId: string,
  fingerprint: string, linkedCustomerIds: string[], now = new Date()) {
  const ids = [...new Set(linkedCustomerIds)];
  if (!ids.length) return ids;
  const decisions = await db.auditLog.findMany({ where: {
    entity: 'FlupFlapCustomer', entityId: customerId,
    action: { in: [cardLinkReviewApproved, cardLinkReviewRevoked] },
    createdAt: { gte: new Date(now.getTime() - 30 * 86400000), lte: now },
  }, orderBy: [{ createdAt: 'desc' }, { action: 'desc' }, { id: 'desc' }],
  select: { action: true, metadata: true, createdAt: true, userId: true } });
  const seen = new Set<string>();
  const approved = new Set<string>();
  for (const decision of decisions) {
    const m = decision.metadata as Record<string, unknown> | null;
    if (!m || m.fingerprint !== fingerprint || typeof m.linkedCustomerId !== 'string' || !ids.includes(m.linkedCustomerId)) continue;
    if (seen.has(m.linkedCustomerId)) continue;
    seen.add(m.linkedCustomerId);
    const expires = typeof m.expiresAt === 'string' ? Date.parse(m.expiresAt) : NaN;
    if (decision.action === cardLinkReviewApproved && decision.userId &&
        typeof m.note === 'string' && m.note.trim().length >= 20 &&
        expires > now.getTime() && expires <= decision.createdAt.getTime() + 30 * 86400000) {
      approved.add(m.linkedCustomerId);
    }
  }
  if (!approved.size) return ids;
  // Restored/suspended/active accounts cannot use a deleted-account exception.
  const deleted = await db.flupFlapCustomer.findMany({ where: {
    id: { in: [...approved] }, status: 'DELETED',
  }, select: { id: true } });
  const cleared = new Set(deleted.map(c => c.id));
  return ids.filter(id => !cleared.has(id));
}
