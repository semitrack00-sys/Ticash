import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { MobileTopUpError } from './types.js';
import type { MobileTopUpRuntimeEnvironment } from './types.js';
import type { StripeConfig } from './stripe-config.js';
import type { MobileTopUpService } from './service.js';

const verifiedEvent = Symbol('verifiedStripeEvent');
export type StripeEventType =
  | 'payment_intent.succeeded'
  | 'payment_intent.payment_failed'
  | 'payment_intent.canceled'
  | 'payment_intent.processing'
  | 'payment_intent.requires_action'
  | 'payment_intent.incomplete'
  | 'payment_intent.partially_funded'
  | 'checkout.session.completed'
  | 'checkout.session.async_payment_succeeded'
  | 'checkout.session.async_payment_failed'
  | 'checkout.session.expired';

export interface VerifiedStripeEvent {
  readonly [verifiedEvent]: true;
  eventId: string;
  environment: MobileTopUpRuntimeEnvironment;
  transactionId: string;
  paymentId: string;
  checkoutSessionId: string;
  paymentIntentId?: string;
  paymentStatus?: 'paid' | 'unpaid' | 'no_payment_required';
  payloadHash: string;
  amountMinor: number;
  currency: 'USD';
  type: StripeEventType;
}

export function verifyStripeEvent(raw: Buffer, signature: string | undefined, secret: string): VerifiedStripeEvent {
  if (!secret || !Buffer.isBuffer(raw) || typeof signature !== 'string' || !signature.trim()) {
    throw new MobileTopUpError('INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature', 401);
  }

  const headerParts = Object.fromEntries(signature.split(',').map((part) => {
    const index = part.indexOf('=');
    if (index <= 0) return ['', ''];
    return [part.slice(0, index), part.slice(index + 1)];
  }));
  const timestamp = Number(headerParts.t);
  const expectedSignature = headerParts.v1;
  if (!Number.isFinite(timestamp) || !expectedSignature || Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300) {
    throw new MobileTopUpError('INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature', 401);
  }

  const expected = createHmac('sha256', secret).update(`${timestamp}.${raw.toString('utf8')}`).digest();
  if (!timingSafeEqual(expected, Buffer.from(expectedSignature, 'hex'))) {
    throw new MobileTopUpError('INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature', 401);
  }

  let body: unknown;
  try { body = JSON.parse(raw.toString('utf8')); } catch { throw new MobileTopUpError('INVALID_PAYMENT_EVENT', 'Invalid payment event', 400); }

  const parsed = z.object({
    id: z.string().min(1).max(200),
    livemode: z.boolean(),
    type: z.enum([
      'payment_intent.succeeded',
      'payment_intent.payment_failed',
      'payment_intent.canceled',
      'payment_intent.processing',
      'payment_intent.requires_action',
      'payment_intent.incomplete',
      'payment_intent.partially_funded',
      'checkout.session.completed',
      'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed',
      'checkout.session.expired',
    ]),
    data: z.object({ object: z.object({
      id: z.string().min(1).max(100),
      amount: z.number().int().optional(),
      amount_received: z.number().int().optional(),
      amount_total: z.number().int().optional(),
      currency: z.string().min(3).max(3).optional(),
      metadata: z.record(z.string(), z.string()).optional(),
      payment_intent: z.string().regex(/^pi_[A-Za-z0-9_]+$/).optional(),
      payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']).optional(),
    }).passthrough() }).passthrough(),
  }).safeParse(body);

  if (!parsed.success) throw new MobileTopUpError('INVALID_PAYMENT_EVENT', 'Unsupported or invalid payment event', 400);
  const object = parsed.data.data.object;
  const metadata = object.metadata ?? {};
  const transactionId = metadata.transactionId ?? metadata.transaction_id ?? metadata.rechargeId ?? metadata.recharge_id;
  const isCheckoutSession = parsed.data.type.startsWith('checkout.session.');
  const amountMinor = Number(isCheckoutSession ? object.amount_total : object.amount_received ?? object.amount ?? 0);
  const paymentIntentId = object.payment_intent;
  if (!transactionId || !Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw new MobileTopUpError('INVALID_PAYMENT_EVENT', 'Payment event is missing a server-bound transaction reference', 400);
  }
  if ((object.currency ?? '').toUpperCase() !== 'USD') {
    throw new MobileTopUpError('INVALID_PAYMENT_EVENT', 'Unsupported or invalid payment event', 400);
  }
  if (isCheckoutSession && (!/^cs_[A-Za-z0-9_]+$/.test(object.id) || !paymentIntentId && !['checkout.session.async_payment_failed', 'checkout.session.expired'].includes(parsed.data.type))) {
    throw new MobileTopUpError('INVALID_PAYMENT_EVENT', 'Checkout session event is missing a payment-intent binding', 400);
  }
  if (!isCheckoutSession && !/^pi_[A-Za-z0-9_]+$/.test(object.id)) {
    throw new MobileTopUpError('INVALID_PAYMENT_EVENT', 'Invalid payment-intent identity', 400);
  }

  return {
    [verifiedEvent]: true,
    eventId: parsed.data.id,
    environment: parsed.data.livemode ? 'PRODUCTION' : 'SANDBOX',
    type: parsed.data.type as StripeEventType,
    transactionId,
    paymentId: paymentIntentId ?? object.id,
    checkoutSessionId: object.id,
    ...(paymentIntentId ? { paymentIntentId } : {}),
    ...(isCheckoutSession ? { paymentStatus: object.payment_status } : {}),
    amountMinor,
    currency: 'USD',
    payloadHash: createHash('sha256').update(raw).digest('hex'),
  };
}

export function assertVerifiedStripeEvent(event: VerifiedStripeEvent) {
  if (event[verifiedEvent] !== true) throw new MobileTopUpError('INVALID_PAYMENT_EVENT', 'Payment event must be verified', 401);
}

export function createStripeWebhookHandler(config: StripeConfig, service: MobileTopUpService): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!config.enabled || !config.webhookSecret) throw new MobileTopUpError('STRIPE_DISABLED', 'Stripe is disabled', 503);
      const event = verifyStripeEvent(req.body, req.header('stripe-signature'), config.webhookSecret);
      await service.acceptVerifiedPaymentEvent(event);
      res.status(204).end();
    } catch (error) { next(error); }
  };
}
