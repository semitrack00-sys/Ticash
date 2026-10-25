import type { Prisma } from '@prisma/client';

/** Signed Stripe failures plus paid-card evidence; never raw card details.
 * Device associations are an evadable signal, not proof of a person's identity. */
export async function paymentAttemptReviewReason(db: Prisma.TransactionClient, customerId: string,
  now = new Date(), currentFingerprint?: string, additionalCustomers: string[] = [], lockDevices = false) {
  const day = new Date(now.getTime() - 86400000);
  const devices = await db.flupFlapDevice.findMany({ where: { customerId, lastSeenAt: { gte: day } } });
  if (lockDevices) for (const deviceHash of [...new Set(devices.map(d => d.deviceHash))].sort()) {
    await db.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${deviceHash}, 0))`;
  }
  const linked = devices.length ? await db.flupFlapDevice.findMany({ where: {
    deviceHash: { in: devices.map(d => d.deviceHash) }, lastSeenAt: { gte: day },
  } }) : [];
  const customers = [...new Set([customerId, ...additionalCustomers, ...linked.map(d => d.customerId)])];
  const rows = await db.auditLog.findMany({ where: {
    action: 'FLUPFLAP_PAYMENT_ATTEMPT_FAILED', createdAt: { gte: day }, flupFlapCustomerId: { in: customers },
  }, select: { id: true, createdAt: true, metadata: true } });
  const attempts = rows.map(row => {
    const metadata = row.metadata as Record<string, unknown> | null;
    return { id: row.id, occurredAt: row.createdAt,
      fingerprint: typeof metadata?.fingerprint === 'string' ? metadata.fingerprint : undefined };
  });
  const failures = new Set(attempts.filter(a => a.occurredAt.getTime() > now.getTime() - 15 * 60000).map(a => a.id));
  if (failures.size >= 3) return 'PAYMENT_ATTEMPT_LIMIT';
  const paid = await db.rechargeFraudAssessment.findMany({ where: { customerId: { in: customers }, createdAt: { gte: day } },
    select: { fingerprint: true } });
  const cards = new Set([...attempts, ...paid].map(a => a.fingerprint).filter(Boolean));
  if (currentFingerprint) cards.add(currentFingerprint);
  if (cards.size > 2) return 'PAYMENT_CARD_LIMIT';
  return undefined;
}
