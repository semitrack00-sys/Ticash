import express, { type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import type { FlupFlapRecurringRechargeService } from './recurring-recharge.js';

type AuthRequest = Request & { userId?: string };

function asyncRoute(handler: (req: AuthRequest, res: Response) => Promise<unknown>): RequestHandler {
  return (req, res, next) => { Promise.resolve(handler(req as AuthRequest, res)).catch(next); };
}

const createSchema = z.object({
  transactionId: z.uuid(),
  intervalDays: z.union([z.literal(7), z.literal(15), z.literal(30)]),
  consent: z.literal(true),
}).strict();

const actionSchema = z.object({
  action: z.enum(['PAUSE', 'RESUME', 'CANCEL']),
}).strict();

export function createFlupFlapRecurringRechargeRouter(options: {
  authenticate: RequestHandler;
  requireRechargeAllowed: RequestHandler;
  service?: FlupFlapRecurringRechargeService;
}) {
  const router = express.Router();
  const protectedRoute = [options.authenticate, options.requireRechargeAllowed];

  router.get('/', ...protectedRoute, asyncRoute(async (req, res) => {
    if (!options.service) return res.status(503).json({ code: 'RECURRING_RECHARGE_UNAVAILABLE' });
    return res.json({ schedules: await options.service.list(req.userId!) });
  }));

  router.post('/', ...protectedRoute, asyncRoute(async (req, res) => {
    if (!options.service) return res.status(503).json({ code: 'RECURRING_RECHARGE_UNAVAILABLE' });
    return res.status(201).json({ schedule: await options.service.create(req.userId!, createSchema.parse(req.body)) });
  }));

  router.patch('/:id', ...protectedRoute, asyncRoute(async (req, res) => {
    if (!options.service) return res.status(503).json({ code: 'RECURRING_RECHARGE_UNAVAILABLE' });
    const id = z.uuid().parse(req.params.id);
    const { action } = actionSchema.parse(req.body);
    return res.json({ schedule: await options.service.update(req.userId!, id, action) });
  }));

  return router;
}
