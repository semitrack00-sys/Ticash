import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { createFlupFlapAdmin } from '../src/flupflap/admin.js';
import { requirePermission, type AdminRequest } from '../src/admin-access.js';
import { assertPurchaseLimits } from '../src/topup/fraud-policy.js';
import { resetPurchaseAttempts } from '../src/topup/purchase-attempt-reset.js';

const customerId = '11111111-1111-4111-8111-111111111111';
const reason = 'Reviewed failed checkout history with the customer';
const requestId = 'a'.repeat(32);
const path = `/api/admin/flupflap/customers/${customerId}/purchase-attempts/reset`;
function fixture() {
  const reset = vi.fn().mockResolvedValue({ resetCount: 3 });
  const app = express(); app.use(express.json());
  app.use('/api/admin/flupflap', createFlupFlapAdmin({
    authenticate: (req: AdminRequest, res, next) => {
      const actor = req.header('Authorization');
      if (!actor) { res.sendStatus(401); return; }
      req.userId = actor; next();
    },
    permission: p => requirePermission(p, async actor => ({ admin: 'ADMIN', super: 'SUPER_ADMIN', ops: 'OPERATIONS', support: 'SUPPORT', read: 'READ_ONLY', customer: 'CUSTOMER' })[actor]),
    identities: {} as never, recharge: { resetPurchaseAttempts: reset } as never,
    service: {} as never, audit: vi.fn(), auditRows: async () => [],
  }));
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    void _next;
    res.status(error instanceof ZodError ? 400 : 500).json({ error: error.message });
  });
  return { app, reset };
}

describe('admin purchase attempt reset boundary', () => {
  it('rejects unauthenticated, customer, read-only, support and operations callers', async () => {
    const { app, reset } = fixture();
    await request(app).post(path).send({ reason, requestId }).expect(401);
    for (const actor of ['customer', 'read', 'support', 'ops']) {
      await request(app).post(path).set('Authorization', actor).send({ reason, requestId }).expect(403);
    }
    expect(reset).not.toHaveBeenCalled();
  });
  it.each(['admin', 'super'])('allows %s with a required reason and no extra override controls', async actor => {
    const { app, reset } = fixture();
    for (const body of [{ requestId }, { reason: 'short', requestId }, { reason, requestId, clearFraudHold: true }, { reason, requestId: 'bad' }]) {
      await request(app).post(path).set('Authorization', actor).send(body).expect(400);
    }
    expect(reset).not.toHaveBeenCalled();
    const result = await request(app).post(path).set('Authorization', actor).send({ reason, requestId }).expect(200);
    expect(result.body).toEqual({ resetCount: 3, otherLimitsStillApply: true });
    expect(result.headers['cache-control']).toBe('no-store');
    expect(reset).toHaveBeenCalledExactlyOnceWith(customerId, actor, reason, requestId);
  });
  it('never exempts dollar usage when reservation counts are reset', () => {
    const now = new Date();
    const history = Array.from({length: 10}, () => ({createdAt: now.toISOString(), totalChargeUsd: 20, paymentStatus: 'FAILED', attemptExempt: true}));
    expect(() => assertPurchaseLimits(1, history, now, false)).toThrow();
    expect(() => assertPurchaseLimits(1, history.map(r => ({...r, totalChargeUsd: 1})), now, false)).not.toThrow();
    expect(() => assertPurchaseLimits(1, [...history.map(r => ({...r, totalChargeUsd: 1})), ...history.slice(0,3).map(r => ({...r, attemptExempt: false}))], now, false)).toThrow();
  });
  it('cannot record a reset when the audit write fails', async () => {
    const tx = {
      $queryRaw: vi.fn(),
      flupFlapCustomer: {findUnique: vi.fn().mockResolvedValue({status:'ACTIVE'})},
      mobileTopUpTransaction: {findFirst: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([{id:'failed'}])},
      auditLog: {findUnique: vi.fn().mockResolvedValue(null), findMany: vi.fn().mockResolvedValue([]), create: vi.fn().mockRejectedValue(new Error('Audit unavailable'))},
    };
    const db = {$transaction: (fn: (tx: unknown) => unknown) => fn(tx)};
    await expect(resetPurchaseAttempts(db as never, customerId, 'admin', reason, requestId)).rejects.toThrow('Audit unavailable');
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    expect(tx.mobileTopUpTransaction).not.toHaveProperty('updateMany');
  });
});
