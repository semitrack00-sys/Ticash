import { describe, expect, it, vi } from 'vitest';
import { StripeHostedCheckoutProvider } from '../src/topup/stripe-provider.js';
import type { StripeConfig } from '../src/topup/stripe-config.js';
import { recurringRechargeEnabled } from '../src/flupflap/recurring-recharge.js';

const config: StripeConfig = {
  enabled: true,
  environment: 'sandbox',
  testMode: true,
  secretKey: 'sk_test_fixture_secret',
  publicKey: 'pk_test_fixture_public',
  webhookSecret: 'whsec_fixture_secret',
  successUrl: 'https://flupflap.com/recharge/success',
  failureUrl: 'https://flupflap.com/recharge/failure',
};

function response(body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function bodyOf(transport: ReturnType<typeof vi.fn>) {
  const [, init] = transport.mock.calls[0] as [string, RequestInit];
  return new URLSearchParams(String(init.body ?? ''));
}

describe('FlupFlap recurring recharge payment foundation', () => {
  it('is fail-closed unless the feature is explicitly enabled', () => {
    expect(recurringRechargeEnabled({})).toBe(false);
    expect(recurringRechargeEnabled({ FLUPFLAP_RECURRING_RECHARGE_ENABLED: 'false' })).toBe(false);
    expect(recurringRechargeEnabled({ FLUPFLAP_RECURRING_RECHARGE_ENABLED: 'true' })).toBe(true);
  });

  it('does not save a card for an ordinary one-time checkout', async () => {
    const transport = vi.fn(async () => response({
      id: 'cs_test_fixture',
      url: 'https://checkout.stripe.com/c/pay/cs_test_fixture',
    }));
    const stripe = new StripeHostedCheckoutProvider(config, transport);
    await stripe.createPaymentSession({
      transactionId: '12345678-1234-4234-8234-123456789abc',
      amountMinor: 599,
      currency: 'USD',
      billingCountry: 'US',
      resumeToken: 'A'.repeat(43),
    });
    const body = bodyOf(transport);
    expect(body.has('customer_creation')).toBe(false);
    expect(body.has('payment_intent_data[setup_future_usage]')).toBe(false);
    expect(body.has('payment_intent_data[metadata][recurringEligible]')).toBe(false);
  });

  it('saves the card for off-session use only when recurring recharge was selected', async () => {
    const transport = vi.fn(async () => response({
      id: 'cs_test_fixture',
      url: 'https://checkout.stripe.com/c/pay/cs_test_fixture',
    }));
    const stripe = new StripeHostedCheckoutProvider(config, transport);
    await stripe.createPaymentSession({
      transactionId: '12345678-1234-4234-8234-123456789abc',
      amountMinor: 599,
      currency: 'USD',
      billingCountry: 'US',
      resumeToken: 'A'.repeat(43),
      saveForRecurring: true,
    });
    const body = bodyOf(transport);
    expect(body.get('customer_creation')).toBe('always');
    expect(body.get('payment_intent_data[setup_future_usage]')).toBe('off_session');
    expect(body.get('payment_intent_data[metadata][recurringEligible]')).toBe('true');
  });

  it('requires a Stripe customer, payment method and off-session authorization', async () => {
    const transport = vi.fn(async () => response({
      id: 'pi_fixture',
      customer: 'cus_fixture',
      payment_method: 'pm_fixture',
      setup_future_usage: 'off_session',
    }));
    const stripe = new StripeHostedCheckoutProvider(config, transport);
    await expect(stripe.savedPaymentMethod('pi_fixture')).resolves.toEqual({
      customerId: 'cus_fixture',
      paymentMethodId: 'pm_fixture',
    });
  });

  it('creates an idempotent confirmed off-session USD payment intent', async () => {
    const transport = vi.fn(async () => response({
      id: 'pi_recurring_fixture',
      status: 'succeeded',
      amount: 599,
      currency: 'usd',
      customer: 'cus_fixture',
      payment_method: 'pm_fixture',
    }));
    const stripe = new StripeHostedCheckoutProvider(config, transport);
    await expect(stripe.createOffSessionPaymentIntent({
      transactionId: '12345678-1234-4234-8234-123456789abc',
      amountMinor: 599,
      customerId: 'cus_fixture',
      paymentMethodId: 'pm_fixture',
      billingCountry: 'US',
    })).resolves.toEqual({ id: 'pi_recurring_fixture', status: 'succeeded' });
    const [, init] = transport.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = new URLSearchParams(String(init.body ?? ''));
    expect(headers['Idempotency-Key']).toBe('12345678-1234-4234-8234-123456789abc:recurring-payment');
    expect(body.get('off_session')).toBe('true');
    expect(body.get('confirm')).toBe('true');
    expect(body.get('amount')).toBe('599');
    expect(body.get('currency')).toBe('usd');
    expect(body.get('customer')).toBe('cus_fixture');
    expect(body.get('payment_method')).toBe('pm_fixture');
  });
});
