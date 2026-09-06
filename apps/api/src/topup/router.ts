import express, { type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { MobileTopUpService } from './service.js';
import { MobileTopUpError } from './types.js';

type AuthRequest = Request & { userId?: string };

function asyncRoute(handler: (req: AuthRequest, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { Promise.resolve(handler(req as AuthRequest, res)).catch(next); };
}

const recipientSchema = z.object({
  nickname: z.string().trim().min(1).max(80),
  phone: z.string().min(8).max(30),
  operatorId: z.number().int().positive().optional(),
  operatorName: z.string().trim().min(1).max(160).optional(),
}).strict();

const quoteSchema = z.object({
  phone: z.string().min(8).max(30),
  operatorId: z.number().int().positive(),
  productId: z.string().min(1).max(240),
  amount: z.number().positive().multipleOf(0.01).optional(),
}).strict();

const purchaseSchema = z.object({
  quoteId: z.uuid(),
  recipientId: z.uuid().optional(),
}).strict();

export function createMobileTopUpRouter(options: {
  authenticate: RequestHandler;
  requireFundingAllowed: RequestHandler;
  service: MobileTopUpService;
}) {
  const router = express.Router();
  const protectedRoute = [options.authenticate, options.requireFundingAllowed];

  router.get('/status', options.authenticate, asyncRoute(async (_req, res) => {
    res.json(options.service.availability());
  }));

  router.get('/operators', ...protectedRoute, asyncRoute(async (req, res) => {
    res.json({ operators: await options.service.listOperators(String(req.query.country ?? 'HT')) });
  }));

  router.get('/operators/detect', ...protectedRoute, asyncRoute(async (req, res) => {
    const phone = z.string().min(8).max(30).parse(req.query.phone);
    res.json({ operator: await options.service.detectOperator(phone) });
  }));

  router.get('/operators/:id/products', ...protectedRoute, asyncRoute(async (req, res) => {
    const operatorId = z.coerce.number().int().positive().parse(req.params.id);
    res.json(await options.service.products(operatorId));
  }));

  router.get('/recipients', ...protectedRoute, asyncRoute(async (req, res) => {
    res.json({ recipients: await options.service.listRecipients(req.userId!) });
  }));

  router.post('/recipients', ...protectedRoute, asyncRoute(async (req, res) => {
    const recipient = await options.service.saveRecipient(req.userId!, recipientSchema.parse(req.body));
    res.status(201).json({ recipient });
  }));

  router.post('/quotes', ...protectedRoute, asyncRoute(async (req, res) => {
    const quote = await options.service.createQuote(req.userId!, quoteSchema.parse(req.body));
    res.status(201).json({ quote });
  }));

  router.post('/transactions', ...protectedRoute, asyncRoute(async (req, res) => {
    const idempotencyKey = req.header('idempotency-key');
    if (!idempotencyKey) throw new MobileTopUpError('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header is required', 400);
    const transaction = await options.service.purchase(req.userId!, purchaseSchema.parse(req.body), idempotencyKey);
    res.status(201).json({ transaction });
  }));

  router.get('/transactions', ...protectedRoute, asyncRoute(async (req, res) => {
    res.json({ transactions: await options.service.listTransactions(req.userId!) });
  }));

  router.get('/transactions/:id', ...protectedRoute, asyncRoute(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    res.json({ transaction: await options.service.getTransaction(req.userId!, id, req.query.refresh === 'true') });
  }));

  router.post('/transactions/:id/repeat', ...protectedRoute, asyncRoute(async (req, res) => {
    const id = z.uuid().parse(req.params.id);
    res.status(201).json({ quote: await options.service.repeat(req.userId!, id) });
  }));

  return router;
}
