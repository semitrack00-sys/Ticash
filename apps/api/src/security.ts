import { createHmac } from 'node:crypto';
import { z } from 'zod';

export type ComplianceStatus = 'CLEAR' | 'REVIEW' | 'BLOCKED';

export interface ScreeningResult {
  status: ComplianceStatus;
  provider: string;
  performed: boolean;
  referenceId?: string;
  reasons: string[];
}

export interface SanctionsAmlProvider {
  screen(input: {
    userId: string;
    transferId: string;
    amountUsd: number;
    recipientName: string;
    recipientCountry: 'HT';
  }): Promise<ScreeningResult>;
}

export class UnavailableSanctionsAmlProvider implements SanctionsAmlProvider {
  async screen(): Promise<ScreeningResult> {
    return {
      status: 'REVIEW',
      provider: 'not_configured',
      performed: false,
      reasons: ['SANCTIONS_AML_SCREENING_NOT_CONFIGURED'],
    };
  }
}

const optionalPositiveMoney = z.preprocess(
  (value) => value === undefined || value === '' ? undefined : Number(value),
  z.number().positive().finite().optional(),
);
const optionalPositiveInteger = z.preprocess(
  (value) => value === undefined || value === '' ? undefined : Number(value),
  z.number().int().positive().optional(),
);

const securityEnvironmentSchema = z.object({
  LOGIN_MAX_FAILURES: z.coerce.number().int().min(2).max(50).default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  TRANSFER_LIMITS_ENABLED: z.enum(['true', 'false']).default('false'),
  TRANSFER_LIMIT_PER_TRANSACTION_USD: optionalPositiveMoney,
  TRANSFER_LIMIT_DAILY_USD: optionalPositiveMoney,
  TRANSFER_LIMIT_WEEKLY_USD: optionalPositiveMoney,
  TRANSFER_LIMIT_MONTHLY_USD: optionalPositiveMoney,
  RISK_REVIEW_AMOUNT_USD: optionalPositiveMoney,
  RISK_MAX_TRANSFERS_24H: optionalPositiveInteger,
  RISK_MAX_DISTINCT_RECIPIENTS_24H: optionalPositiveInteger,
  RISK_MAX_FAILED_FUNDING_24H: optionalPositiveInteger,
  RISK_RECIPIENT_CHANGE_WINDOW_MINUTES: optionalPositiveInteger,
  DATA_RETENTION_DAYS: optionalPositiveInteger,
  SANDBOX_COMPLIANCE_AUTO_CLEAR: z.enum(['true', 'false']).default('false'),
  APPROVED_FOR_LIVE_USE: z.enum(['true', 'false']).default('false'),
  LIVE_MONEY_ENABLED: z.enum(['true', 'false']).default('false'),
});

export interface SecurityConfig {
  loginMaxFailures: number;
  loginLockMinutes: number;
  transferLimitsEnabled: boolean;
  limits: {
    perTransaction?: number;
    daily?: number;
    weekly?: number;
    monthly?: number;
  };
  risk: {
    reviewAmount?: number;
    maxTransfers24h?: number;
    maxDistinctRecipients24h?: number;
    maxFailedFunding24h?: number;
    recipientChangeWindowMinutes?: number;
  };
  dataRetentionDays?: number;
  sandboxComplianceAutoClear: boolean;
  approvedForLiveUse: boolean;
  liveMoneyEnabled: boolean;
}

export function loadSecurityConfig(environment: NodeJS.ProcessEnv = process.env): SecurityConfig {
  const value = securityEnvironmentSchema.parse(environment);
  const limits = {
    perTransaction: value.TRANSFER_LIMIT_PER_TRANSACTION_USD,
    daily: value.TRANSFER_LIMIT_DAILY_USD,
    weekly: value.TRANSFER_LIMIT_WEEKLY_USD,
    monthly: value.TRANSFER_LIMIT_MONTHLY_USD,
  };
  if (value.TRANSFER_LIMITS_ENABLED === 'true' && Object.values(limits).some((limit) => limit === undefined)) {
    throw new Error('All transfer limit values are required when TRANSFER_LIMITS_ENABLED=true');
  }
  if (value.LIVE_MONEY_ENABLED === 'true' || value.APPROVED_FOR_LIVE_USE === 'true') {
    throw new Error('Live money movement is not supported by this Sandbox build');
  }
  return {
    loginMaxFailures: value.LOGIN_MAX_FAILURES,
    loginLockMinutes: value.LOGIN_LOCK_MINUTES,
    transferLimitsEnabled: value.TRANSFER_LIMITS_ENABLED === 'true',
    limits,
    risk: {
      reviewAmount: value.RISK_REVIEW_AMOUNT_USD,
      maxTransfers24h: value.RISK_MAX_TRANSFERS_24H,
      maxDistinctRecipients24h: value.RISK_MAX_DISTINCT_RECIPIENTS_24H,
      maxFailedFunding24h: value.RISK_MAX_FAILED_FUNDING_24H,
      recipientChangeWindowMinutes: value.RISK_RECIPIENT_CHANGE_WINDOW_MINUTES,
    },
    dataRetentionDays: value.DATA_RETENTION_DAYS,
    sandboxComplianceAutoClear: value.SANDBOX_COMPLIANCE_AUTO_CLEAR === 'true',
    approvedForLiveUse: false,
    liveMoneyEnabled: false,
  };
}

export class SecurityError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}

export function securityIdentityHash(email: string, ip: string | undefined, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${email.trim().toLowerCase()}|${ip ?? 'unknown'}`)
    .digest('hex');
}

export interface LoginAttemptState {
  failedCount: number;
  lockedUntil?: number;
}

export class MemoryLoginProtector {
  private readonly states = new Map<string, LoginAttemptState>();

  constructor(private readonly config: SecurityConfig, private readonly now: () => number = Date.now) {}

  assertAllowed(identityHash: string): void {
    const state = this.states.get(identityHash);
    if (state?.lockedUntil && state.lockedUntil > this.now()) {
      throw new SecurityError('ACCOUNT_TEMPORARILY_LOCKED', 'Too many failed sign-in attempts. Try again later.', 429);
    }
  }

  recordFailure(identityHash: string): LoginAttemptState {
    const current = this.states.get(identityHash);
    const failedCount = (current?.lockedUntil && current.lockedUntil <= this.now() ? 0 : current?.failedCount ?? 0) + 1;
    const state: LoginAttemptState = {
      failedCount,
      lockedUntil: failedCount >= this.config.loginMaxFailures
        ? this.now() + this.config.loginLockMinutes * 60_000
        : undefined,
    };
    this.states.set(identityHash, state);
    return state;
  }

  clear(identityHash: string): void {
    this.states.delete(identityHash);
  }

  reset(): void {
    this.states.clear();
  }
}

export interface HistoricalTransfer {
  amountUsd: number;
  recipientId: string;
  createdAt: Date;
  status: string;
}

export interface RiskContext {
  amountUsd: number;
  recipientId: string;
  historicalTransfers: HistoricalTransfer[];
  failedFundingAttempts24h: number;
  recipientSharedAcrossAccounts?: boolean;
  now?: Date;
}

export function enforceTransactionLimits(config: SecurityConfig, context: RiskContext): void {
  if (!config.transferLimitsEnabled) return;
  const now = context.now ?? new Date();
  const included = context.historicalTransfers.filter((transfer) => !['FAILED', 'REVERSED'].includes(transfer.status));
  const sumSince = (milliseconds: number) => included
    .filter((transfer) => transfer.createdAt.getTime() >= now.getTime() - milliseconds)
    .reduce((total, transfer) => total + transfer.amountUsd, 0) + context.amountUsd;
  const checks: Array<[number | undefined, number, string]> = [
    [config.limits.perTransaction, context.amountUsd, 'PER_TRANSACTION_LIMIT_EXCEEDED'],
    [config.limits.daily, sumSince(24 * 60 * 60_000), 'DAILY_LIMIT_EXCEEDED'],
    [config.limits.weekly, sumSince(7 * 24 * 60 * 60_000), 'WEEKLY_LIMIT_EXCEEDED'],
    [config.limits.monthly, sumSince(30 * 24 * 60 * 60_000), 'MONTHLY_LIMIT_EXCEEDED'],
  ];
  const failed = checks.find(([limit, total]) => limit !== undefined && total > limit + 0.0001);
  if (failed) throw new SecurityError(failed[2], 'This transfer exceeds an account transaction limit', 409);
}

export function assessRisk(config: SecurityConfig, context: RiskContext): string[] {
  const now = context.now ?? new Date();
  const last24h = context.historicalTransfers.filter(
    (transfer) => transfer.createdAt.getTime() >= now.getTime() - 24 * 60 * 60_000,
  );
  const flags: string[] = [];
  if (config.risk.reviewAmount !== undefined && context.amountUsd >= config.risk.reviewAmount) {
    flags.push('UNUSUAL_AMOUNT_REVIEW');
  }
  if (config.risk.maxTransfers24h !== undefined && last24h.length + 1 > config.risk.maxTransfers24h) {
    flags.push('TRANSACTION_VELOCITY_REVIEW');
  }
  if (config.risk.maxDistinctRecipients24h !== undefined &&
      new Set([...last24h.map((transfer) => transfer.recipientId), context.recipientId]).size > config.risk.maxDistinctRecipients24h) {
    flags.push('RECIPIENT_VELOCITY_REVIEW');
  }
  if (config.risk.maxFailedFunding24h !== undefined &&
      context.failedFundingAttempts24h >= config.risk.maxFailedFunding24h) {
    flags.push('REPEATED_FUNDING_FAILURES_REVIEW');
  }
  if (context.recipientSharedAcrossAccounts) flags.push('RECIPIENT_SHARED_ACROSS_ACCOUNTS_REVIEW');
  if (config.risk.recipientChangeWindowMinutes !== undefined) {
    const cutoff = now.getTime() - config.risk.recipientChangeWindowMinutes * 60_000;
    const recentRecipients = new Set(context.historicalTransfers
      .filter((transfer) => transfer.createdAt.getTime() >= cutoff)
      .map((transfer) => transfer.recipientId));
    if (recentRecipients.size > 0 && !recentRecipients.has(context.recipientId)) {
      flags.push('RAPID_RECIPIENT_CHANGE_REVIEW');
    }
  }
  return [...new Set(flags)];
}

export function redactAuditMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  const blocked = /password|secret|token|authorization|account(number)?|routing(number)?|ssn|document|selfie|api.?key/i;
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [
    key,
    blocked.test(key) ? '[REDACTED]' : typeof value === 'string' && value.length > 500 ? `${value.slice(0, 500)}…` : value,
  ]));
}

export class KeyedMutex {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const prior = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    const queued = prior.then(() => current);
    this.tails.set(key, queued);
    await prior;
    try {
      return await operation();
    } finally {
      release();
      if (this.tails.get(key) === queued) this.tails.delete(key);
    }
  }
}
