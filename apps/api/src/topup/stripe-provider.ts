import { MobileTopUpError, type MobileTopUpPaymentCapture, type MobileTopUpPaymentQuery, type MobileTopUpPaymentRecovery, type MobileTopUpSessionProvider, type PaymentSessionInput } from './types.js';
import { validateStripeConfig, type StripeConfig } from './stripe-config.js';

export class StripeSandboxPaymentProvider implements MobileTopUpSessionProvider, MobileTopUpPaymentRecovery, MobileTopUpPaymentQuery, MobileTopUpPaymentCapture {
  private readonly config: Readonly<StripeConfig>;

  constructor(config: StripeConfig, private readonly transport: typeof fetch = fetch) {
    validateStripeConfig(config);
    this.config = Object.freeze({ ...config });
  }

  private async request(path: string, method = 'GET', body?: Record<string, unknown>, idempotencyKey?: string) {
    if (!this.config.enabled) throw new MobileTopUpError('STRIPE_DISABLED', 'Stripe is disabled', 503);
    try {
      const response = await this.transport(`https://api.stripe.com${path}`, {
        method,
        signal: AbortSignal.timeout(15_000),
        headers: {
          Authorization: `Bearer ${this.config.secretKey!}`,
          'Content-Type': 'application/json',
          ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error('Provider rejected request');
      return { status: response.status, data: await response.json() as Record<string, unknown> };
    } catch {
      throw new MobileTopUpError('STRIPE_REQUEST_UNRESOLVED', 'Stripe request needs reconciliation', 502);
    }
  }

  async createPaymentSession(input: PaymentSessionInput & { billingCountry?: string }) {
    if (input.currency !== 'USD' || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !/^[A-Z]{2}$/.test(input.billingCountry ?? '')) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Server-verified billing country and USD amount are required', 400);
    }
    const { data } = await this.request('/v1/payment_intents', 'POST', {
      amount: input.amountMinor,
      currency: 'usd',
      description: `TiCash recharge ${input.transactionId}`,
      metadata: {
        transactionId: input.transactionId,
        billingCountry: input.billingCountry,
      },
      automatic_payment_methods: { enabled: true },
      ...(this.config.successUrl ? { return_url: this.config.successUrl } : {}),
    });
    this.assertSafeSession(data);
    return data;
  }

  private assertSafeSession(data: Record<string, unknown>) {
    if (typeof data?.id !== 'string' || !/^pi_[A-Za-z0-9_]+$/.test(data.id) || typeof data.client_secret !== 'string' || !data.client_secret) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Stripe returned an invalid payment session', 502);
    }
    const serialized = JSON.stringify(data);
    if ([this.config.secretKey, this.config.webhookSecret].some(secret => secret && serialized.includes(secret)) ||
        /"(?:secret_key|webhook_secret|api_key|access_token|refresh_token|database_url)"/i.test(serialized)) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Unsafe payment session response', 502);
    }
  }

  flowContract(transactionId: string, paymentSession: Record<string, unknown>) {
    this.assertSafeSession(paymentSession);
    return { provider: 'STRIPE', environment: 'SANDBOX', transactionId, paymentSession, publicKey: this.config.publicKey };
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
