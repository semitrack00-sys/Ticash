import { Prisma, type PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AccountDeletionError, eraseFlupFlapAccountData } from './account-deletion.js';

// The caller must authenticate and verify the customer's password first. Never
// accept a customer UUID from the HTTP body. A deletion request is irreversible.
export class FlupFlapSelfServiceDeletion {
  constructor(private readonly db: PrismaClient) {}

  async request(customerId: string, passwordHash: string, authVersion: number) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "FlupFlapCustomer" WHERE id = ${customerId} FOR UPDATE`;
      const customer = await tx.flupFlapCustomer.findUnique({ where: { id: customerId } });
      if (!customer || customer.status !== 'ACTIVE' || customer.guestExpiresAt ||
          customer.passwordHash !== passwordHash || customer.authVersion !== authVersion) {
        throw new AccountDeletionError('DELETION_IDENTITY_CHANGED');
      }
      const request = await tx.flupFlapDeletionRequest.create({ data: { customerId } });
      await tx.flupFlapCustomer.update({ where: { id: customerId }, data: {
        status: 'DELETION_PENDING', rechargeRestricted: true, authVersion: { increment: 1 },
      } });
      await tx.flupFlapSession.deleteMany({ where: { customerId } });
      await tx.flupFlapPasswordResetToken.deleteMany({ where: { customerId } });
      // Keep in-flight claims until the worker drains; cancellation must not hide
      // an external charge already in progress. New claims are blocked in SQL.
      await tx.flupFlapRecurringRecharge.updateMany({ where: { customerId }, data: { status: 'CANCELLED' } });
      await tx.mobileTopUpTransaction.updateMany({ where: { flupFlapCustomerId: customerId }, data: {
        recurringIntervalDays: null, checkoutResumeTokenHash: null, checkoutResumeTokenExpiresAt: null,
      } });
      await tx.auditLog.create({ data: {
        flupFlapCustomerId: customerId, action: 'FLUPFLAP_ACCOUNT_DELETION_REQUESTED',
        entity: 'FlupFlapCustomer', entityId: customerId,
        metadata: { requestId: request.id, verificationMethod: 'AUTHENTICATED_CUSTOMER_PASSWORD' },
      } });
      return { requestId: request.id, status: 'DELETION_PENDING' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
  }

  async process(customerId: string) {
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "FlupFlapCustomer" WHERE id = ${customerId} FOR UPDATE`;
      const request = await tx.flupFlapDeletionRequest.findUnique({ where: { customerId } });
      const customer = await tx.flupFlapCustomer.findUnique({ where: { id: customerId } });
      if (!request || request.status !== 'PENDING' || customer?.status !== 'DELETION_PENDING') return undefined;
      const owner = { flupFlapCustomerId: customerId };
      const unsettled = await tx.mobileTopUpTransaction.count({ where: { ...owner, OR: [
        { status: { in: ['PENDING', 'PROCESSING'] } },
        { paymentStatus: { notIn: ['CAPTURED', 'FAILED', 'VOIDED', 'REFUNDED'] } },
        { recoveryStartedAt: { not: null }, paymentRecoveryCode: { not: null } },
      ] } });
      const claims = await tx.flupFlapRecurringRecharge.count({ where: { customerId, claimedAt: { not: null } } });
      const notifications = await tx.rechargeNotification.count({ where: { transaction: owner, claimedAt: { not: null } } });
      if (unsettled || claims || notifications) {
        await tx.flupFlapDeletionRequest.update({ where: { id: request.id }, data: {
          lastAttemptAt: new Date(), waitReason: unsettled ? 'PENDING_PAYMENTS' : 'IN_FLIGHT_WORK',
        } });
        return { requestId: request.id, status: 'DELETION_PENDING' as const };
      }
      await eraseFlupFlapAccountData(tx, customerId);
      const auditId = randomUUID();
      await tx.auditLog.create({ data: {
        id: auditId, flupFlapCustomerId: customerId, action: 'FLUPFLAP_ACCOUNT_DELETED',
        entity: 'FlupFlapCustomer', entityId: customerId,
        metadata: { requestId: request.id, verificationMethod: 'AUTHENTICATED_CUSTOMER_PASSWORD',
          retained: 'TRANSACTION_SECURITY_PROMOTION_ACCOUNTING', policyVersion: 2 },
      } });
      await tx.flupFlapDeletionRequest.update({ where: { id: request.id }, data: {
        status: 'LOCAL_DATA_DELETED', completedAt: new Date(), lastAttemptAt: new Date(), waitReason: null,
      } });
      return { requestId: request.id, status: 'LOCAL_DATA_DELETED' as const };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
  }

  async runBatch(limit = 25) {
    const requests = await this.db.flupFlapDeletionRequest.findMany({
      where: { status: 'PENDING' }, orderBy: [{ lastAttemptAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'asc' }],
      take: Math.max(1, Math.min(100, limit)),
    });
    let completed = 0;
    for (const request of requests) {
      try { if ((await this.process(request.customerId))?.status === 'LOCAL_DATA_DELETED') completed++; }
      catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')) {
          console.warn('FlupFlap account deletion will retry', { code: 'DELETION_WORKER_RETRY' });
        }
      }
    }
    return { scanned: requests.length, completed };
  }
}
