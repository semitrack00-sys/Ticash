import { createHash } from 'node:crypto';
import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { verifyDwollaWebhookSignature } from './dwolla-provider.js';
import { FundingService } from './service.js';
import { FundingError, type DwollaWebhookEnvelope } from './types.js';

type AuthRequest = Request & { userId?: string };

const customerSchema = z.object({
  address1: z.string().trim().min(3).max(50),
  city: z.string().trim().min(2).max(50),
  state: z.string().trim().regex(/^[A-Z]{2}$/),
  postalCode: z.string().trim().regex(/^\d{5}(?:-\d{4})?$/),
  dateOfBirth: z.iso.date(),
  ssn: z.string().regex(/^\d{4}$|^\d{9}$/),
});

const fundingSourceSchema = z.object({
  routingNumber: z.string().regex(/^\d{9}$/),
  accountNumber: z.string().regex(/^\d{4,17}$/),
  bankAccountType: z.enum(['checking', 'savings']),
  name: z.string().trim().min(2).max(50),
});

const microDepositSchema = z.object({
  amount1: z.string().regex(/^0\.0[1-9]$/),
  amount2: z.string().regex(/^0\.0[1-9]$/),
});

const fundingSchema = z.object({
  fundingSourceId: z.uuid(),
  amount: z.number().min(1).max(5000).multipleOf(0.01),
  currency: z.literal('USD'),
});

function asyncRoute(
  handler: (req: AuthRequest, res: Response) => Promise<void> | Promise<Response>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(handler(req as AuthRequest, res)).catch(next);
  };
}

export function createFundingRouter(options: {
  authenticate: RequestHandler;
  requireApprovedKyc: RequestHandler;
  requireFundingAllowed: RequestHandler;
  service: FundingService;
  resolveUserIdentity: (userId: string) => Promise<{
    firstName: string;
    lastName: string;
    email: string;
  } | undefined>;
}) {
  const router = express.Router();
  const protectedFunding = [options.authenticate, options.requireApprovedKyc, options.requireFundingAllowed];

  router.get('/status', options.authenticate, asyncRoute(async (_req, res) => {
    res.json(options.service.availability());
  }));

  router.post('/dwolla/customer', ...protectedFunding, asyncRoute(async (req, res) => {
    const identity = await options.resolveUserIdentity(req.userId!);
    if (!identity) throw new FundingError('USER_NOT_FOUND', 'User was not found', 404);
    const result = await options.service.createCustomer(
      req.userId!, { ...customerSchema.parse(req.body), ...identity },
    );
    res.status(result.created ? 201 : 200).json({
      customer: { status: result.customer.status },
      existing: !result.created,
    });
  }));

  router.get('/dwolla/funding-sources', ...protectedFunding, asyncRoute(async (req, res) => {
    res.json({ fundingSources: await options.service.listFundingSources(req.userId!) });
  }));

  router.post('/dwolla/funding-sources', ...protectedFunding, asyncRoute(async (req, res) => {
    const fundingSource = await options.service.createFundingSource(
      req.userId!, fundingSourceSchema.parse(req.body),
    );
    res.status(201).json({ fundingSource });
  }));

  router.post('/dwolla/funding-sources/:id/micro-deposits', ...protectedFunding, asyncRoute(async (req, res) => {
    await options.service.initiateMicroDeposits(req.userId!, req.params.id as string);
    res.status(202).json({ status: 'pending' });
  }));

  router.post('/dwolla/funding-sources/:id/micro-deposits/verify', ...protectedFunding, asyncRoute(async (req, res) => {
    const input = microDepositSchema.parse(req.body);
    const fundingSource = await options.service.verifyMicroDeposits(
      req.userId!, req.params.id as string, input.amount1, input.amount2,
    );
    res.json({ fundingSource });
  }));

  router.post('/dwolla/transfers', ...protectedFunding, asyncRoute(async (req, res) => {
    const idempotencyKey = req.header('idempotency-key');
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 200) {
      throw new FundingError('IDEMPOTENCY_KEY_REQUIRED', 'A valid Idempotency-Key header is required', 400);
    }
    const input = fundingSchema.parse(req.body);
    const result = await options.service.initiateFunding(
      req.userId!, input.fundingSourceId, input.amount, idempotencyKey,
    );
    res.status(result.idempotentReplay ? 200 : 201).json(result);
  }));

  router.get('/dwolla/transfers/:id', ...protectedFunding, asyncRoute(async (req, res) => {
    const refresh = req.query.refresh === 'true';
    res.json({ transaction: await options.service.getFunding(req.userId!, req.params.id as string, refresh) });
  }));

  router.post('/dwolla/transfers/:id/cancel', ...protectedFunding, asyncRoute(async (req, res) => {
    res.json({ transaction: await options.service.cancelFunding(req.userId!, req.params.id as string) });
  }));

  router.get('/wallet', ...protectedFunding, asyncRoute(async (req, res) => {
    res.json({ balance: await options.service.walletBalance(req.userId!) });
  }));

  return router;
}

export function createDwollaWebhookHandler(service: FundingService): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    void (async () => {
      if (!service.config.enabled) {
        throw new FundingError('FUNDING_DISABLED', 'Dwolla sandbox funding is disabled', 503);
      }
      if (!Buffer.isBuffer(req.body)) {
        throw new FundingError('INVALID_WEBHOOK_BODY', 'Webhook body must be raw JSON', 400);
      }
      const signature = req.header('x-request-signature-sha-256');
      if (!verifyDwollaWebhookSignature(req.body, signature, service.config.webhookSecret)) {
        throw new FundingError('INVALID_WEBHOOK_SIGNATURE', 'Webhook signature is invalid', 401);
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(req.body.toString('utf8')) as Record<string, unknown>;
      } catch {
        throw new FundingError('INVALID_WEBHOOK_JSON', 'Webhook JSON is invalid', 400);
      }
      const links = body._links as Record<string, { href?: unknown }> | undefined;
      const envelope: DwollaWebhookEnvelope = {
        id: z.string().min(1).max(200).parse(body.id),
        topic: z.string().min(1).max(200).parse(body.topic),
        resourceUrl: typeof links?.resource?.href === 'string' ? links.resource.href : undefined,
      };
      const payloadHash = createHash('sha256').update(req.body).digest('hex');
      const result = await service.processWebhook(envelope, payloadHash);
      res.status(200).json({ received: true, ...result });
    })().catch(next);
  };
}
