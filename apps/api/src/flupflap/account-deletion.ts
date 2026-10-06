import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';

// An operator-only maintenance operation, deliberately not exposed as an HTTP route.
export const deletionRequest = z.object({
  customerId: z.uuid(),
  staffId: z.uuid(),
  verifiedEmail: z.email().trim().toLowerCase(),
  requestReference: z.string().regex(/^[A-Za-z0-9_-]{4,64}$/),
  verificationMethod: z.enum(['REGISTERED_EMAIL_CONTROL', 'AUTHENTICATED_CUSTOMER']),
  maintenanceConfirmed: z.boolean(),
}).strict();

export class AccountDeletionError extends Error {
  constructor(public readonly code: string) { super(code); }
}

export async function deleteFlupFlapAccount(db: PrismaClient, raw: unknown, execute = false) {
  const input = deletionRequest.parse(raw);
  if (execute && !input.maintenanceConfirmed) throw new AccountDeletionError('MAINTENANCE_REQUIRED');
  return db.$transaction(async tx => {
    // Serialize with identity-scoped inserts protected by the deletion migration.
    await tx.$queryRaw`SELECT id FROM "FlupFlapCustomer" WHERE id = ${input.customerId} FOR UPDATE`;
    const staff = await tx.user.findUnique({ where: { id: input.staffId } });
    if (!staff || staff.accountLocked || !['ADMIN', 'SUPER_ADMIN'].includes(staff.role)) {
      throw new AccountDeletionError('ADMIN_REQUIRED');
    }
    const customer = await tx.flupFlapCustomer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw new AccountDeletionError('CUSTOMER_NOT_FOUND');
    if (customer.status === 'DELETED') throw new AccountDeletionError('ALREADY_DELETED');
    if (customer.guestExpiresAt || customer.email !== input.verifiedEmail) {
      throw new AccountDeletionError('VERIFIED_IDENTITY_MISMATCH');
    }
    const owner = { flupFlapCustomerId: customer.id };
    const unsettled = await tx.mobileTopUpTransaction.count({ where: { ...owner, OR: [
      { status: { in: ['PENDING', 'PROCESSING'] } },
      { paymentStatus: { notIn: ['CAPTURED', 'FAILED', 'VOIDED', 'REFUNDED'] } },
      { recoveryStartedAt: { not: null }, paymentRecoveryCode: { not: null } },
    ] } });
    const claims = await tx.flupFlapRecurringRecharge.count({ where: {
      customerId: customer.id, claimedAt: { not: null },
    } });
    const notificationClaims = await tx.rechargeNotification.count({ where: {
      transaction: owner, claimedAt: { not: null },
    } });
    if (unsettled || claims || notificationClaims) throw new AccountDeletionError('PAYMENT_OR_WORKER_UNRESOLVED');
    const counts = {
      recipients: await tx.mobileTopUpRecipient.count({ where: owner }),
      sessions: await tx.flupFlapSession.count({ where: { customerId: customer.id } }),
      recurringSchedules: await tx.flupFlapRecurringRecharge.count({ where: { customerId: customer.id } }),
      retainedTransactions: await tx.mobileTopUpTransaction.count({ where: owner }),
    };
    if (!execute) return { mode: 'PREVIEW', customerId: customer.id, ...counts };

    await eraseFlupFlapAccountData(tx, customer.id);
    const audit = await tx.auditLog.create({ data: {
      userId: staff.id, action: 'FLUPFLAP_ACCOUNT_DELETED', entity: 'FlupFlapCustomer', entityId: customer.id,
      metadata: { requestReference: input.requestReference, verificationMethod: input.verificationMethod,
        ...counts, retained: 'TRANSACTION_SECURITY_PROMOTION_ACCOUNTING', policyVersion: 1 },
    } });
    return { mode: 'EXECUTED', customerId: customer.id, auditId: audit.id, ...counts };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 });
}

// Internal maintenance primitive shared by verified deletion and authenticated restore suppression.
// Call only inside a drained serializable transaction after the caller's authorization checks.
export async function eraseFlupFlapAccountData(tx: Prisma.TransactionClient, customerId: string, incrementVersion = true) {
    const owner = { flupFlapCustomerId: customerId };
    await tx.flupFlapSession.deleteMany({ where: { customerId: customerId } });
    await tx.flupFlapPasswordResetToken.deleteMany({ where: { customerId: customerId } });
    // Deleting schedules removes saved Stripe bindings and prevents future recurring charges.
    await tx.flupFlapRecurringRecharge.deleteMany({ where: { customerId: customerId } });
    await tx.mobileTopUpRecipient.deleteMany({ where: owner });
    // Financial quotes/redemptions stay with transaction history; unused browsing quotes are erased.
    await tx.mobileTopUpQuote.deleteMany({ where: { ...owner, transaction: null, promotion: null } });
    await tx.promotionRedemption.updateMany({ where: {
      customerId: customerId, status: 'RESERVED', quote: { transaction: null },
    }, data: { status: 'EXPIRED' } });
    await tx.mobileTopUpQuote.updateMany({ where: { ...owner, transaction: null }, data: {
      recipientPhone: 'DELETED', receiverQuote: Prisma.DbNull, productSnapshot: Prisma.DbNull,
      expiresAt: new Date(0),
    } });
    await tx.mobileTopUpTransaction.updateMany({ where: owner, data: {
      checkoutResumeTokenHash: null, checkoutResumeTokenExpiresAt: null, recurringIntervalDays: null,
    } });
    // Remove the customer's marketing attribution and linked visit/event capability.
    const attribution = await tx.referralAttribution.findUnique({ where: { customerId: customerId } });
    await tx.referralAttribution.deleteMany({ where: { customerId: customerId } });
    if (attribution) {
      await tx.campaignEvent.deleteMany({ where: { visitId: attribution.visitId } });
      await tx.campaignVisit.delete({ where: { id: attribution.visitId } });
    }
    // Keep opaque referral/payout accounting links, with no usable referral or promoter name.
    await tx.referralCode.updateMany({ where: { customerId: customerId }, data: { disabledAt: new Date() } });
    await tx.promoter.updateMany({ where: { customerId: customerId }, data: {
      name: 'Deleted account', disabledAt: new Date(),
    } });
    await tx.flupFlapCustomer.update({ where: { id: customerId }, data: {
      status: 'DELETED', rechargeRestricted: true, authVersion: incrementVersion ? { increment: 1 } : undefined,
      email: null, passwordHash: null, googleSubject: null, firstName: null, lastName: null,
      phone: null, countryCode: null, emailVerifiedAt: null, phoneVerifiedAt: null,
      guestExpiresAt: null, lastLoginAt: null, failedLoginAttempts: 0, loginLockedUntil: null,
    } });
}
