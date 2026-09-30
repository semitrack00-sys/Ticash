import express, { type Request, type RequestHandler, type Response } from 'express';
import rateLimit from 'express-rate-limit';
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
  language: z.enum(['en', 'ht', 'es', 'pt', 'fr', 'sw']).optional(),
  nickname: z.string().trim().min(1).max(80),
  phone: topUpPhoneShape,
  countryCode: topUpCountryCodeShape,
  operatorId: z.number().int().positive().max(2_147_483_647).optional(),
  operatorName: z.string().trim().min(1).max(160).optional(),
}).strict();

const quoteSchema = z.object({
  countryCode: topUpCountryCodeShape,
  phone: topUpPhoneShape,
  operatorId: z.number().int().positive().max(2_147_483_647),
  productId: z.string().min(1).max(240).optional(),
  catalogVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  amount: z.number().finite().min(5).max(100).multipleOf(0.01).optional(),
}).strict().refine((value) => Boolean(value.productId || value.amount !== undefined), {
  message: 'Either productId or amount must be supplied',
  path: ['productId'],
});

const purchaseSchema = z.object({
  quoteId: z.uuid(),
  recipientId: z.uuid().optional(),
}).strict();

const guestPaymentSessionSchema = purchaseSchema.extend({
  billingCountry: z.string().regex(/^[A-Za-z]{2}$/).transform(value => value.toUpperCase()).optional(),
});

const checkoutResumeSchema = z.object({
  resumeToken: z.string().regex(/^[A-Za-z0-9_-]{43,512}$/),
}).strict();

const checkoutResumeLimit = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { code: 'RATE_LIMITED', error: 'Too many checkout resume requests' },
});

export function createMobileTopUpRouter(options: {
  authenticate: RequestHandler;
  requireFundingAllowed: RequestHandler;
  service: MobileTopUpService;
  isGuest: (userId: string) => Promise<boolean>;
  supportedCountriesPath?: string;
  billingCountryForUser: (userId: string) => Promise<string | undefined>;
}) {
  const router = express.Router();
  const protectedRoute = [options.authenticate, options.requireFundingAllowed];

  router.post('/checkout-resume', checkoutResumeLimit, asyncRoute(async (req, res) => {
    const { resumeToken } = checkoutResumeSchema.parse(req.body);
    res.json({ transaction: await options.service.resumeCheckout(resumeToken) });
  }));

  router.get('/payment-methods', ...protectedRoute, asyncRoute(async (req, res) => {
    res.json(options.service.paymentMethods(await options.isGuest(req.userId!)));
  }));

  router.post('/payment-sessions', ...protectedRoute, asyncRoute(async (req, res) => {
    const key = req.header('idempotency-key');
    if (!key) throw new MobileTopUpError('IDEMPOTENCY_KEY_REQUIRED', 'An Idempotency-Key header is required', 400);
    const guest = await options.isGuest(req.userId!);
    const { billingCountry: requestBillingCountry, ...input } = guest
      ? guestPaymentSessionSchema.parse(req.body)
      : { ...purchaseSchema.parse(req.body), billingCountry: undefined };
    // Guest billing country is session context only; permanent customers use their stored profile.
    const billingCountry = guest ? requestBillingCountry : await options.billingCountryForUser(req.userId!);
    res.status(201).json(await options.service.createPaymentSession(
      req.userId!,
      input,
      key,
      billingCountry,
    ));
  }));

  router.get('/status', options.authenticate, asyncRoute(async (_req, res) => {
    res.json({ ...options.service.availability(), ...(options.supportedCountriesPath ? { supportedCountriesPath: options.supportedCountriesPath } : {}) });
  }));

  router.get('/coverage', ...protectedRoute, asyncRoute(async (_req, res) => {
    res.json(await options.service.coverage());
  }));

  router.get('/countries', ...protectedRoute, asyncRoute(async (_req, res) => {
    res.json({ countries: await options.service.listCountries() });
  }));

  router.get('/operators', ...protectedRoute, asyncRoute(async (req, res) => {
    const countryCode = topUpCountryCodeShape.parse(req.query.country);
    const provider = z.enum(['RELOADLY', 'DTONE', 'DING']).optional().parse(req.query.provider);
    res.json({ operators: await options.service.listOperators(countryCode, provider) });
  }));

  router.get('/operators/detect', ...protectedRoute, asyncRoute(async (req, res) => {
    const countryCode = topUpCountryCodeShape.parse(req.query.country);
    const phone = topUpPhoneShape.parse(req.query.phone);
    const provider = z.enum(['RELOADLY', 'DTONE', 'DING']).optional().parse(req.query.provider);
    res.json({ operator: await options.service.detectOperator(countryCode, phone, provider) });
  }));

  router.get('/operators/:id/products', ...protectedRoute, asyncRoute(async (req, res) => {
    const operatorId = z.coerce.number().int().positive().max(2_147_483_647).parse(req.params.id);
    const countryCode = topUpCountryCodeShape.parse(req.query.country);
    const classification = z.enum(['AIRTIME', 'DATA', 'BUNDLE']).optional().parse(req.query.classification);
    res.json(await options.service.products(countryCode, operatorId, classification));
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
