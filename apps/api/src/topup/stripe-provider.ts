import { ANDROID_CHECKOUT_RETURN_URL } from './android-checkout-return.js';
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
    if (baseUrl === 'https://www.flupflap.com/app/') {
      // Put the single-transaction capability in the fragment: no server logs.
      url.hash = `/checkout-return?checkoutResumeToken=${encodeURIComponent(resumeToken)}`;
      return url.toString();
    }
    url.searchParams.set('checkoutResumeToken', resumeToken);
    return url.toString();
  }

  async createPaymentSession(input: PaymentSessionInput & { billingCountry?: string; resumeToken: string; androidReturn?: boolean; pwaReturn?: boolean; saveForRecurring?: boolean }) {
    if (input.currency !== 'USD' || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !/^[A-Za-z0-9_-]{43,512}$/.test(input.resumeToken) || !/^[A-Z]{2}$/.test(input.billingCountry ?? '')) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Server-verified billing country and USD amount are required', 400);
    }
    const { data } = await this.request('/v1/checkout/sessions', 'POST', {
      mode: 'payment',
      success_url: this.buildReturnUrl(input.pwaReturn ? 'https://www.flupflap.com/app/' : input.androidReturn ? ANDROID_CHECKOUT_RETURN_URL : this.config.successUrl!, input.resumeToken),
      cancel_url: this.buildReturnUrl(input.pwaReturn ? 'https://www.flupflap.com/app/' : input.androidReturn ? ANDROID_CHECKOUT_RETURN_URL : this.config.failureUrl!, input.resumeToken),
      client_reference_id: input.transactionId,
      metadata: {
        transactionId: input.transactionId,
        billingCountry: input.billingCountry,
      },
      ...(input.saveForRecurring ? { customer_creation: 'always' } : {}),
      payment_intent_data: {
        ...(input.saveForRecurring ? { setup_future_usage: 'off_session' } : {}),
        metadata: {
          transactionId: input.transactionId,
          billingCountry: input.billingCountry,
          ...(input.saveForRecurring ? { recurringEligible: 'true' } : {}),
        },
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

  async getHostedCheckoutPaymentState(paymentSessionId: string) {
    if (!this.checkoutSessionPattern().test(paymentSessionId)) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Invalid stored Stripe payment session', 502);
    }
    const { data } = await this.request(`/v1/checkout/sessions/${encodeURIComponent(paymentSessionId)}`);
    if (data.id !== paymentSessionId) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Stripe payment session does not match the reservation', 502);
    }
    const status = typeof data.status === 'string' ? data.status : undefined;
    const paymentStatus = typeof data.payment_status === 'string' ? data.payment_status : undefined;
    const paymentIntentId = typeof data.payment_intent === 'string' ? data.payment_intent : undefined;
    if (status && !['open', 'complete', 'expired'].includes(status)) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Stripe returned an invalid checkout status', 502);
    }
    if (paymentStatus && !['paid', 'unpaid', 'no_payment_required'].includes(paymentStatus)) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Stripe returned an invalid checkout payment status', 502);
    }
    if (paymentIntentId && !/^pi_[A-Za-z0-9_]+$/.test(paymentIntentId)) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Stripe returned an invalid payment-intent binding', 502);
    }
    return { id: paymentSessionId, status, paymentStatus, paymentIntentId };
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
    if (!/^pi_[A-Za-z0-9_]+$/.test(paymentId)) {
      throw new MobileTopUpError('INVALID_PAYMENT_RESPONSE', 'Invalid Stripe payment identifier', 502);
    }
    return (await this.request(`/v1/payment_intents/${encodeURIComponent(paymentId)}`)).data;
  }

  async savedPaymentMethod(paymentId: string) {
    const data = await this.getPayment(paymentId);
    const customerId = typeof data.customer === 'string' ? data.customer : undefined;
    const paymentMethodId = typeof data.payment_method === 'string' ? data.payment_method : undefined;
    if (!/^cus_[A-Za-z0-9_]+$/.test(customerId ?? '') ||
        !/^pm_[A-Za-z0-9_]+$/.test(paymentMethodId ?? '') ||
        data.setup_future_usage !== 'off_session') {
      throw new MobileTopUpError(
        'RECURRING_PAYMENT_METHOD_UNAVAILABLE',
        'This payment method was not saved for automatic recharge',
        409,
      );
    }
    return { customerId: customerId!, paymentMethodId: paymentMethodId! };
  }

  async createOffSessionPaymentIntent(input: {
    transactionId: string;
    amountMinor: number;
    customerId: string;
    paymentMethodId: string;
    billingCountry: string;
  }) {
    this.assertMinorAmount(input.amountMinor);
    if (!/^cus_[A-Za-z0-9_]+$/.test(input.customerId) ||
        !/^pm_[A-Za-z0-9_]+$/.test(input.paymentMethodId) ||
        !/^[A-Z]{2}$/.test(input.billingCountry)) {
      throw new MobileTopUpError('INVALID_RECURRING_PAYMENT', 'Invalid recurring payment binding', 400);
    }
    const { data } = await this.request('/v1/payment_intents', 'POST', {
      amount: input.amountMinor,
      currency: 'usd',
      customer: input.customerId,
      payment_method: input.paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        transactionId: input.transactionId,
        billingCountry: input.billingCountry,
        recurringRecharge: 'true',
      },
    }, input.transactionId + ':recurring-payment');
    const id = typeof data.id === 'string' ? data.id : undefined;
    const status = typeof data.status === 'string' ? data.status : undefined;
    if (!/^pi_[A-Za-z0-9_]+$/.test(id ?? '') ||
        Number(data.amount) !== input.amountMinor ||
        String(data.currency ?? '').toUpperCase() !== 'USD' ||
        data.customer !== input.customerId ||
        data.payment_method !== input.paymentMethodId ||
        !['succeeded','processing','requires_action','requires_payment_method','requires_confirmation','canceled'].includes(status ?? '')) {
      throw new MobileTopUpError('INVALID_PAYMENT_RESPONSE', 'Stripe returned an invalid recurring payment', 502);
    }
    return { id: id!, status: status! };
  }

  async capture(input: { paymentId: string; transactionId: string; amountMinor: number }) {
    this.assertMinorAmount(input.amountMinor);
    await this.request(`/v1/payment_intents/${encodeURIComponent(input.paymentId)}/capture`, 'POST', {
      amount_to_capture: input.amountMinor,
    }, input.transactionId + ':capture');
    return 'PENDING' as const;
  }

  async void(input: { paymentId: string; transactionId: string }) {
    const { data } = await this.request(
      `/v1/payment_intents/${encodeURIComponent(input.paymentId)}/cancel`,
      'POST',
      {},
      input.transactionId + ':void',
    );
    if (data.id !== input.paymentId) {
      throw new MobileTopUpError('STRIPE_REQUEST_UNRESOLVED', 'Stripe void response did not match the payment', 502);
    }
    return data.status === 'canceled' ? 'VOIDED' as const : 'VOID_PENDING' as const;
  }

  async refund(input: { paymentId: string; transactionId: string; amountMinor: number }) {
    this.assertMinorAmount(input.amountMinor);
    const { data } = await this.request('/v1/refunds', 'POST', {
      payment_intent: input.paymentId,
      amount: input.amountMinor,
      metadata: { transactionId: input.transactionId },
    }, input.transactionId + ':refund');
    if (data.payment_intent !== input.paymentId || data.amount !== input.amountMinor) {
      throw new MobileTopUpError('STRIPE_REQUEST_UNRESOLVED', 'Stripe refund response did not match the payment', 502);
    }
    return data.status === 'succeeded' ? 'REFUNDED' as const : 'REFUND_PENDING' as const;
  }

  async getRecoveryStatus(input: {
    paymentId: string;
    transactionId: string;
    kind: 'VOID' | 'REFUND';
    amountMinor?: number;
  }) {
    if (input.kind === 'VOID') {
      const { data } = await this.request(`/v1/payment_intents/${encodeURIComponent(input.paymentId)}`);
      return data.status === 'canceled' ? 'VOIDED' as const : 'VOID_PENDING' as const;
    }

    this.assertMinorAmount(input.amountMinor ?? 0);
    const { data } = await this.request(
      `/v1/refunds?payment_intent=${encodeURIComponent(input.paymentId)}&limit=10`,
    );
    const rows = Array.isArray(data.data) ? data.data : [];
    const matching = rows.filter((row): row is Record<string, unknown> => {
      if (!row || typeof row !== 'object') return false;
      const metadata = row.metadata;
      const transactionMatches =
        metadata && typeof metadata === 'object' &&
        (metadata as Record<string, unknown>).transactionId === input.transactionId;
      return transactionMatches || Number(row.amount) === input.amountMinor;
    });
    if (matching.some((row) => row.status === 'succeeded')) return 'REFUNDED' as const;
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
