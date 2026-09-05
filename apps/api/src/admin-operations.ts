import { z } from 'zod';

export const payoutMethods = ['MONCASH', 'NATCASH', 'HAITIAN_BANK'] as const;
export const payoutOperationalStates = ['DISABLED', 'SANDBOX', 'PENDING_APPROVAL', 'ACTIVE', 'SUSPENDED'] as const;
export type PayoutMethodName = typeof payoutMethods[number];
export type PayoutOperationalStateName = typeof payoutOperationalStates[number];

export interface PublicPayoutConfiguration {
  method: PayoutMethodName;
  state: PayoutOperationalStateName;
  environment: 'MOCK' | 'SANDBOX' | 'PRODUCTION';
  providerConfigured: boolean;
  providerApproved: boolean;
  regulatoryApproved: boolean;
  approvedForLiveUse: false;
  version: number;
  statusMessage?: string;
  updatedAt: string;
}

export class AdminOperationError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 409) {
    super(message);
  }
}

export const payoutConfigurationUpdateSchema = z.object({
  state: z.enum(payoutOperationalStates),
  reason: z.string().trim().min(5).max(500),
}).strict();

export const feeLimitConfigurationSchema = z.object({
  ticashFeePercent: z.number().min(0).max(100),
  ticashMinimumFeeUsd: z.number().min(0).max(10_000),
  providerFundingFeeUsd: z.number().min(0).max(10_000),
  limitsEnabled: z.boolean(),
  perTransactionUsd: z.number().positive().max(1_000_000).nullable(),
  dailyUsd: z.number().positive().max(10_000_000).nullable(),
  weeklyUsd: z.number().positive().max(50_000_000).nullable(),
  monthlyUsd: z.number().positive().max(100_000_000).nullable(),
  reason: z.string().trim().min(5).max(500),
}).strict().superRefine((value, context) => {
  if (value.limitsEnabled && [value.perTransactionUsd, value.dailyUsd, value.weeklyUsd, value.monthlyUsd].some((item) => item === null)) {
    context.addIssue({ code: 'custom', message: 'Every limit is required when transaction limits are enabled' });
  }
  const ordered = [value.perTransactionUsd, value.dailyUsd, value.weeklyUsd, value.monthlyUsd];
  if (value.limitsEnabled && ordered.some((value, index) => index > 0 && value! < ordered[index - 1]!)) {
    context.addIssue({ code: 'custom', message: 'Transaction limits must not decrease as the time window grows' });
  }
});

export function assertSafePayoutTransition(input: {
  current: PayoutOperationalStateName;
  requested: PayoutOperationalStateName;
  environment: string;
  providerConfigured: boolean;
  providerApproved: boolean;
  regulatoryApproved: boolean;
  approvedForLiveUse: boolean;
}) {
  if (input.requested === 'ACTIVE') {
    if (input.environment !== 'PRODUCTION' || !input.providerConfigured || !input.providerApproved ||
        !input.regulatoryApproved || !input.approvedForLiveUse) {
      throw new AdminOperationError('PRODUCTION_ACTIVATION_BLOCKED',
        'Production payout activation requires provider configuration, provider approval, regulatory approval, and corridor live approval');
    }
  }
  if (input.current === 'DISABLED' && input.requested === 'ACTIVE') {
    throw new AdminOperationError('UNSAFE_PROVIDER_TRANSITION',
      'A payout method must pass through approval and sandbox validation before activation');
  }
}

export function maskEmail(email: string): string {
  const [name = '', domain] = email.split('@');
  if (!domain) return '***';
  return `${name.slice(0, 2)}***@${domain}`;
}

export function maskPhone(phone: string | null | undefined): string | undefined {
  return phone ? `••••${phone.slice(-4)}` : undefined;
}

export function transferTimeline(transfer: {
  createdAt: Date | string;
  updatedAt?: Date | string;
  stage: string;
  completedAt?: Date | string | null;
  payoutStartedAt?: Date | string | null;
  fundingStatus?: string | null;
  fundingCreatedAt?: Date | string | null;
  fundingCompletedAt?: Date | string | null;
  complianceReviewedAt?: Date | string | null;
}) {
  const iso = (value: Date | string | null | undefined) => value ? new Date(value).toISOString() : undefined;
  const events = [{ state: 'CREATED', at: iso(transfer.createdAt), complete: true }];
  events.push({ state: 'QUOTED', at: iso(transfer.createdAt), complete: true });
  events.push({
    state: 'FUNDING',
    at: iso(transfer.fundingCreatedAt),
    complete: Boolean(transfer.fundingCreatedAt || !['AWAITING_FUNDING'].includes(transfer.stage)),
  });
  events.push({
    state: 'FUNDED',
    at: iso(transfer.fundingCompletedAt),
    complete: transfer.fundingStatus === 'COMPLETED' || ['COMPLIANCE_REVIEW', 'PAYOUT_PROCESSING', 'DELIVERED'].includes(transfer.stage),
  });
  events.push({
    state: 'COMPLIANCE',
    at: iso(transfer.complianceReviewedAt),
    complete: ['PAYOUT_PROCESSING', 'DELIVERED'].includes(transfer.stage),
  });
  events.push({
    state: 'PAYOUT',
    at: iso(transfer.payoutStartedAt),
    complete: ['PAYOUT_PROCESSING', 'DELIVERED'].includes(transfer.stage),
  });
  events.push({ state: 'COMPLETED', at: iso(transfer.completedAt), complete: transfer.stage === 'DELIVERED' });
  return events;
}
