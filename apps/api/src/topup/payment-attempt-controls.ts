import { temporaryPurchaseAccess } from './fraud-policy.js';
import type { Prisma } from '@prisma/client';

/** Signed Stripe failures plus paid-card evidence; never raw card details.
 * Device associations are an evadable signal, not proof of a person's identity. */
export async function paymentAttemptAccess(db: Prisma.TransactionClient, customerId: string,
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
  const failureReset = failures.size >= 3 ? attempts.filter(a=>failures.has(a.id)).map(a=>a.occurredAt.getTime()).sort((a,b)=>a-b)[failures.size-3]!+15*60000 : undefined;
  const paid = await db.rechargeFraudAssessment.findMany({ where: { customerId: { in: customers }, createdAt: { gte: day } },
    select: { fingerprint: true, createdAt: true } });
  const cards = new Set([...attempts, ...paid].map(a => a.fingerprint).filter(Boolean));
  if (currentFingerprint) cards.add(currentFingerprint);
  const evidence=[...attempts.map(a=>({fingerprint:a.fingerprint,at:a.occurredAt.getTime()})),...paid.filter(a=>a.fingerprint).map(a=>({fingerprint:a.fingerprint,at:a.createdAt.getTime()}))];
  const cardReset=cards.size>2 ? [...new Set(evidence.map(a=>a.at+86400000+1))].sort((a,b)=>a-b).find(at=>new Set([...evidence.filter(a=>a.at>=at-86400000).map(a=>a.fingerprint),currentFingerprint].filter(Boolean)).size<=2) : undefined;
  if(failureReset===undefined && cards.size<=2)return undefined;
  return {code:failureReset!==undefined?'PAYMENT_ATTEMPT_LIMIT':'PAYMENT_CARD_LIMIT',
    purchaseAccess:temporaryPurchaseAccess(Math.max(failureReset??0,cardReset??0),now)};
}

export async function paymentAttemptReviewReason(db: Prisma.TransactionClient, customerId:string, now=new Date(), currentFingerprint?:string, additionalCustomers:string[]=[], lockDevices=false) {
  return (await paymentAttemptAccess(db,customerId,now,currentFingerprint,additionalCustomers,lockDevices))?.code;
}
