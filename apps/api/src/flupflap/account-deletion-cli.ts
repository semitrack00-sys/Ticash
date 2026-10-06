import { readFileSync } from 'node:fs';
import { AccountDeletionError, deleteFlupFlapAccount } from './account-deletion.js';

const args = process.argv.slice(2);
if (args.length < 2 || args.length > 3 || args[0] !== '--request-file' ||
    (args[2] !== undefined && args[2] !== '--execute')) {
  console.error('Usage: node apps/api/dist/flupflap/account-deletion-cli.js --request-file /secure/request.json [--execute]');
  process.exitCode = 1;
} else if (!process.env.DATABASE_URL || process.env.NODE_ENV === 'test') {
  console.error('PERSISTENT_DATABASE_REQUIRED');
  process.exitCode = 1;
} else {
  let disconnect: (() => Promise<void>) | undefined;
  try {
    const { prisma, disconnectDatabase } = await import('../database.js');
    disconnect = disconnectDatabase;
    const input: unknown = JSON.parse(readFileSync(args[1]!, 'utf8'));
    console.log(JSON.stringify(await deleteFlupFlapAccount(prisma, input, args[2] === '--execute')));
  } catch (error) {
    // Never print the request, verified email, database URL or SQL diagnostics.
    console.error(error instanceof AccountDeletionError ? error.code : 'DELETION_FAILED_REVIEW_REQUIRED');
    process.exitCode = 1;
  } finally {
    await disconnect?.();
  }
}
