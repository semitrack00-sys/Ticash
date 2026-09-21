import express, { type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import { MobileTopUpService } from './service.js';
import { MobileTopUpError } from './types.js';
import {
  topUpCountryCodeShape,
  topUpPhoneShape,
} from './validation.js';

type AuthRequest = Request & { userId?: string };

function asyncRoute(handler: (req: AuthRequest, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { Promise.resolve(handler(req as AuthRequest, res)).catch(next); };
}

const recipientSchema = z.object({
  nickname: z.string().trim().min(1).max(80),
  phone: topUpPhoneShape,
  countryCode: topUpCountryCodeShape,
  operatorId: z.number().int().positive().optional(),
  operatorName: z.string().trim().min(1).max(160).optional(),
}).strict();

const quoteSchema = z.object({
  countryCode: topUpCountryCodeShape,
  phone: topUpPhoneShape,
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

  router.get('/countries', ...protectedRoute, asyncRoute(async (_req, res) => {
    res.json({ countries: await options.service.listCountries() });
  }));

  router.get('/operators', ...protectedRoute, asyncRoute(async (req, res) => {
    const countryCode = topUpCountryCodeShape.parse(req.query.country);
    res.json({ operators: await options.service.listOperators(countryCode) });
  }));

  router.get('/operators/detect', ...protectedRoute, asyncRoute(async (req, res) => {
    const countryCode = topUpCountryCodeShape.parse(req.query.country);
    const phone = topUpPhoneShape.parse(req.query.phone);
    res.json({ operator: await options.service.detectOperator(countryCode, phone) });
  }));

  router.get('/operators/:id/products', ...protectedRoute, asyncRoute(async (req, res) => {
    const operatorId = z.coerce.number().int().positive().parse(req.params.id);
    const countryCode = topUpCountryCodeShape.parse(req.query.country);
    res.json(await options.service.products(countryCode, operatorId));
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
