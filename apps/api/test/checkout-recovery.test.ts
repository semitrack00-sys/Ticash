import { describe, expect, it, vi } from 'vitest';
import { MobileTopUpService } from '../src/topup/service.js';

function fixture(assertPurchaseIdentity?: (owner: string) => Promise<void>) {
  const record = { id: 'order', userId: 'owner', status: 'PENDING', paymentStatus: 'SESSION_CREATED',
    paymentProvider: 'STRIPE', paymentSessionId: 'cs_test_existing', totalChargeUsd: 5.75,
    paymentEnvironment: 'SANDBOX', rechargeEnvironment: 'SANDBOX', testMode: true };
  const repository = { getTransaction: vi.fn(async (owner: string) => owner === 'owner' ? record : null) };
  const stripe = {
    getHostedCheckoutPaymentState: vi.fn(async () => ({status: 'open', paymentStatus: 'unpaid'})),
    getHostedCheckoutSession: vi.fn(async () => ({id: record.paymentSessionId, url: 'https://checkout.stripe.com/c/pay/existing'})),
    flowContract: vi.fn((id, session) => ({transactionId: id, checkoutSession: session})),
  };
  const service = new MobileTopUpService({enabled: true, environment: 'sandbox', testMode: true, paymentMode: 'stripe_sandbox'} as never,
    {} as never, {} as never, repository as never, async () => {}, undefined, stripe as never,
    undefined, undefined, false, undefined, undefined, undefined, assertPurchaseIdentity);
  return {record, stripe, service};
}

describe('recover existing hosted checkout', () => {
  it('does not disclose an existing checkout until the purchase identity check passes', async () => {
    const guard=vi.fn(async () => { throw Object.assign(new Error('Account restricted'), {code:'REGISTERED_ACCOUNT_REQUIRED'}); });
    const f=fixture(guard);
    await expect(f.service.recoverHostedCheckout('owner','order')).rejects.toMatchObject({code:'REGISTERED_ACCOUNT_REQUIRED'});
    expect(guard).toHaveBeenCalledWith('owner');
    expect(f.stripe.getHostedCheckoutPaymentState).not.toHaveBeenCalled();
    expect(f.stripe.getHostedCheckoutSession).not.toHaveBeenCalled();
  });
  it('returns the same unpaid checkout and server amount', async () => {
    const f = fixture();
    const result = await f.service.recoverHostedCheckout('owner', 'order');
    expect(result).toMatchObject({transactionId: 'order', amountMinor: 575, checkoutSession: {id: 'cs_test_existing'}});
  });
  it('does not expose checkout to another account', async () => {
    const f = fixture();
    await expect(f.service.recoverHostedCheckout('other', 'order')).rejects.toMatchObject({code: 'TOPUP_NOT_FOUND'});
    expect(f.stripe.getHostedCheckoutPaymentState).not.toHaveBeenCalled();
  });
  it.each(['complete', 'expired'])('rejects %s Stripe sessions', async (status) => {
    const f = fixture();
    f.stripe.getHostedCheckoutPaymentState.mockResolvedValue({status, paymentStatus: 'unpaid'});
    await expect(f.service.recoverHostedCheckout('owner', 'order')).rejects.toMatchObject({code: 'CHECKOUT_NOT_RESUMABLE'});
  });
  it('rejects a paid session even before webhook delivery', async () => {
    const f = fixture();
    f.stripe.getHostedCheckoutPaymentState.mockResolvedValue({status: 'open', paymentStatus: 'paid'});
    await expect(f.service.recoverHostedCheckout('owner', 'order')).rejects.toMatchObject({code: 'CHECKOUT_NOT_RESUMABLE'});
  });
  it('rejects capture during recovery', async () => {
    const f = fixture();
    f.stripe.getHostedCheckoutSession.mockImplementation(async () => {
      f.record.paymentStatus = 'CAPTURED';
      return {id: f.record.paymentSessionId, url: 'https://checkout.stripe.com/c/pay/existing'};
    });
    await expect(f.service.recoverHostedCheckout('owner', 'order')).rejects.toMatchObject({code: 'CHECKOUT_NOT_RESUMABLE'});
  });
});
