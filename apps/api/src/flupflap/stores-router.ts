import express, { type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { AdminPermission, AdminRequest } from '../admin-access.js';
import type { MobileTopUpService } from '../topup/service.js';
import type { FlupFlapStores } from './stores.js';

function route(run: (req: AdminRequest, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { Promise.resolve(run(req as AdminRequest, res)).catch(next); };
}
const reviewFunding = z.object({ approve: z.boolean(), fundsReceived: z.boolean(), reason: z.string().trim().min(5).max(250) }).strict().refine(value => !value.approve || value.fundsReceived, { message: 'Receipt of funds must be verified before approval' });
const quote = z.object({ countryCode: z.string().regex(/^[A-Z]{2}$/), phone: z.string().min(4).max(40),
  operatorId: z.number().int().positive(), productId: z.string().min(1).max(240),
  catalogVersion: z.string().regex(/^[a-f0-9]{64}$/).optional(), amount: z.number().finite().min(1).max(100).multipleOf(0.01).optional() }).strict();

export function createStoresRouter(options: { stores?: FlupFlapStores; authenticate: RequestHandler; requireRechargeAllowed: RequestHandler;
  isGuest: (owner: string) => Promise<boolean>; recharge: MobileTopUpService }) {
  const router = express.Router();
  router.use(options.authenticate, options.requireRechargeAllowed, (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    void options.isGuest((req as AdminRequest).userId!).then(guest => {
      if (guest) { res.status(403).json({ code: 'REGISTERED_ACCOUNT_REQUIRED' }); return; }
      if (!options.stores) { res.status(503).json({ code: 'STORE_UNAVAILABLE' }); return; }
      next();
    }).catch(next);
  });
  router.get('/', route(async (req, res) => res.json(await options.stores!.summary(req.userId!))));
  router.post('/application', route(async (req, res) => res.status(201).json({ store: await options.stores!.apply(req.userId!, req.body) })));
  router.post('/funding', route(async (req, res) => res.status(201).json({ funding: await options.stores!.requestFunding(req.userId!, req.body) })));
  router.post('/quotes', route(async (req, res) => res.status(201).json({ quote: await options.recharge.createQuote(req.userId!, quote.parse(req.body), true) })));
  router.post('/purchases', route(async (req, res) => {
    const input = z.object({ quoteId: z.uuid() }).strict().parse(req.body);
    const key = z.string().regex(/^[A-Za-z0-9._:-]{8,200}$/).parse(req.header('idempotency-key'));
    return res.status(201).json({ transaction: await options.recharge.purchaseFromStore(req.userId!, input, key) });
  }));
  return router;
}

export function createStoresAdminRouter(options: { stores?: FlupFlapStores; authenticate: RequestHandler; permission: (p: AdminPermission) => RequestHandler }) {
  const router = express.Router();
  router.use(options.authenticate, options.permission('admin.view'), options.permission('recharge.view'));
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!options.stores) { res.status(503).json({ code: 'STORE_UNAVAILABLE' }); return; }
    next();
  });
  router.get('/', options.permission('recharge.stores.view'), route(async (req, res) => {
    const offset = z.coerce.number().int().min(0).max(100000).default(0).parse(req.query.offset);
    return res.json(await options.stores!.list(offset));
  }));
  router.patch('/:id', options.permission('recharge.stores.manage'), route(async (req, res) => res.json({ store: await options.stores!.review(req.userId!, z.uuid().parse(req.params.id), req.body) })));
  router.post('/:id/balance-return', options.permission('recharge.stores.funding'), route(async (req, res) => {
    const data = z.object({ amountCents: z.number().int().min(1).max(1000000), reference: z.string().trim().min(5).max(120),
      fundsReturned: z.literal(true) }).strict().parse(req.body);
    return res.json({ entry: await options.stores!.recordBalanceReturn(req.userId!, z.uuid().parse(req.params.id), { amountCents: data.amountCents, reference: data.reference }) });
  }));
  router.post('/funding/:id/review' , options.permission('recharge.stores.funding'), route(async (req, res) => {
    const data = reviewFunding.parse(req.body);
    return res.json({ funding: await options.stores!.reviewFunding(req.userId!, z.uuid().parse(req.params.id), data.approve, data.reason) });
  }));
  return router;
}
