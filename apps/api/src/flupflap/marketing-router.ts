import express, { type RequestHandler, type ErrorRequestHandler, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import QRCode from 'qrcode';
import { z } from 'zod';
import type { AdminPermission, AdminRequest } from '../admin-access.js';
import { flupFlapCustomerId } from './owner.js';
import { campaignInput, MarketingError } from './marketing-policy.js';
import { FlupFlapMarketing, visitCapability, visitInput } from './marketing.js';

type CustomerRequest = Request & { userId?: string };
const limiter = () => rateLimit({ windowMs: 15 * 60000, limit: 40, standardHeaders: true, legacyHeaders: false,
  message: { code: 'RATE_LIMITED', error: 'Please try again later' } });
const capabilityBody = z.object({ capability: visitCapability }).strict();
const safeErrors: ErrorRequestHandler = (error, _req, res, next) => {
  if (error instanceof MarketingError) { res.status(error.statusCode).json({ code: error.code, error: error.message }); return; }
  if (error instanceof z.ZodError) { res.status(400).json({ code: 'INVALID_MARKETING_INPUT', error: 'Check the promotion details' }); return; }
  // Do not return ORM errors/constraints or submitted values to public clients.
  if (error && typeof error === 'object' && 'code' in error && ['P2002', 'P2025', 'P2003'].includes(String(error.code))) {
    res.status(409).json({ code: 'PROMOTION_UNAVAILABLE', error: 'This promotion cannot be applied' }); return;
  }
  next(error);
};
const unavailable: RequestHandler = (_req, res) => { res.status(503).json({ code: 'MARKETING_UNAVAILABLE', error: 'Sharing is temporarily unavailable' }); };

export function createMarketingRouter(options: { service?: FlupFlapMarketing; authenticate: RequestHandler; requireRechargeAllowed: RequestHandler }) {
  const router = express.Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); }, limiter());
  if (!options.service) { router.use(unavailable); return router; }
  const service = options.service;
  router.post('/visits', async (req, res) => {
    const prior = req.header('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith('flupflap_visit='))?.slice('flupflap_visit='.length);
    const visit = await service.visit(visitInput.parse(req.body), prior);
    res.cookie('flupflap_visit', visit.capability, { httpOnly: true, secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', path: '/api/flupflap/marketing',
      expires: new Date(visit.expiresAt) });
    res.status(201).json(visit);
  });
  router.post('/signup-started', async (req, res) => { await service.signupStarted(capabilityBody.parse(req.body).capability); res.json({ recorded: true }); });
  router.use(options.authenticate, options.requireRechargeAllowed);
  const owner = (req: CustomerRequest) => {
    const id = req.userId && flupFlapCustomerId(req.userId);
    if (!id) throw new MarketingError('FORBIDDEN', 403);
    return id;
  };
  router.get('/share', async (req, res) => res.json(await service.referral(owner(req))));
  router.get('/share/qr', async (req, res) => {
    const { url } = await service.referral(owner(req));
    res.json({ dataUrl: await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 3, width: 240 }) });
  });
  router.post('/attribution', async (req, res) => res.json(await service.claim(owner(req), capabilityBody.parse(req.body).capability)));
  router.get('/quotes/:id', async (req, res) => {
    const customerId = owner(req);
    const quote = await service.db.mobileTopUpQuote.findFirst({ where: { id: z.uuid().parse(req.params.id), flupFlapCustomerId: customerId, userId: null }, include: { promotion: { include: { campaign: true } } } });
    if (!quote) { res.status(404).json({ code: 'TOPUP_QUOTE_NOT_FOUND' }); return; }
    const p = quote.promotion;
    res.json({ promotion: p ? { name: p.campaign.name, benefitCents: p.benefitCents, originalFeeCents: p.originalFeeCents,
      principalCents: p.principalCents, feeCents: p.feeCents, totalCents: p.principalCents + p.feeCents,
      currency: 'USD', testMode: p.testMode, receiver: quote.receiverQuote } : null });
  });
  router.use(safeErrors);
  return router;
}

export function createMarketingAdminRouter(options: { service?: FlupFlapMarketing; authenticate: RequestHandler; permission: (p: AdminPermission) => RequestHandler }) {
  const router = express.Router();
  router.use(options.authenticate, options.permission('recharge.configuration.view'));
  if (!options.service) { router.use(unavailable); return router; }
  const service = options.service;
  router.get('/', async (_req, res) => res.json({ campaigns: await service.report(), liveMonetaryPromotionsEnabled: false, automaticPayoutsEnabled: false }));
  router.get('/promoters', async (_req, res) => res.json({ promoters: await service.db.promoter.findMany({ select: { id: true, name: true }, take: 100, orderBy: { createdAt: 'desc' } }) }));
  router.get('/rewards', async (_req, res) => res.json({ rewards: await service.db.promoterReward.findMany({
    select: { id: true, amountCents: true, status: true, testMode: true, createdAt: true }, orderBy: { createdAt: 'desc' }, take: 100,
  }) }));
  router.get('/audit', options.permission('audit.view'), async (_req, res) => res.json({ events: await service.db.promotionAuditEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }) }));
  router.use(options.permission('recharge.configuration.manage'), limiter());
  router.post('/promoters', async (req: AdminRequest, res) => res.status(201).json(await service.createPromoter(req.userId!, z.object({ name: z.string().trim().min(2).max(120), customerId: z.uuid().optional() }).strict().parse(req.body))));
  router.post('/campaigns', async (req: AdminRequest, res) => res.status(201).json(await service.saveCampaign(req.userId!, campaignInput.parse(req.body))));
  router.put('/campaigns/:id', async (req: AdminRequest, res) => res.json(await service.saveCampaign(req.userId!, campaignInput.parse(req.body), z.uuid().parse(req.params.id))));
  router.patch('/rewards/:id', async (req: AdminRequest, res) => {
    const input = z.object({ status: z.enum(['APPROVED', 'PAYABLE', 'PAID', 'REVERSED']), reason: z.string().trim().min(5).max(300) }).strict().parse(req.body);
    await service.changeReward(req.userId!, z.uuid().parse(req.params.id), input.status, input.reason);
    res.status(204).end();
  });
  router.use(safeErrors);
  return router;
}
