import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { planFlupFlapRetention } from '../src/flupflap/retention-plan.js';

const input = () => ({ version: 1, asOf: '2026-10-06T00:00:00Z', policy: {
  reference: 'POLICY_0001', status: 'APPROVED', approvedAt: '2026-09-01T00:00:00Z',
  durationsDays: { VERIFICATION_ATTACHMENT: 30, SUPPORT_CORRESPONDENCE: 90, SECURITY_LOG: 180 },
}, records: [{ reference: 'PRIVATE_RECORD_SENTINEL', product: 'FLUPFLAP', category: 'VERIFICATION_ATTACHMENT',
  source: 'LOCAL', clock: 'CASE_CLOSED', startAt: '2026-09-06T00:00:00Z', inventoryVerified: true,
  ownership: 'EXCLUSIVE', hold: 'CLEAR', unresolvedWork: false }] });

describe('read-only FlupFlap retention planning', () => {
  it('finds exact-boundary expiry without granting execution authority or mutating input', () => {
    const fixture = input();
    const before = JSON.stringify(fixture);
    const result = planFlupFlapRetention(fixture);
    expect(result.counts).toEqual({ blocked: 0, retained: 0, reviewCandidates: 1 });
    expect(result.records[0]?.expiresAt).toBe('2026-10-06T00:00:00.000Z');
    expect(result.executionAuthorized).toBe(false);
    expect(result.sourceAttestationsIndependentlyVerified).toBe(false);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_RECORD_SENTINEL');
    expect(JSON.stringify(fixture)).toBe(before);
  });
  it.each([
    ['product', 'TICASH', 'OTHER_PRODUCT'], ['inventoryVerified', false, 'INVENTORY_UNVERIFIED'],
    ['ownership', 'SHARED', 'OWNERSHIP_UNRESOLVED'], ['ownership', 'UNKNOWN', 'OWNERSHIP_UNRESOLVED'],
    ['hold', 'ACTIVE', 'HOLD_ACTIVE_OR_UNKNOWN'], ['hold', 'UNKNOWN', 'HOLD_ACTIVE_OR_UNKNOWN'],
    ['unresolvedWork', true, 'WORK_UNRESOLVED'], ['clock', 'EVENT_OCCURRED', 'CLOCK_UNRESOLVED'],
    ['clock', 'UNRESOLVED', 'CLOCK_UNRESOLVED'], ['startAt', null, 'CLOCK_UNRESOLVED'],
    ['startAt', '2026-10-07T00:00:00Z', 'START_IN_FUTURE'],
    ['category', 'FINANCIAL_EVIDENCE', 'SPECIALIST_REVIEW_REQUIRED'],
    ['category', 'DELETION_LEDGER', 'SPECIALIST_REVIEW_REQUIRED'],
    ['category', 'BACKUP', 'SPECIALIST_REVIEW_REQUIRED'],
    ['source', 'STRIPE', 'PROVIDER_REVIEW_REQUIRED'], ['source', 'RELOADLY', 'PROVIDER_REVIEW_REQUIRED'],
    ['source', 'EMAIL', 'PROVIDER_REVIEW_REQUIRED'],
  ])('blocks %s=%s', (field, value, reason) => {
    const fixture = input();
    Object.assign(fixture.records[0]!, { [field]: value });
    expect(planFlupFlapRetention(fixture).records[0]).toMatchObject({ status: 'BLOCKED', reason });
  });
  it('does not activate proposed limits or accept future approval', () => {
    const fixture = input(); fixture.policy.status = 'PROPOSED';
    expect(planFlupFlapRetention(fixture).records[0]?.reason).toBe('POLICY_NOT_APPROVED');
    fixture.policy.status = 'APPROVED'; fixture.policy.approvedAt = '2026-10-07T00:00:00Z';
    expect(planFlupFlapRetention(fixture).records[0]?.reason).toBe('APPROVAL_IN_FUTURE');
  });
  it('blocks missing durations and retains records before their expiry', () => {
    const fixture = input();
    Object.assign(fixture.policy.durationsDays, { VERIFICATION_ATTACHMENT: null });
    expect(planFlupFlapRetention(fixture).records[0]?.reason).toBe('DURATION_UNDEFINED');
    fixture.policy.durationsDays.VERIFICATION_ATTACHMENT = 31;
    expect(planFlupFlapRetention(fixture).records[0]).toMatchObject({ status: 'RETAIN', reason: 'NOT_EXPIRED' });
  });
  it('uses event time for security logs and UTC elapsed days with offsets', () => {
    const fixture = input();
    Object.assign(fixture.records[0]!, { category: 'SECURITY_LOG', clock: 'CASE_CLOSED' });
    expect(planFlupFlapRetention(fixture).records[0]?.reason).toBe('CLOCK_UNRESOLVED');
    Object.assign(fixture.records[0]!, { clock: 'EVENT_OCCURRED', startAt: '2026-04-08T17:00:00-07:00' });
    expect(planFlupFlapRetention(fixture).records[0]?.status).toBe('REVIEW_CANDIDATE');
  });
  it('rejects duplicate references, undefined approval date, invalid timestamps and extra fields', () => {
    const duplicate = input(); duplicate.records.push({ ...duplicate.records[0]! });
    expect(() => planFlupFlapRetention(duplicate)).toThrow();
    const noApproval = input(); Object.assign(noApproval.policy, { approvedAt: null });
    expect(() => planFlupFlapRetention(noApproval)).toThrow();
    expect(() => planFlupFlapRetention({ ...input(), asOf: 'invalid' })).toThrow();
    expect(() => planFlupFlapRetention({ ...input(), execute: true })).toThrow();
  });
});

describe('private retention planner CLI', () => {
  const cli = fileURLToPath(new URL('../src/flupflap/retention-plan-cli.ts', import.meta.url));
  const run = (args: string[]) => spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, DATABASE_URL: 'PRIVATE_DATABASE_SENTINEL', STRIPE_SECRET_KEY: 'PRIVATE_STRIPE_SENTINEL' },
  });
  it('reads a private fixture without touching it or requiring a database/provider', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retention-plan-'));
    try {
      const file = join(dir, 'input.json'); const bytes = JSON.stringify(input());
      writeFileSync(file, bytes, { mode: 0o600 });
      const result = run(['--input-file', file]);
      expect(result.status).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({ mode: 'READ_ONLY_REVIEW', executionAuthorized: false });
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toContain('SENTINEL');
      expect(readFileSync(file, 'utf8')).toBe(bytes);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
  it('rejects execute mode, public input, symlinks, oversized input and malformed input without exposing it', () => {
    const dir = mkdtempSync(join(tmpdir(), 'retention-plan-'));
    try {
      const file = join(dir, 'private-input.json'); const link = join(dir, 'link.json');
      writeFileSync(file, JSON.stringify(input()), { mode: 0o600 });
      expect(run(['--input-file', file, '--execute']).status).toBe(1);
      symlinkSync(file, link);
      const failures = [run(['--input-file', link])];
      chmodSync(file, 0o644); failures.push(run(['--input-file', file]));
      chmodSync(file, 0o600); writeFileSync(file, 'PRIVATE_CONTENT_SENTINEL');
      failures.push(run(['--input-file', file]));
      writeFileSync(file, 'x'.repeat(1024 * 1024 + 1)); failures.push(run(['--input-file', file]));
      for (const result of failures) {
        expect(result.status).toBe(1); expect(result.stdout).toBe('');
        expect(result.stderr.trim()).toBe('RETENTION_PLAN_FAILED_REVIEW_REQUIRED');
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
