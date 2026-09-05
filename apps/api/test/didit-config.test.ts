import { describe, expect, it } from 'vitest';
import { loadDiditConfig } from '../src/kyc/config.js';

describe('Didit configuration', () => {
  it('is disabled without credentials', () => {
    expect(loadDiditConfig({ DIDIT_ENABLED: 'false' }).enabled).toBe(false);
  });

  it('requires credentials and a workflow only when enabled', () => {
    expect(() => loadDiditConfig({ DIDIT_ENABLED: 'true' })).toThrow(/DIDIT_API_KEY/);
    expect(() => loadDiditConfig({
      DIDIT_ENABLED: 'true',
      DIDIT_API_KEY: 'key',
      DIDIT_WEBHOOK_SECRET: 'secret',
      DIDIT_WORKFLOW_ID: 'not-a-uuid',
    })).toThrow(/valid UUID/);
  });

  it('requires an HTTPS provider URL', () => {
    expect(() => loadDiditConfig({
      DIDIT_ENABLED: 'false',
      DIDIT_BASE_URL: 'http://verification.didit.me',
    })).toThrow(/HTTPS/);
  });
});
