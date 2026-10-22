import { describe, expect, it } from 'vitest';
import { planSupportCaseRetention } from '../src/flupflap/support-retention.js';

const fixture = () => ({ version: 1, asOf: '2026-10-06T13:00:00Z', policy: {
  reference: 'POLICY_0001', status: 'APPROVED', approvedAt: '2026-10-06T12:36:54Z',
  durationsDays: { VERIFICATION_ATTACHMENT: 30, SUPPORT_CORRESPONDENCE: 90, SECURITY_LOG: 180 },
}, cases: [{ reference: 'CASE_SENTINEL', product: 'FLUPFLAP', status: 'CLOSED',
  openedAt: '2026-01-01T00:00:00Z', closedAt: '2026-07-01T00:00:00Z',
  closureRecordedBy: 'OPERATOR_SENTINEL', closureReviewedAt: '2026-07-01T00:00:00Z',
  inventoryVerified: true, ownership: 'EXCLUSIVE', hold: 'CLEAR', unresolvedWork: false,
  items: [{ reference: 'ITEM_SENTINEL', category: 'SUPPORT_CORRESPONDENCE', source: 'EMAIL' }],
}] });

describe('private support case retention review', () => {
  it('uses case closure and keeps expired Gmail data blocked for provider review', () => {
    const input = fixture(); const before = JSON.stringify(input);
    const result = planSupportCaseRetention(input);
    expect(result.records[0]).toMatchObject({ status: 'BLOCKED', reason: 'PROVIDER_REVIEW_REQUIRED',
      expiresAt: '2026-09-29T00:00:00.000Z' });
    expect(result.executionAuthorized).toBe(false);
    expect(JSON.stringify(result)).not.toContain('SENTINEL');
    expect(JSON.stringify(input)).toBe(before);
  });
  it('blocks an open case even when its received/opened date is old', () => {
    const input = fixture(); Object.assign(input.cases[0]!, { status: 'OPEN', closedAt: null,
      closureRecordedBy: null, closureReviewedAt: null });
    expect(planSupportCaseRetention(input).records[0]?.reason).toBe('WORK_UNRESOLVED');
  });
  it.each([
    { closedAt: null }, { closureRecordedBy: null }, { closureReviewedAt: null },
    { closedAt: '2025-12-31T00:00:00Z' }, { closureReviewedAt: '2026-06-30T00:00:00Z' },
    { closureReviewedAt: '2026-10-07T00:00:00Z' }, { status: 'OPEN' },
  ])('rejects inconsistent or unreviewed closure metadata: %j', change => {
    const input = fixture(); Object.assign(input.cases[0]!, change);
    expect(() => planSupportCaseRetention(input)).toThrow();
  });
  it.each([
    ['product', 'TICASH', 'OTHER_PRODUCT'], ['hold', 'ACTIVE', 'HOLD_ACTIVE_OR_UNKNOWN'],
    ['ownership', 'SHARED', 'OWNERSHIP_UNRESOLVED'], ['inventoryVerified', false, 'INVENTORY_UNVERIFIED'],
  ])('preserves the %s gate', (field, value, reason) => {
    const input = fixture(); Object.assign(input.cases[0]!, { [field]: value });
    expect(planSupportCaseRetention(input).records[0]?.reason).toBe(reason);
  });
  it('rejects duplicate item references across cases and arbitrary private fields', () => {
    const input = fixture(); input.cases.push({ ...input.cases[0]!, reference: 'SECOND_CASE' });
    expect(() => planSupportCaseRetention(input)).toThrow();
    expect(() => planSupportCaseRetention({ ...fixture(), messageBody: 'PRIVATE' })).toThrow();
  });
  it('retains recent closure and identifies reviewed local attachment expiry only for review', () => {
    const input = fixture(); input.cases[0]!.closedAt = '2026-10-01T00:00:00Z';
    input.cases[0]!.closureReviewedAt = input.cases[0]!.closedAt;
    expect(planSupportCaseRetention(input).records[0]?.status).toBe('RETAIN');
    Object.assign(input.cases[0]!.items[0]!, { category: 'VERIFICATION_ATTACHMENT', source: 'LOCAL' });
    input.cases[0]!.closedAt = '2026-09-01T00:00:00Z'; input.cases[0]!.closureReviewedAt = input.cases[0]!.closedAt;
    expect(planSupportCaseRetention(input).records[0]?.status).toBe('REVIEW_CANDIDATE');
  });
});
