import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { MobileTopUpError } from './types.js';
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
  | 'payment_intent.partially_funded';

export interface VerifiedStripeEvent {
  readonly [verifiedEvent]: true;
  eventId: string;
  transactionId: string;
  paymentId: string;
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
    type: z.string().min(1).max(200),
    data: z.object({ object: z.object({
      id: z.string().regex(/^pi_[A-Za-z0-9_]+$/).max(100),
      amount: z.number().int().optional(),
      amount_received: z.number().int().optional(),
      currency: z.string().min(3).max(3).optional(),
      metadata: z.record(z.string(), z.string()).optional(),
    }).passthrough() }).passthrough(),
  }).safeParse(body);

  if (!parsed.success) throw new MobileTopUpError('INVALID_PAYMENT_EVENT', 'Unsupported or invalid payment event', 400);
  const object = parsed.data.data.object;
  const metadata = object.metadata ?? {};
  const transactionId = metadata.transactionId ?? metadata.transaction_id ?? metadata.rechargeId ?? metadata.recharge_id;
  const amountMinor = Number(object.amount_received ?? object.amount ?? 0);
  if (!transactionId || !Number.isFinite(amountMinor) || amountMinor <= 0) {
    throw new MobileTopUpError('INVALID_PAYMENT_EVENT', 'Payment event is missing a server-bound transaction reference', 400);
  }
  if ((object.currency ?? 'usd').toUpperCase() !== 'USD') {
    throw new MobileTopUpError('INVALID_PAYMENT_EVENT', 'Unsupported or invalid payment event', 400);
  }

  return {
    [verifiedEvent]: true,
    eventId: parsed.data.id,
    type: parsed.data.type as StripeEventType,
    transactionId,
    paymentId: object.id,
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
