import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import { MobileTopUpError } from './types.js';
import type { CheckoutConfig } from './checkout-config.js';
import { transactionFromReference } from './checkout-provider.js';
import type { MobileTopUpService } from './service.js';

const verifiedEvent = Symbol('verifiedCheckoutEvent');
export interface VerifiedCheckoutEvent {
  readonly [verifiedEvent]: true;
  eventId: string;
  transactionId: string;
  paymentId: string;
  payloadHash: string;
  amountMinor: number;
  currency: 'USD';
  type: 'payment_approved' | 'payment_captured' | 'payment_declined' | 'payment_voided' | 'payment_refunded';
}

// https://www.checkout.com/docs/developer-resources/event-notifications/receive-webhooks/configure-your-webhook-server
// Verify raw bytes with the separate webhook signing key, before parsing JSON.
export function verifyCheckoutEvent(raw: Buffer, signature: string | undefined, secret: string): VerifiedCheckoutEvent {
  if (!secret || !Buffer.isBuffer(raw) || !/^[a-fA-F0-9]{64}$/.test(signature ?? '')) {
    throw new MobileTopUpError('INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature', 401);
  }
  const expected = createHmac('sha256', secret).update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature!, 'hex'))) throw new MobileTopUpError('INVALID_WEBHOOK_SIGNATURE', 'Invalid webhook signature', 401);
  let body: unknown;
  try { body = JSON.parse(raw.toString('utf8')); } catch { throw new MobileTopUpError('INVALID_PAYMENT_EVENT', 'Invalid payment event', 400); }
  const parsed = z.object({
    id: z.string().regex(/^evt_[A-Za-z0-9]+$/).max(100),
    type: z.enum(['payment_approved', 'payment_captured', 'payment_declined', 'payment_voided', 'payment_refunded']),
    data: z.object({ id: z.string().regex(/^pay_[A-Za-z0-9]+$/).max(100), reference: z.string().max(50),
      amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), currency: z.literal('USD') }),
  }).safeParse(body);
  if (!parsed.success) throw new MobileTopUpError('INVALID_PAYMENT_EVENT', 'Unsupported or invalid payment event', 400);
  return { [verifiedEvent]: true, eventId: parsed.data.id, type: parsed.data.type,
    transactionId: transactionFromReference(parsed.data.data.reference), paymentId: parsed.data.data.id,
    amountMinor: parsed.data.data.amount, currency: 'USD', payloadHash: createHash('sha256').update(raw).digest('hex') };
}
export function assertVerifiedCheckoutEvent(event: VerifiedCheckoutEvent) {
  if (event[verifiedEvent] !== true) throw new MobileTopUpError('INVALID_PAYMENT_EVENT', 'Payment event must be verified', 401);
}

export function createCheckoutWebhookHandler(config: CheckoutConfig, service: MobileTopUpService): RequestHandler {
  return async (req, res, next) => {
    try {
      if (!config.enabled || !config.webhookSecret) throw new MobileTopUpError('CHECKOUT_DISABLED', 'Checkout.com is disabled', 503);
      const event = verifyCheckoutEvent(req.body, req.header('cko-signature'), config.webhookSecret);
      await service.acceptVerifiedPaymentEvent(event);
      res.status(204).end();
    } catch (error) { next(error); }
  };
}
