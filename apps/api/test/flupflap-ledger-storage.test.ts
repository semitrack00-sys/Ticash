import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync,
  symlinkSync, writeFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ledgerCheckpoint } from '../src/flupflap/deletion-ledger.js';
import { readLedgerFile, requireLedgerMount, storeDeletionLedger } from '../src/flupflap/deletion-ledger-storage.js';

const key = 'synthetic-storage-test-signing-key-32-bytes';
const namespace = '22222222-2222-4222-8222-222222222222';
const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'flupflap-ledger-storage-')); roots.push(root);
  const directory = join(root, 'private');
  const payload = { version: 1, namespace, exportedAt: '2026-10-06T00:00:00.000Z', entries: [{
    customerId: '11111111-1111-4111-8111-111111111111',
    auditId: '33333333-3333-4333-8333-333333333333', deletedAt: '2026-10-05T00:00:00.000Z',
  }] };
  const manifest = { payload, signature: createHmac('sha256', key).update(JSON.stringify(payload)).digest('hex') };
  return { root, directory, manifest, checkpoint: ledgerCheckpoint(manifest) };
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('independent deletion-ledger storage', () => {
  it('publishes a private verified file, preserves older records and supports a readback retry', () => {
    const f = fixture();
    const result = storeDeletionLedger(f.directory, f.manifest, key, namespace, f.checkpoint);
    expect(result).toMatchObject({ entries: 1, storageReadbackVerified: true,
      trustedCheckpointUpdated: false, restoreReleaseAuthorized: false });
    const saved = join(f.directory, result.storedFile);
    expect(statSync(f.directory).mode & 0o777).toBe(0o700);
    expect(statSync(saved).mode & 0o777).toBe(0o600);
    expect(readLedgerFile(saved)).toEqual(f.manifest);
    const before = statSync(saved).ino;
    expect(storeDeletionLedger(f.directory, f.manifest, key, namespace, f.checkpoint)).toEqual(result);
    expect(statSync(saved).ino).toBe(before);
    const nextPayload = { ...f.manifest.payload, exportedAt: '2026-10-06T01:00:00.000Z' };
    const next = { payload: nextPayload, signature: createHmac('sha256', key).update(JSON.stringify(nextPayload)).digest('hex') };
    storeDeletionLedger(f.directory, next, key, namespace, ledgerCheckpoint(next));
    expect(readdirSync(f.directory).sort()).toEqual([`${f.checkpoint}.json`, `${ledgerCheckpoint(next)}.json`].sort());
    expect(readLedgerFile(saved)).toEqual(f.manifest);
  });
  it('rejects tampering, wrong environment and wrong checkpoint before filesystem mutation', () => {
    const f = fixture();
    const tampered = { ...f.manifest, signature: '0'.repeat(64) };
    expect(() => storeDeletionLedger(f.directory, tampered, key, namespace, ledgerCheckpoint(tampered))).toThrow('LEDGER_SIGNATURE_INVALID');
    expect(() => storeDeletionLedger(f.directory, f.manifest, key, '44444444-4444-4444-8444-444444444444', f.checkpoint)).toThrow('LEDGER_NAMESPACE_MISMATCH');
    expect(() => storeDeletionLedger(f.directory, f.manifest, key, namespace, '0'.repeat(64))).toThrow('LEDGER_CHECKPOINT_MISMATCH');
    expect(existsSync(f.directory)).toBe(false);
  });
  it('fails closed on a corrupt existing target instead of replacing it', () => {
    const f = fixture();
    const result = storeDeletionLedger(f.directory, f.manifest, key, namespace, f.checkpoint);
    const saved = join(f.directory, result.storedFile);
    writeFileSync(saved, 'incomplete file');
    expect(() => storeDeletionLedger(f.directory, f.manifest, key, namespace, f.checkpoint)).toThrow();
    expect(readFileSync(saved, 'utf8')).toBe('incomplete file');
    expect(readdirSync(f.directory)).toEqual([result.storedFile]);
  });
  it('rejects symlink destinations and insecure directory or file permissions', () => {
    const f = fixture();
    symlinkSync(f.root, f.directory, 'dir');
    expect(() => storeDeletionLedger(f.directory, f.manifest, key, namespace, f.checkpoint)).toThrow('LEDGER_STORAGE_PERMISSIONS_INVALID');
    rmSync(f.directory);
    const result = storeDeletionLedger(f.directory, f.manifest, key, namespace, f.checkpoint);
    chmodSync(f.directory, 0o755);
    expect(() => storeDeletionLedger(f.directory, f.manifest, key, namespace, f.checkpoint)).toThrow('LEDGER_STORAGE_PERMISSIONS_INVALID');
    chmodSync(f.directory, 0o700);
    const saved = join(f.directory, result.storedFile);
    chmodSync(saved, 0o644);
    expect(() => storeDeletionLedger(f.directory, f.manifest, key, namespace, f.checkpoint)).toThrow('LEDGER_STORAGE_PERMISSIONS_INVALID');
    rmSync(saved); symlinkSync(join(f.root, 'missing'), saved);
    expect(() => storeDeletionLedger(f.directory, f.manifest, key, namespace, f.checkpoint)).toThrow('LEDGER_STORAGE_PERMISSIONS_INVALID');
  });
  it('requires an actual mount and refuses symlink input files', () => {
    requireLedgerMount('/var/data/flupflap-ledger', '1 2 0:1 / /var/data/flupflap-ledger rw - ext4 /dev/x rw');
    expect(() => requireLedgerMount('/var/data/flupflap-ledger', '1 2 0:1 / / rw - ext4 /dev/x rw')).toThrow('LEDGER_DISK_NOT_MOUNTED');
    const f = fixture(); const input = join(f.root, 'input');
    const target = join(f.root, 'target'); writeFileSync(target, JSON.stringify(f.manifest)); symlinkSync(target, input);
    expect(() => readLedgerFile(input)).toThrow();
  });
});
