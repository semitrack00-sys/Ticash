import { z } from 'zod';
import { planFlupFlapRetention, retentionPlanInput } from './retention-plan.js';

const ref = z.string().regex(/^[A-Za-z0-9_-]{4,64}$/);
const date = z.iso.datetime({ offset: true });

// Private operator-maintained registry. These attestations are not disposal authority.
export const supportRetentionInput = z.object({
  version: z.literal(1),
  asOf: date,
  policy: retentionPlanInput.shape.policy,
  cases: z.array(z.object({
    reference: ref,
    product: z.enum(['FLUPFLAP', 'TICASH']),
    status: z.enum(['OPEN', 'CLOSED']),
    openedAt: date,
    closedAt: date.nullable(),
    closureRecordedBy: ref.nullable(),
    closureReviewedAt: date.nullable(),
    inventoryVerified: z.boolean(),
    ownership: z.enum(['EXCLUSIVE', 'SHARED', 'UNKNOWN']),
    hold: z.enum(['CLEAR', 'ACTIVE', 'UNKNOWN']),
    unresolvedWork: z.boolean(),
    items: z.array(z.object({
      reference: ref,
      category: z.enum(['VERIFICATION_ATTACHMENT', 'SUPPORT_CORRESPONDENCE']),
      source: z.enum(['EMAIL', 'SUPPORT', 'LOCAL']),
    }).strict()).min(1).max(1000),
  }).strict()).max(1000),
}).strict().superRefine((input, ctx) => {
  const seen = new Set<string>();
  let itemCount = 0;
  input.cases.forEach((c, i) => {
    const fail = () => ctx.addIssue({ code: 'custom', path: ['cases', i], message: 'CASE_REVIEW_REQUIRED' });
    if (seen.has(c.reference)) fail();
    seen.add(c.reference);
    const now = Date.parse(input.asOf);
    if (Date.parse(c.openedAt) > now) fail();
    if (c.status === 'OPEN') {
      if (c.closedAt !== null || c.closureRecordedBy !== null || c.closureReviewedAt !== null) fail();
    } else if (!c.closedAt || !c.closureRecordedBy || !c.closureReviewedAt) fail();
    else if (Date.parse(c.closedAt) < Date.parse(c.openedAt) ||
      Date.parse(c.closureReviewedAt) < Date.parse(c.closedAt) || Date.parse(c.closureReviewedAt) > now) fail();
    for (const item of c.items) {
      if (seen.has(item.reference)) fail();
      seen.add(item.reference);
      itemCount++;
    }
  });
  if (itemCount > 10000) ctx.addIssue({ code: 'custom', message: 'INVENTORY_TOO_LARGE' });
});

export function planSupportCaseRetention(raw: unknown) {
  const input = supportRetentionInput.parse(raw);
  return planFlupFlapRetention({ version: input.version, asOf: input.asOf, policy: input.policy,
    records: input.cases.flatMap(c => c.items.map(item => ({ ...item, product: c.product,
      clock: c.status === 'CLOSED' ? 'CASE_CLOSED' : 'UNRESOLVED', startAt: c.closedAt,
      inventoryVerified: c.inventoryVerified, ownership: c.ownership, hold: c.hold,
      unresolvedWork: c.unresolvedWork || c.status === 'OPEN',
    }))),
  });
}
