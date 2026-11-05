import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';
import { planFlupFlapRetention } from './retention-plan.js';
import { planSupportCaseRetention } from './support-retention.js';

const args = process.argv.slice(2);
if (args.length !== 2 || !['--input-file', '--support-cases-file'].includes(args[0]!)) {
  console.error('Usage: retention-plan-cli.js --input-file FILE | --support-cases-file FILE (private; read-only; no execute mode)');
  process.exitCode = 1;
} else {
  let fd: number | undefined;
  try {
    fd = openSync(args[1]!, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 1024 * 1024 || (stat.mode & 0o077) !== 0) throw new Error('PRIVATE_INPUT_REQUIRED');
    // Bound the read even if an operator changes the file after the initial stat.
    const bytes = Buffer.alloc(1024 * 1024 + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = readSync(fd, bytes, size, bytes.length - size, size);
      if (count === 0) break;
      size += count;
    }
    if (size > 1024 * 1024) throw new Error('INPUT_TOO_LARGE');
    const raw: unknown = JSON.parse(bytes.subarray(0, size).toString('utf8'));
    console.log(JSON.stringify(args[0] === '--support-cases-file' ? planSupportCaseRetention(raw) : planFlupFlapRetention(raw)));
  } catch {
    // No input values, paths, validation diagnostics or credentials in errors.
    console.error('RETENTION_PLAN_FAILED_REVIEW_REQUIRED');
    process.exitCode = 1;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
