import { createHash } from 'node:crypto';
import { z } from 'zod';

const timestamp = z.iso.datetime({ offset: true });
const reference = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/);
const category = z.enum(['VERIFICATION_ATTACHMENT', 'SUPPORT_CORRESPONDENCE', 'SECURITY_LOG',
  'FINANCIAL_EVIDENCE', 'DELETION_LEDGER', 'BACKUP']);

// Inputs are operator attestations, not independently verified authority to erase data.
// This module has no database, provider client, executor or default retention duration.
export const retentionPlanInput = z.object({
  version: z.literal(1),
  asOf: timestamp,
  policy: z.object({
    reference,
    status: z.enum(['PROPOSED', 'APPROVED']),
    approvedAt: timestamp.nullable(),
    durationsDays: z.object({
      VERIFICATION_ATTACHMENT: z.number().int().min(1).max(36500).nullable(),
      SUPPORT_CORRESPONDENCE: z.number().int().min(1).max(36500).nullable(),
      SECURITY_LOG: z.number().int().min(1).max(36500).nullable(),
    }).strict(),
  }).strict(),
  records: z.array(z.object({
    reference,
    product: z.enum(['FLUPFLAP', 'TICASH']),
    category,
    source: z.enum(['LOCAL', 'STRIPE', 'RELOADLY', 'EMAIL', 'SUPPORT', 'BACKUP']),
    clock: z.enum(['CASE_CLOSED', 'EVENT_OCCURRED', 'UNRESOLVED']),
    startAt: timestamp.nullable(),
    inventoryVerified: z.boolean(),
    ownership: z.enum(['EXCLUSIVE', 'SHARED', 'UNKNOWN']),
    hold: z.enum(['CLEAR', 'ACTIVE', 'UNKNOWN']),
    unresolvedWork: z.boolean(),
  }).strict()).max(10000),
}).strict().superRefine((input, ctx) => {
  const seen = new Set<string>();
  input.records.forEach((record, i) => {
    if (seen.has(record.reference)) ctx.addIssue({ code: 'custom', path: ['records', i], message: 'DUPLICATE_REFERENCE' });
    seen.add(record.reference);
  });
  if (input.policy.status === 'APPROVED' && input.policy.approvedAt === null) {
    ctx.addIssue({ code: 'custom', path: ['policy'], message: 'APPROVAL_DATE_REQUIRED' });
  }
});

type ReviewReason = 'OTHER_PRODUCT' | 'POLICY_NOT_APPROVED' | 'APPROVAL_IN_FUTURE' |
  'INVENTORY_UNVERIFIED' | 'OWNERSHIP_UNRESOLVED' | 'HOLD_ACTIVE_OR_UNKNOWN' |
  'WORK_UNRESOLVED' | 'SPECIALIST_REVIEW_REQUIRED' | 'CLOCK_UNRESOLVED' |
  'START_IN_FUTURE' | 'DURATION_UNDEFINED' | 'PROVIDER_REVIEW_REQUIRED' | 'NOT_EXPIRED' | 'EXPIRY_REVIEW_CANDIDATE';

export function planFlupFlapRetention(raw: unknown) {
  const input = retentionPlanInput.parse(raw);
  const now = Date.parse(input.asOf);
  const counts = { blocked: 0, retained: 0, reviewCandidates: 0 };
  const records = input.records.map(record => {
    let reason: ReviewReason;
    let expiresAt: string | null = null;
    if (record.product !== 'FLUPFLAP') reason = 'OTHER_PRODUCT';
    else if (input.policy.status !== 'APPROVED') reason = 'POLICY_NOT_APPROVED';
    else if (Date.parse(input.policy.approvedAt!) > now) reason = 'APPROVAL_IN_FUTURE';
    else if (!record.inventoryVerified) reason = 'INVENTORY_UNVERIFIED';
    else if (record.ownership !== 'EXCLUSIVE') reason = 'OWNERSHIP_UNRESOLVED';
    else if (record.hold !== 'CLEAR') reason = 'HOLD_ACTIVE_OR_UNKNOWN';
    else if (record.unresolvedWork) reason = 'WORK_UNRESOLVED';
    // Financial evidence, suppression ledgers and backups never become generic purge candidates.
    else if (record.category === 'FINANCIAL_EVIDENCE' || record.category === 'DELETION_LEDGER' ||
      record.category === 'BACKUP') reason = 'SPECIALIST_REVIEW_REQUIRED';
    else if (!record.startAt || record.clock !==
      (record.category === 'SECURITY_LOG' ? 'EVENT_OCCURRED' : 'CASE_CLOSED')) reason = 'CLOCK_UNRESOLVED';
    else if (Date.parse(record.startAt) > now) reason = 'START_IN_FUTURE';
    else {
      const duration = input.policy.durationsDays[record.category];
      if (duration === null) reason = 'DURATION_UNDEFINED';
      else {
        expiresAt = new Date(Date.parse(record.startAt) + duration * 86400000).toISOString();
        if (Date.parse(expiresAt) > now) reason = 'NOT_EXPIRED';
        else if (record.source !== 'LOCAL' && record.source !== 'SUPPORT') reason = 'PROVIDER_REVIEW_REQUIRED';
        else reason = 'EXPIRY_REVIEW_CANDIDATE';
      }
    }
    const status = reason === 'EXPIRY_REVIEW_CANDIDATE' ? 'REVIEW_CANDIDATE' :
      reason === 'NOT_EXPIRED' ? 'RETAIN' : 'BLOCKED';
    if (status === 'REVIEW_CANDIDATE') counts.reviewCandidates++;
    else if (status === 'RETAIN') counts.retained++;
    else counts.blocked++;
    // Do not echo operator input references into terminal/build logs.
    const recordHash = createHash('sha256').update(record.reference).digest('hex');
    return { recordHash, category: record.category, status, reason, expiresAt };
  });
  return { version: 1, mode: 'READ_ONLY_REVIEW', executionAuthorized: false,
    sourceAttestationsIndependentlyVerified: false, asOf: input.asOf, counts, records };
}
