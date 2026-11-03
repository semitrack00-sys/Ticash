import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
vi.mock('../src/flupflap/marketing-recharge.js', () => ({ reconcilePromotion: vi.fn() }));
import { recoverLegacyCheckout } from '../src/topup/legacy-checkout-recovery.js';

function fixture() {
  const input = { transactionId: '4099c86a-f761-4ae3-bc4e-341aca8b6395', sessionId: 'cs_live_example',
    accountId: 'acct_old', secretKey: 'sk_live_example', apply: true };
  const row = { id: input.transactionId, flupFlapCustomerId: 'customer', userId: null,
    testMode: false, paymentEnvironment: 'PRODUCTION', rechargeEnvironment: 'PRODUCTION',
    paymentProvider: 'STRIPE', paymentSessionId: input.sessionId, status: 'PENDING',
    paymentStatus: 'SESSION_CREATED', totalChargeUsd: '5.85', updatedAt: new Date() };
  const session = { id: input.sessionId, livemode: true, mode: 'payment',
    client_reference_id: row.id, metadata: { transactionId: row.id }, currency: 'usd',
    amount_total: 585, payment_status: 'unpaid', payment_intent: null, status: 'open' };
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const audit = vi.fn().mockResolvedValue({});
  const transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({
    mobileTopUpTransaction: { updateMany }, auditLog: { create: audit },
  }));
  const db = { mobileTopUpTransaction: { findUniqueOrThrow: vi.fn().mockResolvedValue(row) },
    $transaction: transaction } as unknown as PrismaClient;
  const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/account')) return Response.json({ id: input.accountId });
    if (init?.method === 'POST') session.status = 'expired';
    return Response.json(session);
  });
  return { input, row, session, db, transport, updateMany, audit, transaction };
}

describe('operator recovery after Stripe account migration', () => {
  it('dry run verifies bindings without expiring or writing', async () => {
    const f = fixture(); f.input.apply = false;
    expect(await recoverLegacyCheckout(f.input, f.db, f.transport)).toMatchObject({ result: 'DRY_RUN' });
    expect(f.transport).toHaveBeenCalledTimes(2); expect(f.transaction).not.toHaveBeenCalled();
  });
  it('expires, rechecks, and atomically fails the reservation with an audit', async () => {
    const f = fixture();
    expect(await recoverLegacyCheckout(f.input, f.db, f.transport)).toMatchObject({ result: 'RECOVERED' });
    expect(f.transport).toHaveBeenCalledTimes(4);
    expect(f.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ updatedAt: f.row.updatedAt, paymentProviderTransactionId: null }),
      data: expect.objectContaining({ status: 'FAILED', paymentStatus: 'FAILED', checkoutResumeTokenHash: null }),
    }));
    expect(f.audit).toHaveBeenCalledTimes(1);
  });
  it.each([
    { payment_status: 'paid' }, { payment_intent: 'pi_processing' }, { amount_total: 586 },
    { livemode: false }, { metadata: { transactionId: 'other' } }, { status: 'complete' },
  ])('refuses ambiguous or mismatched session %j', async change => {
    const f = fixture(); Object.assign(f.session, change);
    await expect(recoverLegacyCheckout(f.input, f.db, f.transport)).rejects.toThrow('RECOVERY_SESSION');
    expect(f.transport).toHaveBeenCalledTimes(2); expect(f.transaction).not.toHaveBeenCalled();
  });
  it('refuses the wrong account before accessing the reservation', async () => {
    const f = fixture(); f.transport.mockImplementationOnce(async () => Response.json({ id: 'acct_new' }));
    await expect(recoverLegacyCheckout(f.input, f.db, f.transport)).rejects.toThrow('RECOVERY_ACCOUNT_MISMATCH');
    expect(f.db.mobileTopUpTransaction.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it('never clears an already processing reservation', async () => {
    const f = fixture(); f.row.status = 'PROCESSING';
    await expect(recoverLegacyCheckout(f.input, f.db, f.transport)).rejects.toThrow('RECOVERY_RECORD_NOT_ELIGIBLE');
    expect(f.transport).toHaveBeenCalledTimes(1); expect(f.transaction).not.toHaveBeenCalled();
  });
  it('leaves the database unchanged when expiration fails', async () => {
    const f = fixture(); f.transport.mockImplementation(async url => String(url).endsWith('/expire')
      ? new Response('', { status: 400 }) : Response.json(String(url).endsWith('/account') ? { id: f.input.accountId } : f.session));
    await expect(recoverLegacyCheckout(f.input, f.db, f.transport)).rejects.toThrow('RECOVERY_STRIPE_HTTP_400');
    expect(f.transaction).not.toHaveBeenCalled();
  });
  it('rejects a concurrent database change without writing an audit', async () => {
    const f = fixture(); f.updateMany.mockResolvedValue({ count: 0 });
    await expect(recoverLegacyCheckout(f.input, f.db, f.transport)).rejects.toThrow('RECOVERY_RECORD_CHANGED');
    expect(f.audit).not.toHaveBeenCalled();
  });
  it('can resume after expiration succeeded but database work failed', async () => {
    const f = fixture(); f.session.status = 'expired';
    await recoverLegacyCheckout(f.input, f.db, f.transport);
    expect(f.transport.mock.calls.every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(f.audit).toHaveBeenCalledTimes(1);
  });
});
