import { recoverLegacyCheckout } from './legacy-checkout-recovery.js';

// Run from a trusted service shell. No secret command-line arguments or API route.
async function main() {
  const [transactionId, sessionId, accountId, mode] = process.argv.slice(2);
  if (!transactionId || !sessionId || !accountId || !['--dry-run', '--apply'].includes(mode ?? '')) {
    throw new Error('Usage: node apps/api/dist/topup/legacy-checkout-recovery-cli.js TRANSACTION SESSION ACCOUNT --dry-run|--apply');
  }
  if (!process.env.DATABASE_URL || !process.env.STRIPE_RECOVERY_SECRET_KEY) {
    throw new Error('DATABASE_URL and STRIPE_RECOVERY_SECRET_KEY are required');
  }
  const { prisma } = await import('../database.js');
  try {
    console.log(JSON.stringify(await recoverLegacyCheckout({ transactionId, sessionId, accountId,
      apply: mode === '--apply', secretKey: process.env.STRIPE_RECOVERY_SECRET_KEY }, prisma)));
  } finally { await prisma.$disconnect(); }
}
main().catch(error => {
  const message = error instanceof Error ? error.message : '';
  console.error(/^(RECOVERY_[A-Z0-9_]+|Usage: |DATABASE_URL and)/.test(message)
    ? message : 'RECOVERY_FAILED_NO_DETAILS_LOGGED');
  process.exitCode = 1;
});
