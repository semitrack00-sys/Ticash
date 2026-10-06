import { readFileSync, writeFileSync } from 'node:fs';
import { AccountDeletionError } from './account-deletion.js';
import { exportDeletionLedger, suppressRestoredFlupFlapAccounts } from './deletion-ledger.js';

const args = process.argv.slice(2);
const initialize = args.length === 3 && args[0] === 'initialize' && args[1] === '--output';
const exporting = args.length === 5 && args[0] === 'export' && args[1] === '--output' && args[3] === '--prior';
const restoring = (args.length === 5 || args.length === 6) && args[0] === 'restore' &&
  args[1] === '--ledger' && args[3] === '--request-file' && (args[5] === undefined || args[5] === '--execute');
if (!initialize && !exporting && !restoring) {
  console.error('Usage: deletion-ledger-cli.js initialize --output FILE | export --output FILE --prior FILE | restore --ledger FILE --request-file FILE [--execute]');
  process.exitCode = 1;
} else if (!process.env.DATABASE_URL || process.env.NODE_ENV === 'test') {
  console.error('PERSISTENT_DATABASE_REQUIRED'); process.exitCode = 1;
} else {
  const { prisma, disconnectDatabase } = await import('../database.js');
  try {
    const key = process.env.FLUPFLAP_LEDGER_SIGNING_KEY ?? '';
    if (restoring) {
      const manifest: unknown = JSON.parse(readFileSync(args[2]!, 'utf8'));
      const request: unknown = JSON.parse(readFileSync(args[4]!, 'utf8'));
      console.log(JSON.stringify(await suppressRestoredFlupFlapAccounts(prisma, manifest, key, request, args[5] === '--execute')));
    } else {
      const prior = exporting ? { manifest: JSON.parse(readFileSync(args[4]!, 'utf8')) as unknown,
        checkpoint: process.env.FLUPFLAP_LEDGER_CHECKPOINT ?? '' } : undefined;
      const result = await exportDeletionLedger(prisma, key, process.env.FLUPFLAP_LEDGER_NAMESPACE ?? '', prior);
      // Never overwrite the last independent ledger or place erased PII in the export.
      writeFileSync(args[2]!, JSON.stringify(result.manifest), { mode: 0o600, flag: 'wx' });
      console.log(JSON.stringify({ entries: result.manifest.payload.entries.length, checkpoint: result.checkpoint,
        durableStorageConfirmed: false }));
    }
  } catch (error) {
    console.error(error instanceof AccountDeletionError ? error.code : 'LEDGER_FAILED_REVIEW_REQUIRED');
    process.exitCode = 1;
  } finally { await disconnectDatabase(); }
}
