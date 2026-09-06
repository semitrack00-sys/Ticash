import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { DwollaRestFundingProvider, verifyDwollaWebhookSignature } from '../src/funding/dwolla-provider.js';
import type { FundingConfig } from '../src/funding/types.js';

const config: FundingConfig = {
  enabled: true,
  environment: 'sandbox',
  clientId: 'client-id',
  clientSecret: 'client-secret',
  webhookSecret: 'webhook-secret',
  productionEnabled: false,
  liveFundingEnabled: false,
  approvedForLiveUse: false,
};

describe('Dwolla REST provider', () => {
  it('obtains and reuses a client-credentials token on the sandbox host', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'sandbox-access-token', expires_in: 3600,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(null, {
        status: 201,
        headers: { Location: 'https://api-sandbox.dwolla.com/customers/customer-1' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'customer-1', status: 'verified' }), {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.dwolla.v1.hal+json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'customer-1', status: 'verified' }), {
        status: 200,
        headers: { 'Content-Type': 'application/vnd.dwolla.v1.hal+json' },
      }));
    const provider = new DwollaRestFundingProvider(config, fetchMock);
    const customer = await provider.createCustomer({
      firstName: 'Ti', lastName: 'Cash', email: 'funding@example.com',
    });
    await provider.getCustomer(customer.url);

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api-sandbox.dwolla.com/token');
    const tokenInit = fetchMock.mock.calls[0]?.[1];
    expect(tokenInit?.method).toBe('POST');
    expect(new Headers(tokenInit?.headers).get('authorization')).toBe(
      `Basic ${Buffer.from('client-id:client-secret').toString('base64')}`,
    );
    expect(tokenInit?.body).toBe('grant_type=client_credentials');
    const customerBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(customerBody).toEqual({
      firstName: 'Ti', lastName: 'Cash', email: 'funding@example.com', type: 'unverified',
    });
    expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/token'))).toHaveLength(1);
  });

  it('validates webhook HMAC against the exact raw request bytes', () => {
    const body = Buffer.from('{"id":"event-1"}', 'utf8');
    const signature = createHmac('sha256', 'webhook-secret').update(body).digest('hex');
    expect(verifyDwollaWebhookSignature(body, signature, 'webhook-secret')).toBe(true);
    expect(verifyDwollaWebhookSignature(Buffer.from('{}'), signature, 'webhook-secret')).toBe(false);
    expect(verifyDwollaWebhookSignature(body, undefined, 'webhook-secret')).toBe(false);
  });

  it('rejects resource URLs outside the configured Dwolla host', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'sandbox-access-token', expires_in: 3600,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const provider = new DwollaRestFundingProvider(config, fetchMock);
    await expect(provider.getTransfer('https://example.com/transfers/transfer-1'))
      .rejects.toMatchObject({ code: 'INVALID_PROVIDER_URL' });
  });

  it('retrieves and sanitizes the official failure resource for a failed transfer', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'sandbox-access-token', expires_in: 3600,
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'transfer-1',
        status: 'failed',
        _links: {
          failure: {
            href: 'https://api-sandbox.dwolla.com/transfers/transfer-1/failure',
          },
        },
      }), { status: 200, headers: { 'Content-Type': 'application/vnd.dwolla.v1.hal+json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        code: 'R01<script>',
        description: 'Sensitive provider detail that must not be exposed',
      }), { status: 200, headers: { 'Content-Type': 'application/vnd.dwolla.v1.hal+json' } }));
    const provider = new DwollaRestFundingProvider(config, fetchMock);
    const transfer = await provider.getTransfer(
      'https://api-sandbox.dwolla.com/transfers/transfer-1',
    );
    expect(transfer.status).toBe('failed');
    expect(transfer.failureCode).toBe('R01script');
  });
});
