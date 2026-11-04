import { expect, it, vi } from 'vitest';
import { StripeSandboxPaymentProvider } from '../src/topup/stripe-provider.js';

const config = {
  enabled: true, environment: 'sandbox' as const, testMode: true,
  secretKey: 'sk_test_fixture', publicKey: 'pk_test_fixture', webhookSecret: 'whsec_fixture',
  successUrl: 'https://flupflap.com/success', failureUrl: 'https://flupflap.com/failure',
};
const input = {paymentId: 'pi_fixture', transactionId: 'tx_fixture', amountMinor: 100};
const full = {id: 're_fixture', payment_intent: input.paymentId, currency: 'usd', amount: 100,
  status: 'succeeded', metadata: {transactionId: input.transactionId}};

it.each([
  {amount: 50}, {payment_intent: 'pi_other'}, {currency: 'eur'},
  {metadata: {transactionId: 'tx_other'}}, {status: 'pending'}, {status: 'failed'},
  {amount: '100'}, {payment_intent: undefined}, {currency: undefined},
])('does not declare recovery complete for a mismatched or unconfirmed refund: %j', async patch => {
  const transport = vi.fn(async () => Response.json({data: [{...full, ...patch}]}));
  const provider = new StripeSandboxPaymentProvider(config, transport);
  await expect(provider.getRecoveryStatus({...input, kind: 'REFUND'})).resolves.toBe('REFUND_PENDING');
  expect(transport.mock.calls).toHaveLength(1);
});

it.each([full.metadata, {}])('confirms a fully bound automatic or manual full refund: %j', async metadata => {
  const transport = vi.fn(async () => Response.json({data: [{...full, metadata}]}));
  const provider = new StripeSandboxPaymentProvider(config, transport);
  await expect(provider.getRecoveryStatus({...input, kind: 'REFUND'})).resolves.toBe('REFUNDED');
});

it('recovers a lost refund response using a read, without another POST', async () => {
  const requests: {method: string; key: string | null; body?: string}[] = [];
  const transport: typeof fetch = async (_url, init) => {
    requests.push({method: init?.method ?? 'GET', key: new Headers(init?.headers).get('Idempotency-Key'), body: init?.body as string});
    if (init?.method === 'POST') throw new Error('response lost after provider accepted refund');
    return Response.json({data: [full]});
  };
  const provider = new StripeSandboxPaymentProvider(config, transport);
  await expect(provider.refund(input)).rejects.toMatchObject({code: 'STRIPE_REQUEST_UNRESOLVED'});
  await expect(provider.getRecoveryStatus({...input, kind: 'REFUND'})).resolves.toBe('REFUNDED');
  expect(requests.map(r => r.method)).toEqual(['POST', 'GET']);
  expect(requests[0]?.key).toBe('tx_fixture:refund');
  expect(new URLSearchParams(requests[0]?.body).get('amount')).toBe('100');
});
