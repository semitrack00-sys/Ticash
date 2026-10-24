import express, { type ErrorRequestHandler, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createMobileTopUpRouter } from '../src/topup/router.js';
import type { MobileTopUpService } from '../src/topup/service.js';
import { MobileTopUpError } from '../src/topup/types.js';

function fixture(guest: boolean, allowGuestPurchases = false) {
  const service = {
    createPaymentSession: vi.fn().mockResolvedValue({ checkoutSession: { id: 'fixture' } }),
    purchase: vi.fn().mockResolvedValue({ id: 'fixture' }),
    listTransactions: vi.fn().mockResolvedValue([]),
    listCountries: vi.fn().mockResolvedValue([]),
  };
  const authenticate: RequestHandler = (req, _res, next) => {
    Object.assign(req, { userId: 'fixture-owner' }); next();
  };
  const app = express();
  app.use(express.json());
  app.use(createMobileTopUpRouter({
    authenticate, requireFundingAllowed: (_req, _res, next) => next(),
    service: service as unknown as MobileTopUpService,
    isGuest: async () => guest, billingCountryForUser: async () => 'US',
    allowGuestPurchases,
  }));
  const errors: ErrorRequestHandler = (error, _req, res, _next) => {
    res.status(error instanceof MobileTopUpError ? 403 : 500).json({ code: error.code });
  };
  app.use(errors);
  return { app, service };
}

describe('registered account purchase requirement', () => {
  for (const endpoint of ['payment-sessions', 'transactions']) {
    it('blocks an authenticated guest before creating ' + endpoint, async () => {
      const { app, service } = fixture(true);
      const response = await request(app).post('/' + endpoint).send({});
      expect(response.status).toBe(403);
      expect(response.body.code).toBe('REGISTERED_ACCOUNT_REQUIRED');
      expect(service.createPaymentSession).not.toHaveBeenCalled();
      expect(service.purchase).not.toHaveBeenCalled();
    });
    it('allows a registered buyer to create ' + endpoint, async () => {
      const { app } = fixture(false);
      const response = await request(app).post('/' + endpoint)
        .set('Idempotency-Key', 'fixture-attempt')
        .send({ quoteId: '12345678-1234-4234-8234-123456789abc' });
      expect(response.status).toBe(201);
    });
  }
  it('preserves guest browsing and access to existing receipts', async () => {
    const { app } = fixture(true);
    expect((await request(app).get('/countries')).status).toBe(200);
    expect((await request(app).get('/transactions')).status).toBe(200);
  });
  it('preserves explicitly enabled guest purchasing for other router consumers', async () => {
    const { app } = fixture(true, true);
    expect((await request(app).post('/payment-sessions')
      .set('Idempotency-Key', 'fixture-attempt')
      .send({ quoteId: '12345678-1234-4234-8234-123456789abc', billingCountry: 'US' })).status).toBe(201);
  });
});
