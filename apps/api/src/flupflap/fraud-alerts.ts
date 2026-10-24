import type { PrismaClient } from '@prisma/client';

export type FraudAlertConfig = { key: string; from: string; to: string };
export function fraudAlertConfig(env: NodeJS.ProcessEnv = process.env): FraudAlertConfig | undefined {
  const key = env.RESEND_API_KEY?.trim();
  const from = env.FLUPFLAP_VERIFICATION_EMAIL_FROM?.trim();
  const to = env.FLUPFLAP_FRAUD_ALERT_EMAIL?.trim();
  if (!key || !from || !to) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error('Invalid fraud alert destination');
  return { key, from, to };
}
export class FlupFlapFraudAlerts {
  constructor(private db: PrismaClient, private config: FraudAlertConfig, private transport: typeof fetch = fetch) {}
  async run() {
    const now = new Date();
    // Backfill current holds, including failures before an assessment was saved.
    const held = await this.db.$queryRaw<Array<{id: string}>>`
      SELECT t.id FROM "MobileTopUpTransaction" t
      LEFT JOIN "FlupFlapFraudAlert" a ON a."transactionId" = t.id
      WHERE t."testMode" = false AND t."flupFlapCustomerId" IS NOT NULL
        AND t.status = 'PENDING' AND t."failureCode" = 'FRAUD_REVIEW_REQUIRED'
        AND t."paymentStatus" IN ('CAPTURED', 'AUTHORIZED') AND a."transactionId" IS NULL
      ORDER BY t."createdAt" ASC LIMIT 100`;
    await this.db.flupFlapFraudAlert.createMany({ data: held.map(r => ({ transactionId: r.id })), skipDuplicates: true });
    const rows = await this.db.flupFlapFraudAlert.findMany({ where: { sentAt: null, attempts: { lt: 10 },
      createdAt: { gt: new Date(now.getTime() - 23 * 3600000) },
      OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now.getTime() - 120000) } }],
    }, orderBy: { createdAt: 'asc' }, take: 25 });
    for (const row of rows) {
      const claim = await this.db.flupFlapFraudAlert.updateMany({ where: { transactionId: row.transactionId,
        sentAt: null, attempts: row.attempts, claimedAt: row.claimedAt }, data: { claimedAt: now, attempts: { increment: 1 } } });
      if (!claim.count) continue;
      try {
        const response = await this.transport('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(15000),
          headers: { Authorization: 'Bearer ' + this.config.key, 'Content-Type': 'application/json', 'Idempotency-Key': 'fraud-hold-' + row.transactionId },
          body: JSON.stringify({ from: this.config.from, to: this.config.to, subject: 'FlupFlap recharge requires review',
            text: 'A recharge was held for security review. This is a risk signal, not proof of fraud.\n\nTransaction: ' + row.transactionId +
              '\nOpen the FlupFlap section of your admin dashboard and check the current payment and delivery status before taking action.\nhttps://ticash-admin.onrender.com' }),
        });
        if (!response.ok) throw new Error('ALERT_DELIVERY_FAILED');
        await this.db.flupFlapFraudAlert.update({ where: { transactionId: row.transactionId }, data: { sentAt: new Date(), lastError: null } });
      } catch {
        await this.db.flupFlapFraudAlert.update({ where: { transactionId: row.transactionId }, data: { lastError: 'ALERT_DELIVERY_FAILED' } });
        console.warn('FlupFlap fraud alert delivery needs retry', { code: 'FRAUD_ALERT_DELIVERY_FAILED' });
      }
    }
    // Bounded retention of installation signals and expired verification secrets.
    await this.db.flupFlapDevice.deleteMany({ where: { lastSeenAt: { lt: new Date(now.getTime() - 30 * 86400000) } } });
    await this.db.flupFlapVerificationChallenge.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 7 * 86400000) } } });
  }
}
