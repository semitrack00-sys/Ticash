import { constants, closeSync, fsyncSync, fstatSync, lstatSync, linkSync, mkdirSync, openSync,
  readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { AccountDeletionError } from './account-deletion.js';
import { verifyDeletionLedger } from './deletion-ledger.js';

const MAX_BYTES = 32 * 1024 * 1024;

// No database, public upload endpoint, or automatic update of the trusted checkpoint.
export function readLedgerFile(path: string): unknown {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new AccountDeletionError('LEDGER_FILE_INVALID');
    return JSON.parse(readFileSync(fd, 'utf8')) as unknown;
  } finally { closeSync(fd); }
}

export function requireLedgerMount(mountPath: string, mountInfo: string) {
  if (!mountInfo.split('\n').some(line => line.split(' ')[4] === mountPath)) {
    throw new AccountDeletionError('LEDGER_DISK_NOT_MOUNTED');
  }
}

export function storeDeletionLedger(directory: string, raw: unknown, key: string,
  namespace: string, expectedCheckpoint: string) {
  // Verify before even creating a directory or opening an output file.
  const manifest = verifyDeletionLedger(raw, key, namespace, expectedCheckpoint);
  const path = resolve(directory);
  if (realpathSync(dirname(path)) !== dirname(path)) {
    throw new AccountDeletionError('LEDGER_STORAGE_PERMISSIONS_INVALID');
  }
  let created = false;
  try { mkdirSync(path, { mode: 0o700 }); created = true; }
  catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error;
  }
  return persist();

  function persist() {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(path) !== path ||
        (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid?.()) {
      throw new AccountDeletionError('LEDGER_STORAGE_PERMISSIONS_INVALID');
    }
    if (created) {
      const parentFd = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { fsyncSync(parentFd); } finally { closeSync(parentFd); }
    }
    const final = join(path, `${expectedCheckpoint}.json`);
    const directoryFd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    let temporary: string | undefined;
    try {
      let existing = false;
      try {
        const saved = lstatSync(final);
        if (!saved.isFile() || saved.isSymbolicLink() || (saved.mode & 0o777) !== 0o600 ||
            saved.uid !== process.getuid?.()) throw new AccountDeletionError('LEDGER_STORAGE_PERMISSIONS_INVALID');
        verifyDeletionLedger(readLedgerFile(final), key, namespace, expectedCheckpoint);
        existing = true;
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
      }
      if (!existing) {
        temporary = join(path, `.pending-${randomUUID()}`);
        const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        try { writeFileSync(fd, JSON.stringify(manifest)); fsyncSync(fd); }
        finally { closeSync(fd); }
        // Atomic visibility, with no replacement of a prior ledger (including concurrent writers).
        linkSync(temporary, final);
        fsyncSync(directoryFd);
      } else {
        const fd = openSync(final, constants.O_RDONLY | constants.O_NOFOLLOW);
        try { fsyncSync(fd); } finally { closeSync(fd); }
        fsyncSync(directoryFd);
      }
      verifyDeletionLedger(readLedgerFile(final), key, namespace, expectedCheckpoint);
      return { entries: manifest.payload.entries.length, checkpoint: expectedCheckpoint,
        storedFile: `${expectedCheckpoint}.json`, storageReadbackVerified: true,
        trustedCheckpointUpdated: false, restoreReleaseAuthorized: false };
    } finally {
      try {
        if (temporary) { unlinkSync(temporary); fsyncSync(directoryFd); }
      } finally { closeSync(directoryFd); }
    }
  }
}
