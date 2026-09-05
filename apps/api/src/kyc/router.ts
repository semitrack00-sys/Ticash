import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { DiditWebhookEvent } from './types.js';
import { KycError } from './types.js';
import { KycService } from './service.js';

type AuthRequest = Request & { userId?: string };

const diditWebhookSchema = z.object({
  event_id: z.string().uuid(),
  webhook_type: z.string().min(1).max(100),
  timestamp: z.number().int().nonnegative(),
  created_at: z.number().int().nonnegative(),
  session_id: z.string().uuid().optional(),
  session_kind: z.string().max(40).optional(),
  vendor_data: z.string().max(255).optional(),
  status: z.string().min(1).max(80),
}).passthrough();

function asyncRoute(
  handler: (req: AuthRequest, res: Response) => Promise<void> | Promise<Response>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req as AuthRequest, res)).catch(next);
  };
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((result, key) => {
        result[key] = sortKeys((value as Record<string, unknown>)[key]);
        return result;
      }, {});
  }
  return value;
}

function safeDigestEquals(expected: Buffer, providedHex: string | undefined): boolean {
  if (!providedHex || !/^[a-f\d]{64}$/i.test(providedHex)) return false;
  const provided = Buffer.from(providedHex, 'hex');
  return provided.length === expected.length && timingSafeEqual(expected, provided);
}

export function verifyDiditWebhook(input: {
  rawBody: Buffer;
  jsonBody: Record<string, unknown>;
  signatureV2?: string;
  rawSignature?: string;
  timestampHeader?: string;
  secret?: string;
  nowSeconds?: number;
}): boolean {
  if (!input.secret || !input.timestampHeader) return false;
  const timestamp = Number.parseInt(input.timestampHeader, 10);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (!Number.isSafeInteger(timestamp) || Math.abs(now - timestamp) > 300) return false;
  if (input.jsonBody.timestamp !== timestamp) return false;

  if (input.signatureV2) {
    const canonical = JSON.stringify(sortKeys(input.jsonBody));
    const expected = createHmac('sha256', input.secret).update(canonical, 'utf8').digest();
    if (safeDigestEquals(expected, input.signatureV2)) return true;
  }
  const expectedRaw = createHmac('sha256', input.secret).update(input.rawBody).digest();
  return safeDigestEquals(expectedRaw, input.rawSignature);
}

export function createKycRouter(options: {
  authenticate: RequestHandler;
  service: KycService;
}) {
  const router = express.Router();
  const sessionLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 5,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    message: {
      error: 'Too many verification requests. Please try again later.',
      code: 'RATE_LIMITED',
    },
  });

  router.get('/status', options.authenticate, asyncRoute(async (req, res) => {
    const refresh = req.query.refresh === 'true';
    res.json(await options.service.getStatus(req.userId!, refresh));
  }));

  router.post('/session', options.authenticate, sessionLimiter, asyncRoute(async (req, res) => {
    const result = await options.service.createSession(req.userId!);
    res.status(201).json(result);
  }));

  return router;
}

export function createDiditWebhookHandler(service: KycService): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      if (!service.config.enabled) {
        throw new KycError('KYC_DISABLED', 'Didit identity verification is disabled', 503);
      }
      if (!Buffer.isBuffer(req.body)) {
        throw new KycError('INVALID_WEBHOOK_BODY', 'Webhook body must be raw JSON', 400);
      }
      let jsonBody: Record<string, unknown>;
      try {
        jsonBody = JSON.parse(req.body.toString('utf8')) as Record<string, unknown>;
      } catch {
        throw new KycError('INVALID_WEBHOOK_JSON', 'Webhook JSON is invalid', 400);
      }
      if (!verifyDiditWebhook({
        rawBody: req.body,
        jsonBody,
        signatureV2: req.header('x-signature-v2'),
        rawSignature: req.header('x-signature'),
        timestampHeader: req.header('x-timestamp'),
        secret: service.config.webhookSecret,
      })) {
        throw new KycError('INVALID_WEBHOOK_SIGNATURE', 'Webhook signature is invalid', 401);
      }
      const body = diditWebhookSchema.parse(jsonBody);
      const event: DiditWebhookEvent = {
        eventId: body.event_id,
        webhookType: body.webhook_type,
        timestamp: body.timestamp,
        createdAt: body.created_at,
        sessionId: body.session_id,
        sessionKind: body.session_kind,
        vendorData: body.vendor_data,
        status: body.status,
      };
      const payloadHash = createHash('sha256').update(req.body).digest('hex');
      res.status(200).json({ received: true, ...await service.processWebhook(event, payloadHash) });
    })().catch(next);
  };
}
