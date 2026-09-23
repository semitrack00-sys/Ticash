import { MobileTopUpError, type MobileTopUpPaymentRecovery, type MobileTopUpSessionProvider, type MobileTopUpPaymentQuery, type MobileTopUpPaymentCapture, type PaymentSessionInput } from './types.js';
import { validateCheckoutConfig, type CheckoutConfig } from './checkout-config.js';

export function paymentReference(transactionId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(transactionId)) throw new MobileTopUpError('INVALID_PAYMENT_REFERENCE', 'Invalid transaction reference', 400);
  return 'tup_' + Buffer.from(transactionId.replaceAll('-', ''), 'hex').toString('base64url');
}
export function transactionFromReference(reference: string) {
  if (!/^tup_[A-Za-z0-9_-]{22}$/.test(reference)) throw new MobileTopUpError('INVALID_PAYMENT_REFERENCE', 'Invalid transaction reference', 400);
  const hex = Buffer.from(reference.slice(4), 'base64url').toString('hex');
  const id = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  if (paymentReference(id) !== reference) throw new MobileTopUpError('INVALID_PAYMENT_REFERENCE', 'Invalid transaction reference', 400);
  return id;
}

// Deliberately not selected by createApp. The active recharge provider remains MOCK.
// Official contract: https://api-reference.checkout.com/tag/Flow/#operation/CreatePaymentSession
export class CheckoutSandboxPaymentProvider implements MobileTopUpSessionProvider, MobileTopUpPaymentRecovery, MobileTopUpPaymentQuery, MobileTopUpPaymentCapture {
  private readonly config: Readonly<CheckoutConfig>;
  constructor(config: CheckoutConfig, private readonly transport: typeof fetch = fetch) {
    validateCheckoutConfig(config);
    this.config = Object.freeze({ ...config });
  }
  private async request(path: string, method = 'GET', body?: Record<string, unknown>, key?: string) {
    if (!this.config.enabled) throw new MobileTopUpError('CHECKOUT_DISABLED', 'Checkout.com is disabled', 503);
    try {
      const response = await this.transport(this.config.apiBaseUrl!.replace(/\/$/, '') + path, {
        method, redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${this.config.secretKey!}`, 'Content-Type': 'application/json', ...(key ? { 'Cko-Idempotency-Key': key } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!response.ok) throw new Error('Provider rejected request');
      return { status: response.status, data: await response.json() as Record<string, unknown> };
    } catch {
      // Do not propagate provider bodies, request headers or credential-bearing errors.
      throw new MobileTopUpError('CHECKOUT_REQUEST_UNRESOLVED', 'Checkout.com request needs reconciliation', 502);
    }
  }
  async createPaymentSession(input: PaymentSessionInput & { billingCountry?: string }) {
    if (input.currency !== 'USD' || !Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0 || !/^[A-Z]{2}$/.test(input.billingCountry ?? '')) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Server-verified billing country and USD amount are required', 400);
    }
    const { data } = await this.request('/payment-sessions', 'POST', {
      amount: input.amountMinor, currency: 'USD', reference: paymentReference(input.transactionId),
      processing_channel_id: this.config.processingChannelId,
      billing: { address: { country: input.billingCountry } },
      success_url: this.config.successUrl, failure_url: this.config.failureUrl,
      capture: true, enabled_payment_methods: ['card'],
    });
    this.assertSafeSession(data);
    return data; // Flow requires the unmodified provider session object.
  }
  private assertSafeSession(data: Record<string, unknown>) {
    if (typeof data?.id !== 'string' || !/^ps_[A-Za-z0-9]+$/.test(data.id) || typeof data.payment_session_token !== 'string' || !data.payment_session_token) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Checkout.com returned an invalid payment session', 502);
    }
    const serialized = JSON.stringify(data);
    if ([this.config.secretKey, this.config.webhookSecret].some(secret => secret && serialized.includes(secret)) ||
        /"(?:secret_key|webhook_secret|access_token|refresh_token|database_url)"/i.test(serialized)) {
      throw new MobileTopUpError('INVALID_PAYMENT_SESSION', 'Unsafe payment session response', 502);
    }
  }
  flowContract(transactionId: string, paymentSession: Record<string, unknown>) {
    this.assertSafeSession(paymentSession);
    return { provider: 'CHECKOUT_COM', environment: 'SANDBOX', transactionId, paymentSession, publicKey: this.config.publicKey };
  }
  private paymentPath(paymentId: string) {
    if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new MobileTopUpError('INVALID_PAYMENT_ID', 'Invalid provider payment identifier', 400);
    return '/payments/' + paymentId;
  }
  async getPayment(paymentId: string) { return (await this.request(this.paymentPath(paymentId))).data; }
  async capture(input: { paymentId: string; transactionId: string; amountMinor: number }) {
    this.assertMinorAmount(input.amountMinor);
    await this.request(this.paymentPath(input.paymentId) + '/captures', 'POST', { amount: input.amountMinor, reference: paymentReference(input.transactionId) }, input.transactionId + ':capture');
    return 'PENDING' as const;
  }
  async void(input: { paymentId: string; transactionId: string }) {
    await this.request(this.paymentPath(input.paymentId) + '/voids', 'POST', { reference: paymentReference(input.transactionId) }, input.transactionId + ':void');
    return 'VOID_PENDING' as const;
  }
  async refund(input: { paymentId: string; transactionId: string; amountMinor: number }) {
    this.assertMinorAmount(input.amountMinor);
    await this.request(this.paymentPath(input.paymentId) + '/refunds', 'POST', { amount: input.amountMinor, reference: paymentReference(input.transactionId) }, input.transactionId + ':refund');
    return 'REFUND_PENDING' as const;
  }
  private assertMinorAmount(value: number) {
    if (!Number.isSafeInteger(value) || value <= 0) throw new MobileTopUpError('INVALID_PAYMENT_AMOUNT', 'Invalid USD minor-unit amount', 400);
  }
}
