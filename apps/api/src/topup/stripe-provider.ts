import { MobileTopUpError, type HostedCheckoutSession, type MobileTopUpPaymentCapture, type MobileTopUpPaymentQuery, type MobileTopUpPaymentRecovery, type MobileTopUpSessionProvider, type PaymentSessionInput } from './types.js';
import { validateStripeConfig, type StripeConfig } from './stripe-config.js';

export class StripeSandboxPaymentProvider implements MobileTopUpSessionProvider, MobileTopUpPaymentRecovery, MobileTopUpPaymentQuery, MobileTopUpPaymentCapture {
  private readonly config: Readonly<StripeConfig>;

  constructor(config: StripeConfig, private readonly transport: typeof fetch = fetch) {
    validateStripeConfig(config);
    this.config = Object.freeze({ ...config });
  }

  private encodeForm(body: Record<string, unknown>) {
    const params = new URLSearchParams();
    const append = (key: string, value: unknown) => {
      if (value === undefined || value === null) return;
      if (Array.isArray(value)) {
        value.forEach((entry, index) => append(`${key}[${index}]`, entry));
        return;
      }
      if (typeof value === 'object') {
        for (const [nestedKey, nestedValue] of Object.entries(value)) append(`${key}[${nestedKey}]`, nestedValue);
        return;
      }
      params.append(key, typeof value === 'boolean' ? String(value) : `${value}`);
    };
    for (const [key, value] of Object.entries(body)) append(key, value);
    return params.toString();
  }

  private async request(path: string, method = 'GET', body?: Record<string, unknown>, idempotencyKey?: string) {
    if (!this.config.enabled) throw new MobileTopUpError('STRIPE_DISABLED', 'Stripe is disabled', 503);
    try {
      const encodedBody = body ? this.encodeForm(body) : undefined;
      const response = await this.transport(`https://api.stripe.com${path}`, {
        method,
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${this.config.secretKey!}`,
          ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        ...(body ? { body: encodedBody } : {}),
      });
      if (!response.ok) throw new Error('Provider rejected request');
      return { status: response.status, data: await response.json() as Record<string, unknown> };
    } catch {
      throw new MobileTopUpError('STRIPE_REQUEST_UNRESOLVED', 'Stripe request needs reconciliation', 502);
    }
  }

  private assertCheckoutSession(data: Record<string, unknown>): HostedCheckoutSession {
    if (typeof data?.id !== 'string' || !/^cs_test_[A-Za-z0-9_]+$/.test(data.id) ||
        typeof data.url !== 'string' || !/^https:\/\/checkout\.stripe\.com\/[\S]+$/i.test(data.url) ||
        typeof data.client_secret === 'string' || typeof data.success_url === 'string' || typeof data.cancel_url === 'string') {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Stripe returned an invalid checkout session', 502);
    }
    const serialized = JSON.stringify(data);
    if ([this.config.secretKey, this.config.webhookSecret].some(secret => secret && serialized.includes(secret)) ||
        /"(?:secret_key|webhook_secret|api_key|access_token|refresh_token|database_url)"/i.test(serialized)) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Unsafe payment session response', 502);
    }
    return { id: data.id, url: data.url };
  }

  async createPaymentSession(input: PaymentSessionInput & { billingCountry?: string }) {
    if (input.currency !== 'USD' || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !/^[A-Z]{2}$/.test(input.billingCountry ?? '')) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Server-verified billing country and USD amount are required', 400);
    }
    const { data } = await this.request('/v1/checkout/sessions', 'POST', {
      mode: 'payment',
      success_url: this.config.successUrl,
      cancel_url: this.config.failureUrl,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: input.amountMinor,
          product_data: { name: `TiCash recharge ${input.transactionId}` },
        },
      }],
      metadata: {
        transactionId: input.transactionId,
        billingCountry: input.billingCountry,
      },
      payment_intent_data: {
        metadata: {
          transactionId: input.transactionId,
          billingCountry: input.billingCountry,
        },
      },
    }, input.transactionId);
    this.assertCheckoutSession(data);
    return data;
  }

  flowContract(transactionId: string, paymentSession: Record<string, unknown>) {
    const checkoutSession = this.assertCheckoutSession(paymentSession);
    return { provider: 'STRIPE' as const, environment: 'SANDBOX' as const, transactionId, checkoutSession };
  }

  async getPayment(paymentId: string) {
    return (await this.request(`/v1/payment_intents/${encodeURIComponent(paymentId)}`)).data;
  }

  async capture(input: { paymentId: string; transactionId: string; amountMinor: number }) {
    this.assertMinorAmount(input.amountMinor);
    await this.request(`/v1/payment_intents/${encodeURIComponent(input.paymentId)}/capture`, 'POST', {
      amount_to_capture: input.amountMinor,
    }, input.transactionId + ':capture');
    return 'PENDING' as const;
  }

  async void(input: { paymentId: string; transactionId: string }) {
    await this.request(`/v1/payment_intents/${encodeURIComponent(input.paymentId)}/cancel`, 'POST', {}, input.transactionId + ':void');
    return 'VOID_PENDING' as const;
  }

  async refund(input: { paymentId: string; transactionId: string; amountMinor: number }) {
    this.assertMinorAmount(input.amountMinor);
    await this.request('/v1/refunds', 'POST', {
      payment_intent: input.paymentId,
      amount: input.amountMinor,
    }, input.transactionId + ':refund');
    return 'REFUND_PENDING' as const;
  }

  private assertMinorAmount(value: number) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new MobileTopUpError('INVALID_PAYMENT_AMOUNT', 'Invalid USD minor-unit amount', 400);
  }
}
