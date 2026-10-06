import { readFileSync } from 'node:fs';
import { AccountDeletionError } from './account-deletion.js';
import { readLedgerFile, requireLedgerMount, storeDeletionLedger } from './deletion-ledger-storage.js';

const args = process.argv.slice(2);
if (args.length !== 5 || args[0] !== 'store' || args[1] !== '--ledger' || args[3] !== '--checkpoint') {
  console.error('Usage: deletion-ledger-storage-cli.js store --ledger FILE --checkpoint SHA256');
  process.exitCode = 1;
} else {
  try {
    const mount = '/var/data/flupflap-ledger';
    requireLedgerMount(mount, readFileSync('/proc/self/mountinfo', 'utf8'));
    const result = storeDeletionLedger(`${mount}/private`, readLedgerFile(args[2]!),
      process.env.FLUPFLAP_LEDGER_SIGNING_KEY ?? '', process.env.FLUPFLAP_LEDGER_NAMESPACE ?? '', args[4]!);
    console.log(JSON.stringify({ ...result, mountedDiskVerified: true }));
  } catch (error) {
    console.error(error instanceof AccountDeletionError ? error.code : 'LEDGER_STORAGE_FAILED_REVIEW_REQUIRED');
    process.exitCode = 1;
  }
}
