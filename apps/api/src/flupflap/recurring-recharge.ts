import type { PrismaClient } from '@prisma/client';
import { flupFlapCustomerId, flupFlapOwner } from './owner.js';
import type { FlupFlapIdentityRepository } from './repository.js';
import { MobileTopUpError } from '../topup/types.js';
import type { MobileTopUpService } from '../topup/service.js';

type AuditRecorder = (
  owner: string | undefined,
  action: string,
  entity: string,
  entityId?: string,
  metadata?: Record<string, unknown>,
) => Promise<void>;

const allowedIntervals = new Set([7, 15, 30]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function recurringRechargeEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (env.FLUPFLAP_RECURRING_RECHARGE_ENABLED ?? 'false').trim().toLowerCase() === 'true';
}

function nextOccurrence(from: Date, intervalDays: number, now = new Date()) {
  let next = new Date(from.getTime() + intervalDays * 24 * 60 * 60_000);
  while (next <= now) next = new Date(next.getTime() + intervalDays * 24 * 60 * 60_000);
  return next;
}

function publicSchedule(row: {
  id: string;
  sourceTransactionId: string;
  intervalDays: number;
  status: string;
  maxTotalUsd: unknown;
  billingCountry: string;
  nextRunAt: Date;
  lastTransactionId: string | null;
  lastRunAt: Date | null;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: row.id,
    sourceTransactionId: row.sourceTransactionId,
    intervalDays: row.intervalDays,
    status: row.status,
    maxTotalUsd: Number(row.maxTotalUsd),
    billingCountry: row.billingCountry,
    nextRunAt: row.nextRunAt.toISOString(),
    lastTransactionId: row.lastTransactionId,
    lastRunAt: row.lastRunAt?.toISOString() ?? null,
    failureCode: row.failureCode,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class FlupFlapRecurringRechargeService {
  constructor(
    private readonly db: PrismaClient,
    private readonly identities: FlupFlapIdentityRepository,
    private readonly topups: MobileTopUpService,
    private readonly audit: AuditRecorder,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  private customerId(owner: string) {
    const id = flupFlapCustomerId(owner);
    if (!id) throw new MobileTopUpError('FORBIDDEN', 'FlupFlap account required', 403);
    return id;
  }

  async create(owner: string, input: { transactionId: string; intervalDays: number; consent: boolean }) {
    const customerId = this.customerId(owner);
    if (!input.consent || !allowedIntervals.has(input.intervalDays) || !uuid.test(input.transactionId)) {
      throw new MobileTopUpError('INVALID_RECURRING_RECHARGE', 'Valid consent, transaction and interval are required', 400);
    }
    const customer = await this.identities.customer(customerId);
    if (!customer || customer.guestExpiresAt || customer.status !== 'ACTIVE') {
      throw new MobileTopUpError('ACCOUNT_REQUIRED', 'A registered FlupFlap account is required', 403);
    }
    if (!/^[A-Z]{2}$/.test(customer.countryCode ?? '')) {
      throw new MobileTopUpError('BILLING_COUNTRY_REQUIRED', 'Select a billing country before enabling automatic recharge', 409);
    }

    const binding = await this.topups.savedRecurringPaymentMethod(owner, input.transactionId);
    const source = binding.record;
    const now = this.clock();
    const nextRunAt = new Date(now.getTime() + input.intervalDays * 24 * 60 * 60_000);
    const row = await this.db.flupFlapRecurringRecharge.upsert({
      where: { customerId_sourceTransactionId: { customerId, sourceTransactionId: input.transactionId } },
      update: {
        intervalDays: input.intervalDays,
        status: 'ACTIVE',
        maxTotalUsd: source.totalChargeUsd,
        stripeCustomerId: binding.customerId,
        stripePaymentMethodId: binding.paymentMethodId,
        billingCountry: customer.countryCode!,
        nextRunAt,
        pendingOccurrenceAt: null,
        pendingQuoteId: null,
        claimedAt: null,
        failureCode: null,
      },
      create: {
        customerId,
        sourceTransactionId: input.transactionId,
        intervalDays: input.intervalDays,
        status: 'ACTIVE',
        maxTotalUsd: source.totalChargeUsd,
        stripeCustomerId: binding.customerId,
        stripePaymentMethodId: binding.paymentMethodId,
        billingCountry: customer.countryCode!,
        nextRunAt,
      },
    });
    await this.audit(owner, 'FLUPFLAP_RECURRING_RECHARGE_ENABLED', 'FlupFlapRecurringRecharge', row.id, {
      intervalDays: input.intervalDays,
      sourceTransactionId: input.transactionId,
      maxTotalUsd: Number(source.totalChargeUsd),
    });
    return publicSchedule(row);
  }

  async list(owner: string) {
    const customerId = this.customerId(owner);
    const rows = await this.db.flupFlapRecurringRecharge.findMany({
      where: { customerId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(publicSchedule);
  }

  async update(owner: string, id: string, action: 'PAUSE' | 'RESUME' | 'CANCEL') {
    const customerId = this.customerId(owner);
    if (!uuid.test(id)) throw new MobileTopUpError('INVALID_RECURRING_RECHARGE', 'Invalid recurring recharge', 400);
    const existing = await this.db.flupFlapRecurringRecharge.findFirst({ where: { id, customerId } });
    if (!existing) throw new MobileTopUpError('RECURRING_RECHARGE_NOT_FOUND', 'Recurring recharge was not found', 404);
    if (existing.status === 'CANCELLED') return publicSchedule(existing);
    const now = this.clock();
    const row = await this.db.flupFlapRecurringRecharge.update({
      where: { id },
      data: action === 'PAUSE'
        ? { status: 'PAUSED', claimedAt: null }
        : action === 'CANCEL'
          ? { status: 'CANCELLED', claimedAt: null, pendingOccurrenceAt: null, pendingQuoteId: null }
          : {
              status: 'ACTIVE',
              claimedAt: null,
              pendingOccurrenceAt: null,
              pendingQuoteId: null,
              failureCode: null,
              nextRunAt: new Date(now.getTime() + existing.intervalDays * 24 * 60 * 60_000),
            },
    });
    await this.audit(owner, `FLUPFLAP_RECURRING_RECHARGE_${action}`, 'FlupFlapRecurringRecharge', id);
    return publicSchedule(row);
  }

  async runDue(limit = 25) {
    const now = this.clock();
    const staleClaim = new Date(now.getTime() - 10 * 60_000);
    const due = await this.db.flupFlapRecurringRecharge.findMany({
      where: { status: 'ACTIVE', nextRunAt: { lte: now }, OR: [{ claimedAt: null }, { claimedAt: { lt: staleClaim } }] },
      orderBy: { nextRunAt: 'asc' },
      take: Math.max(1, Math.min(100, limit)),
    });
    let completed = 0;
    let paused = 0;
    let pending = 0;

    for (const candidate of due) {
      const claimed = await this.db.flupFlapRecurringRecharge.updateMany({
        where: {
          id: candidate.id,
          status: 'ACTIVE',
          nextRunAt: candidate.nextRunAt,
          OR: [{ claimedAt: null }, { claimedAt: { lt: staleClaim } }],
        },
        data: { claimedAt: now },
      });
      if (claimed.count !== 1) continue;

      let row = await this.db.flupFlapRecurringRecharge.findUniqueOrThrow({ where: { id: candidate.id } });
      const owner = flupFlapOwner(row.customerId);
      try {
        const occurrence = row.pendingOccurrenceAt ?? row.nextRunAt;
        let quoteId = row.pendingQuoteId;
        if (!quoteId) {
          const quote = await this.topups.repeat(owner, row.sourceTransactionId);
          if (Number(quote.totalChargeUsd) > Number(row.maxTotalUsd) + 0.000001) {
            await this.db.flupFlapRecurringRecharge.update({
              where: { id: row.id },
              data: { status: 'PAUSED', claimedAt: null, failureCode: 'PRICE_INCREASE_REQUIRES_APPROVAL' },
            });
            await this.audit(owner, 'FLUPFLAP_RECURRING_RECHARGE_PAUSED', 'FlupFlapRecurringRecharge', row.id, {
              reason: 'PRICE_INCREASE_REQUIRES_APPROVAL',
              previousMaximum: Number(row.maxTotalUsd),
              currentTotal: Number(quote.totalChargeUsd),
            });
            paused++;
            continue;
          }
          quoteId = quote.id;
          row = await this.db.flupFlapRecurringRecharge.update({
            where: { id: row.id },
            data: { pendingQuoteId: quote.id, pendingOccurrenceAt: occurrence },
          });
        }

        const transaction = await this.topups.chargeSavedPayment(
          owner,
          { quoteId },
          `recurring:${row.id}:${occurrence.getTime()}`,
          {
            customerId: row.stripeCustomerId,
            paymentMethodId: row.stripePaymentMethodId,
            billingCountry: row.billingCountry,
          },
        );

        if (transaction.status === 'DELIVERED' && transaction.paymentStatus === 'CAPTURED') {
          await this.db.flupFlapRecurringRecharge.update({
            where: { id: row.id },
            data: {
              nextRunAt: nextOccurrence(occurrence, row.intervalDays, now),
              pendingOccurrenceAt: null,
              pendingQuoteId: null,
              claimedAt: null,
              lastTransactionId: transaction.id,
              lastRunAt: now,
              failureCode: null,
            },
          });
          await this.audit(owner, 'FLUPFLAP_RECURRING_RECHARGE_COMPLETED', 'FlupFlapRecurringRecharge', row.id, {
            transactionId: transaction.id,
          });
          completed++;
        } else if (transaction.status === 'FAILED' || ['FAILED', 'REFUNDED', 'VOIDED'].includes(transaction.paymentStatus)) {
          await this.db.flupFlapRecurringRecharge.update({
            where: { id: row.id },
            data: {
              status: 'PAUSED',
              claimedAt: null,
              lastTransactionId: transaction.id,
              lastRunAt: now,
              failureCode: transaction.failureCode ?? 'RECURRING_RECHARGE_FAILED',
            },
          });
          await this.audit(owner, 'FLUPFLAP_RECURRING_RECHARGE_PAUSED', 'FlupFlapRecurringRecharge', row.id, {
            transactionId: transaction.id,
            reason: transaction.failureCode ?? 'RECURRING_RECHARGE_FAILED',
          });
          paused++;
        } else {
          await this.db.flupFlapRecurringRecharge.update({
            where: { id: row.id },
            data: { claimedAt: null, lastTransactionId: transaction.id, failureCode: 'RECURRING_RECHARGE_PENDING' },
          });
          pending++;
        }
      } catch (error) {
        const code = error instanceof MobileTopUpError ? error.code : 'RECURRING_RECHARGE_RETRY_REQUIRED';
        const terminal = [
          'TOPUP_QUOTE_CHANGED',
          'TOPUP_PRODUCT_UNAVAILABLE',
          'RECURRING_PAYMENT_METHOD_UNAVAILABLE',
          'BILLING_COUNTRY_REQUIRED',
          'RECURRING_SOURCE_NOT_ELIGIBLE',
        ].includes(code);
        await this.db.flupFlapRecurringRecharge.update({
          where: { id: row.id },
          data: {
            ...(terminal ? { status: 'PAUSED' } : {}),
            claimedAt: null,
            failureCode: code,
          },
        });
        await this.audit(owner, terminal ? 'FLUPFLAP_RECURRING_RECHARGE_PAUSED' : 'FLUPFLAP_RECURRING_RECHARGE_RETRY_REQUIRED',
          'FlupFlapRecurringRecharge', row.id, { reason: code });
        if (terminal) paused++; else pending++;
      }
    }
    return { scanned: due.length, completed, paused, pending };
  }
}
