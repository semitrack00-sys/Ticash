import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { verifyStripeEvent } from '../src/topup/stripe-webhook.js';
import { PrismaMobileTopUpRepository } from '../src/topup/repository.js';

const event = { id: 'evt_replay', created: 1793771222, livemode: false, type: 'checkout.session.completed',
  data: { object: { id: 'cs_test_replay', payment_intent: 'pi_replay', amount_total: 585, currency: 'usd',
    payment_status: 'paid', metadata: { transactionId: 'transaction' } } } };
function verify(body: unknown, pretty = false) {
  const raw = Buffer.from(JSON.stringify(body, null, pretty ? 2 : undefined));
  const t = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', 'whsec_test').update(`${t}.${raw}`).digest('hex');
  return verifyStripeEvent(raw, `t=${t},v1=${signature}`, 'whsec_test');
}
describe('Stripe redelivery identity', () => {
  it('ignores delivery envelope changes and JSON key order after verifying the raw signature', () => {
    const original = verify({ ...event, pending_webhooks: 2, context: 'acct_test' });
    const retry = verify({ pending_webhooks: 1, ...Object.fromEntries(Object.entries(event).reverse()) }, true);
    expect(retry.payloadHash).toBe(original.payloadHash);
    expect(retry.payloadHash).toMatch(/^v2:/);
    expect(() => verifyStripeEvent(Buffer.from(JSON.stringify(event)), 't=1,v1=bad', 'whsec_test'))
      .toThrow('Invalid webhook signature');
  });
  it.each(['amount_total', 'payment_intent', 'payment_status'])('rejects changed %s on a repeated event', async field => {
    const first = verify(event);
    const changed = verify({ ...event, data: { object: { ...event.data.object,
      [field]: field === 'amount_total' ? 586 : field === 'payment_intent' ? 'pi_other' : 'unpaid' } } });
    const repository = new PrismaMobileTopUpRepository({ mobileTopUpPaymentEvent: {
      upsert: vi.fn().mockResolvedValue({ payloadHash: first.payloadHash, transactionId: 'transaction', processedAt: new Date() }),
    } } as never);
    await expect(repository.registerPaymentEvent(first.eventId, changed.payloadHash, 'transaction'))
      .rejects.toMatchObject({ code: 'PAYMENT_EVENT_CONFLICT' });
  });
  it.each([true, false])('only acknowledges already-completed legacy events (completed=%s)', async processed => {
    const repository = new PrismaMobileTopUpRepository({ mobileTopUpPaymentEvent: {
      upsert: vi.fn().mockResolvedValue({ payloadHash: 'a'.repeat(64), transactionId: 'transaction', processedAt: processed ? new Date() : null }),
    } } as never);
    const replay = verify(event);
    if (processed) expect(await repository.registerPaymentEvent(replay.eventId, replay.payloadHash, 'transaction')).toBe(false);
    else await expect(repository.registerPaymentEvent(replay.eventId, replay.payloadHash, 'transaction'))
      .rejects.toMatchObject({ code: 'PAYMENT_EVENT_CONFLICT' });
    await expect(repository.registerPaymentEvent(replay.eventId, replay.payloadHash, 'another-transaction'))
      .rejects.toMatchObject({ code: 'PAYMENT_EVENT_CONFLICT' });
  });
});
