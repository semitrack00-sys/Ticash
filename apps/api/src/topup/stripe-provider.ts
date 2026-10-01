import { MobileTopUpError, type HostedCheckoutSession, type HostedCheckoutSessionBaseContract, type MobileTopUpPaymentCapture, type MobileTopUpPaymentQuery, type MobileTopUpPaymentRecovery, type MobileTopUpSessionProvider, type PaymentSessionInput } from './types.js';
import { validateStripeConfig, type StripeConfig } from './stripe-config.js';

export class StripeHostedCheckoutProvider implements MobileTopUpSessionProvider, MobileTopUpPaymentRecovery, MobileTopUpPaymentQuery, MobileTopUpPaymentCapture {
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

  private checkoutSessionPattern() {
    return this.config.environment === 'production'
      ? /^cs_live_[A-Za-z0-9_]+$/
      : /^cs_test_[A-Za-z0-9_]+$/;
  }

  private runtimeEnvironment() {
    return this.config.environment === 'production' ? 'PRODUCTION' : 'SANDBOX';
  }

  private buildReturnUrl(baseUrl: string, resumeToken: string) {
    const url = new URL(baseUrl);
    url.searchParams.set('checkoutResumeToken', resumeToken);
    return url.toString();
  }

  async createPaymentSession(input: PaymentSessionInput & { billingCountry?: string; resumeToken: string }) {
    if (input.currency !== 'USD' || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !/^[A-Za-z0-9_-]{43,512}$/.test(input.resumeToken) || !/^[A-Z]{2}$/.test(input.billingCountry ?? '')) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Server-verified billing country and USD amount are required', 400);
    }
    const { data } = await this.request('/v1/checkout/sessions', 'POST', {
      mode: 'payment',
      success_url: this.buildReturnUrl(this.config.successUrl!, input.resumeToken),
      cancel_url: this.buildReturnUrl(this.config.failureUrl!, input.resumeToken),
      client_reference_id: input.transactionId,
      metadata: {
        transactionId: input.transactionId,
        billingCountry: input.billingCountry,
      },
      line_items: [{ quantity: 1, price_data: {
        currency: 'usd',
        unit_amount: input.amountMinor,
        product_data: { name: `TiCash recharge ${input.transactionId}` },
      } }],
    }, input.transactionId + ':checkout');
    return this.assertSafeSession(data);
  }

  private assertSafeSession(data: Record<string, unknown>): HostedCheckoutSession {
    const clientSecret = data.client_secret;
    if (typeof data?.id !== 'string' || !this.checkoutSessionPattern().test(data.id) || typeof data.url !== 'string' || !/^https:\/\/checkout\.stripe\.com\//i.test(data.url) || (clientSecret !== undefined && clientSecret !== null)) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Stripe returned an invalid payment session', 502);
    }
    const serialized = JSON.stringify(data);
    if ([this.config.secretKey, this.config.webhookSecret].some(secret => secret && serialized.includes(secret)) ||
        /"(?:secret_key|webhook_secret|api_key|access_token|refresh_token|database_url)"/i.test(serialized)) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Unsafe payment session response', 502);
    }
    return { id: data.id, url: data.url };
  }

  flowContract(transactionId: string, checkoutSession: HostedCheckoutSession): HostedCheckoutSessionBaseContract {
    return {
      provider: 'STRIPE',
      environment: this.runtimeEnvironment(),
      testMode: this.config.testMode,
      transactionId,
      checkoutSession: this.assertSafeSession(checkoutSession as unknown as Record<string, unknown>),
    };
  }

  async getHostedCheckoutSession(paymentSessionId: string) {
    if (!this.checkoutSessionPattern().test(paymentSessionId)) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Invalid stored Stripe payment session', 502);
    }
    const { data } = await this.request(`/v1/checkout/sessions/${encodeURIComponent(paymentSessionId)}`);
    const session = this.assertSafeSession(data);
    if (session.id !== paymentSessionId) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Stripe payment session does not match the reservation', 502);
    }
    return session;
  }

  async expireHostedCheckoutSession(paymentSessionId: string, transactionId: string) {
    if (!this.checkoutSessionPattern().test(paymentSessionId)) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Invalid stored Stripe payment session', 502);
    }
    const { data } = await this.request(
      `/v1/checkout/sessions/${encodeURIComponent(paymentSessionId)}/expire`,
      'POST',
      {},
      transactionId + ':expire-checkout',
    );
    if (data.id !== paymentSessionId || data.status !== 'expired') {
      throw new MobileTopUpError('STRIPE_REQUEST_UNRESOLVED', 'Stripe checkout cancellation needs reconciliation', 502);
    }
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

export class StripeSandboxPaymentProvider extends StripeHostedCheckoutProvider {
  constructor(config: StripeConfig, transport: typeof fetch = fetch) {
    if (config.environment !== 'sandbox') {
      throw new MobileTopUpError('TOPUP_CONFIGURATION_ERROR', 'Stripe sandbox provider requires sandbox configuration', 500);
    }
    super(config, transport);
  }
}
