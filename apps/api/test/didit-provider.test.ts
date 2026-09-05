import { describe, expect, it, vi } from 'vitest';
import { DiditRestProvider } from '../src/kyc/didit-provider.js';
import type { DiditConfig } from '../src/kyc/types.js';

const config: DiditConfig = {
  enabled: true,
  apiKey: 'private-api-key',
  webhookSecret: 'private-webhook-secret',
  workflowId: '86ca1503-70df-4a85-8ac4-f3e13f319020',
  baseUrl: 'https://verification.didit.test',
};

describe('Didit REST provider', () => {
  it('uses the official v3 session endpoint and server-side x-api-key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      session_id: 'f5faccee-7e82-41ff-bcbc-e8016f520cf8',
      session_token: 'ephemeral-session-token',
      status: 'Not Started',
    }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    const provider = new DiditRestProvider(config, fetchMock as typeof fetch);
    await provider.createSession({ workflowId: config.workflowId!, vendorData: 'user-123' });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://verification.didit.test/v3/session/');
    expect(init?.headers).toMatchObject({ 'x-api-key': 'private-api-key' });
    expect(JSON.parse(String(init?.body))).toEqual({
      workflow_id: config.workflowId,
      vendor_data: 'user-123',
    });
  });

  it('sanitizes provider authentication failures', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ detail: 'sensitive details' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }));
    const provider = new DiditRestProvider(config, fetchMock as typeof fetch);
    await expect(provider.createSession({ workflowId: config.workflowId!, vendorData: 'user-123' }))
      .rejects.toMatchObject({ code: 'DIDIT_AUTHENTICATION_FAILED', statusCode: 503 });
  });
});
