import { paymentAttemptReviewReason } from '../topup/payment-attempt-controls.js';
import { createHash, randomBytes } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { RequestHandler } from 'express';
import { MobileTopUpError } from '../topup/types.js';

const devicePattern = /^[a-f0-9]{64}$/;
/** An installation signal, never proof of identity. No hardware or location data. */
export async function checkRechargeDevice(db: PrismaClient, customerId: string, deviceId: string) {
  if (!devicePattern.test(deviceId)) return;
  const deviceHash = createHash('sha256').update('flupflap-device:' + deviceId).digest('hex');
  const reason = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${deviceHash}, 0))`;
    const cutoff = new Date(Date.now() - 30 * 86400000);
    const linked = await tx.flupFlapDevice.findMany({ where: { deviceHash, lastSeenAt: { gte: cutoff }, customerId: { not: customerId } } });
    const restricted = linked.length ? await tx.flupFlapCustomer.findFirst({ where: {
      id: { in: linked.map(row => row.customerId) }, OR: [{ rechargeRestricted: true }, { status: { not: 'ACTIVE' } }],
    }, select: { id: true } }) : null;
    // Do not retain rejected new associations: they cannot exhaust the limit for others.
    if (restricted || linked.length >= 2) return restricted ? 'DEVICE_RESTRICTED_LINK' : 'DEVICE_ACCOUNT_LIMIT';
    const attemptReason = await paymentAttemptReviewReason(tx, customerId, new Date(), undefined, linked.map(row => row.customerId));
    if (attemptReason) return attemptReason;
    await tx.flupFlapDevice.upsert({ where: { deviceHash_customerId: { deviceHash, customerId } },
      create: { deviceHash, customerId }, update: { lastSeenAt: new Date() } });
    return undefined;
  });
  if (reason) throw new MobileTopUpError(reason, 'This purchase needs support review. Contact FlupFlap support.', 403);
}

export function rechargeDeviceGuard(db: PrismaClient): RequestHandler {
  return async (req, res, next) => {
    try {
      const owner = (req as typeof req & { userId?: string }).userId;
      if (!owner?.startsWith('flupflap:')) return next();
      const header = req.header('X-FlupFlap-Device');
      const cookie = (req.header('cookie') ?? '').split(';').map(v => v.trim()).find(v => v.startsWith('flupflap_device='))?.slice(16);
      // Older native builds do not persist cookies. Remain compatible while the
      // other account/card/recipient controls enforce their independent limits.
      const supplied = header ?? cookie;
      const device = supplied && devicePattern.test(supplied) ? supplied : randomBytes(32).toString('hex');
      res.cookie('flupflap_device', device, { httpOnly: true, secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', path: '/api/flupflap', maxAge: 30 * 86400000 });
      await checkRechargeDevice(db, owner.slice(9), device);
      next();
    } catch (error) { next(error); }
  };
}
