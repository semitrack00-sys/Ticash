import type { Prisma, PrismaClient } from '@prisma/client';
import { MobileTopUpError } from './types.js';

const action = 'FLUPFLAP_PURCHASE_ATTEMPTS_RESET';

/** Explicit reservation IDs, never a time cutoff that could exempt an in-flight request. */
export async function resetPurchaseAttemptIds(db: Prisma.TransactionClient, customerId: string, now: Date) {
  const rows = await db.auditLog.findMany({ where: {
    flupFlapCustomerId: customerId, action, createdAt: { gte: new Date(now.getTime() - 86400000) },
  }, select: { metadata: true } });
  return new Set(rows.flatMap(row => {
    const metadata = row.metadata as Record<string, unknown> | null;
    return Array.isArray(metadata?.transactionIds) ? metadata.transactionIds.filter((id): id is string => typeof id === 'string') : [];
  }));
}

export async function resetPurchaseAttempts(db: PrismaClient, customerId: string, actor: string, reason: string, requestId: string) {
  if (!actor || reason.trim().length < 20 || reason.trim().length > 500 || !/^[a-f0-9]{32}$/.test(requestId)) {
    throw new MobileTopUpError('PURCHASE_RESET_INVALID', 'A staff actor, review reason and request ID are required.', 400);
  }
  return db.$transaction(async tx => {
    // Same row lock as checkout: concurrent reservations cannot enter this snapshot.
    await tx.$queryRaw`SELECT id FROM "FlupFlapCustomer" WHERE id = ${customerId} FOR UPDATE`;
    const customer = await tx.flupFlapCustomer.findUnique({ where: { id: customerId } });
    if (!customer) throw new MobileTopUpError('CUSTOMER_NOT_FOUND', 'Customer was not found.', 404);
    if (customer.status !== 'ACTIVE' || customer.guestExpiresAt || customer.rechargeRestricted) {
      throw new MobileTopUpError('PURCHASE_RESET_RESTRICTED', 'Review the account restriction separately.', 409);
    }
    const id = 'purchase-reset:' + requestId;
    const previous = await tx.auditLog.findUnique({ where: { id } });
    if (previous) {
      const metadata = previous.metadata as Record<string, unknown> | null;
      if (previous.action !== action || previous.flupFlapCustomerId !== customerId || previous.userId !== actor || metadata?.reason !== reason.trim()) {
        throw new MobileTopUpError('PURCHASE_RESET_CONFLICT', 'Reset request ID was already used.', 409);
      }
      return { resetCount: Array.isArray(metadata.transactionIds) ? metadata.transactionIds.length : 0 };
    }
    const pending = await tx.mobileTopUpTransaction.findFirst({ where: {
      flupFlapCustomerId: customerId, testMode: false,
      OR: [{ status: { notIn: ['DELIVERED', 'FAILED', 'REFUNDED'] } },
        { paymentStatus: { in: ['PENDING', 'SESSION_CREATED', 'AUTHORIZED', 'VOID_PENDING', 'REFUND_PENDING'] } },
        { status: 'FAILED', paymentStatus: 'CAPTURED' },
        { failureCode: 'FRAUD_REVIEW_REQUIRED' }],
    }, select: { id: true } });
    if (pending) throw new MobileTopUpError('PURCHASE_RESET_PAYMENT_UNRESOLVED', 'Resolve pending payments and fraud holds before resetting attempts.', 409);
    const now = new Date();
    const exempt = await resetPurchaseAttemptIds(tx, customerId, now);
    const failed = await tx.mobileTopUpTransaction.findMany({ where: {
      flupFlapCustomerId: customerId, testMode: false, status: 'FAILED', paymentStatus: 'FAILED',
      createdAt: { gte: new Date(now.getTime() - 86400000) },
    }, select: { id: true } });
    const transactionIds = failed.map(r => r.id).filter(id => !exempt.has(id));
    // The audit row IS the reset. Audit failure rolls back the operation.
    await tx.auditLog.create({ data: { id, userId: actor, flupFlapCustomerId: customerId,
      action, entity: 'FlupFlapCustomer', entityId: customerId,
      metadata: { reason: reason.trim(), transactionIds, scope: 'FAILED_RESERVATION_COUNTS_ONLY' },
    } });
    return { resetCount: transactionIds.length };
  });
}
