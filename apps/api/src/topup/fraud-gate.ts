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
      const current = await tx.flupFlapCustomer.findUnique({ where: { id: customerId } });
      if (!current || current.status !== 'ACTIVE' || current.rechargeRestricted || current.guestExpiresAt) return 'ACCOUNT_REVIEW_REQUIRED';
      const saved = await tx.rechargeFraudAssessment.findUnique({ where: { transactionId: record.id } });
      // Reviews remain held on webhook retries and reconciliation.
      if (saved?.reason) return saved.reason;
      const recent = await tx.rechargeFraudAssessment.findMany({ where: { customerId,
        createdAt: { gte: new Date(Date.now() - 86400000) }, transactionId: { not: record.id } } });
      const cards = new Set(recent.map(r => r.fingerprint).filter(Boolean));
      if (fingerprint) cards.add(fingerprint);
      const reason = paymentReviewReason(evidence) ?? (cards.size > 2 ? 'CARD_SWITCHING_REVIEW' : undefined);
      const data = { customerId, fingerprint, chargeId: evidence.chargeId, risk: evidence.risk,
        authentication: evidence.authentication ?? null, reason: reason ?? null };
      await tx.rechargeFraudAssessment.upsert({ where: { transactionId: record.id }, create: { transactionId: record.id, ...data }, update: data });
      return reason;
    });
  };
}
