import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AccountDeletionError, eraseFlupFlapAccountData } from './account-deletion.js';

const entry = z.object({ customerId: z.uuid(), auditId: z.uuid(), deletedAt: z.iso.datetime() }).strict();
const payloadSchema = z.object({
  version: z.literal(1), namespace: z.uuid(), exportedAt: z.iso.datetime(),
  entries: z.array(entry).max(100000),
}).strict();
const manifestSchema = z.object({
  payload: payloadSchema, signature: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
type Payload = z.infer<typeof payloadSchema>;
type Entry = z.infer<typeof entry>;
function requireKey(key: string) {
  if (Buffer.byteLength(key) < 32) throw new AccountDeletionError('LEDGER_KEY_REQUIRED');
}
function canonical(payload: Payload) { return JSON.stringify(payload); }
function sign(payload: Payload, key: string) { return createHmac('sha256', key).update(canonical(payload)).digest('hex'); }
export function ledgerCheckpoint(manifest: unknown) {
  const parsed = manifestSchema.parse(manifest);
  return createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
}
export function verifyDeletionLedger(raw: unknown, key: string, namespace: string, expectedCheckpoint: string) {
  requireKey(key);
  const parsed = manifestSchema.parse(raw);
  if (parsed.payload.namespace !== namespace) throw new AccountDeletionError('LEDGER_NAMESPACE_MISMATCH');
  if (!/^[a-f0-9]{64}$/.test(expectedCheckpoint) || ledgerCheckpoint(parsed) !== expectedCheckpoint) {
    throw new AccountDeletionError('LEDGER_CHECKPOINT_MISMATCH');
  }
  if (!timingSafeEqual(Buffer.from(parsed.signature, 'hex'), Buffer.from(sign(parsed.payload, key), 'hex'))) {
    throw new AccountDeletionError('LEDGER_SIGNATURE_INVALID');
  }
  const ids = new Set(parsed.payload.entries.map(value => value.customerId));
  if (ids.size !== parsed.payload.entries.length) throw new AccountDeletionError('LEDGER_DUPLICATE_IDENTITY');
  return parsed;
}

// Merge the independently held previous ledger; a restored database can lack historical receipts.
export async function exportDeletionLedger(db: PrismaClient, key: string, namespace: string,
  prior?: { manifest: unknown; checkpoint: string }) {
  requireKey(key); z.uuid().parse(namespace);
  const entries = new Map<string, Entry>();
  if (prior) for (const value of verifyDeletionLedger(prior.manifest, key, namespace, prior.checkpoint).payload.entries) {
    entries.set(value.customerId, value);
  }
  const audits = await db.auditLog.findMany({
    where: { action: 'FLUPFLAP_ACCOUNT_DELETED', entity: 'FlupFlapCustomer' },
    select: { id: true, entityId: true, createdAt: true },
  });
  for (const audit of audits) {
    const value = entry.parse({ customerId: audit.entityId, auditId: audit.id, deletedAt: audit.createdAt.toISOString() });
    if (!entries.has(value.customerId)) entries.set(value.customerId, value);
  }
  const payload = payloadSchema.parse({ version: 1, namespace, exportedAt: new Date().toISOString(),
    entries: [...entries.values()].sort((a, b) => a.customerId.localeCompare(b.customerId)) });
  const manifest = { payload, signature: sign(payload, key) };
  return { manifest, checkpoint: ledgerCheckpoint(manifest) };
}

const restoreRequest = z.object({
  staffId: z.uuid(), maintenanceConfirmed: z.boolean(), namespace: z.uuid(),
  expectedCheckpoint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export async function suppressRestoredFlupFlapAccounts(db: PrismaClient, rawManifest: unknown, key: string,
  rawRequest: unknown, execute = false) {
  const request = restoreRequest.parse(rawRequest);
  const manifest = verifyDeletionLedger(rawManifest, key, request.namespace, request.expectedCheckpoint);
  if (execute && !request.maintenanceConfirmed) throw new AccountDeletionError('MAINTENANCE_REQUIRED');
  const operator = await db.user.findUnique({ where: { id: request.staffId } });
  if (!operator || operator.accountLocked || !['ADMIN', 'SUPER_ADMIN'].includes(operator.role)) {
    throw new AccountDeletionError('ADMIN_REQUIRED');
  }
  const result = { mode: execute ? 'EXECUTED' : 'PREVIEW', entries: manifest.payload.entries.length,
    suppressed: 0, alreadyDeleted: 0, absent: 0 };
  // Each identity commits atomically. Any later failure keeps the entire restore unreleased;
  // rerun with the same complete ledger before restarting ingress or workers.
  for (const value of manifest.payload.entries) {
    const outcome = await db.$transaction(async tx => {
      const staff = await tx.user.findUnique({ where: { id: request.staffId } });
      if (!staff || staff.accountLocked || !['ADMIN', 'SUPER_ADMIN'].includes(staff.role)) {
        throw new AccountDeletionError('ADMIN_REQUIRED');
      }
      await tx.$queryRaw`SELECT id FROM "FlupFlapCustomer" WHERE id = ${value.customerId} FOR UPDATE`;
      const customer = await tx.flupFlapCustomer.findUnique({ where: { id: value.customerId } });
      if (!customer) return 'absent' as const;
      if (execute) {
        // Historical pending payments remain financial evidence. Erase their account capabilities
        // before any reconciliation; never make external calls while applying this ledger.
        await eraseFlupFlapAccountData(tx, customer.id, customer.status !== 'DELETED');
        if (customer.status !== 'DELETED') await tx.auditLog.create({ data: {
          userId: staff.id, entity: 'FlupFlapCustomer', entityId: customer.id,
          action: 'FLUPFLAP_RESTORE_SUPPRESSED',
          metadata: { originalAuditId: value.auditId, deletedAt: value.deletedAt,
            checkpoint: request.expectedCheckpoint, policyVersion: 1 },
        } });
      }
      return customer.status === 'DELETED' ? 'alreadyDeleted' as const : 'suppressed' as const;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30000 });
    result[outcome]++;
  }
  return result;
}
