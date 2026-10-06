import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('maintenance CLI database initialization diagnostics', () => {
  it.each([
    ['account-deletion-cli.ts', ['--request-file', '/unused-request.json'], 'DELETION_FAILED_REVIEW_REQUIRED'],
    ['deletion-ledger-cli.ts', ['initialize', '--output', '/unused-ledger.json'], 'LEDGER_FAILED_REVIEW_REQUIRED'],
  ])('sanitizes malformed database configuration in %s', (script, args, errorCode) => {
    const marker = 'PRIVATE_DATABASE_CONFIGURATION_SENTINEL';
    const path = fileURLToPath(new URL(`../src/flupflap/${script}`, import.meta.url));
    const result = spawnSync(process.execPath, ['--import', 'tsx', path, ...(args as string[])], {
      env: { ...process.env, NODE_ENV: 'production', DATABASE_URL: marker },
      encoding: 'utf8', timeout: 10000,
    });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.trim()).toBe(errorCode);
    expect(result.stderr).not.toContain(marker);
  });
});
