import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import { z, ZodError } from 'zod';
import type { PublicUser, Recipient, Transfer } from '@ticash/shared';
import type { Prisma } from '@prisma/client';
import { databaseEnabled, prisma } from './database.js';
import { loadPayoutConfig, payoutAdapterFor, publicPayoutMethods, PayoutError, type PayoutConfig } from './payout-adapters.js';
import { loadFundingConfig } from './funding/config.js';
import { DwollaRestFundingProvider } from './funding/dwolla-provider.js';
import {
  MemoryFundingRepository,
  PrismaFundingRepository,
  resetFundingStore,
  type FundingRepository,
  type FundingTransactionRecord,
} from './funding/repository.js';
import { createDwollaWebhookHandler, createFundingRouter } from './funding/router.js';
import { FundingService } from './funding/service.js';
import { FundingError, type DwollaFundingProvider, type FundingConfig } from './funding/types.js';
import { loadFxConfig } from './fx/config.js';
import { MockTestFxProvider } from './fx/mock-provider.js';
import {
  MemoryFxQuoteRepository,
  PrismaFxQuoteRepository,
  resetFxQuoteStore,
  type FxQuoteRepository,
} from './fx/repository.js';
import { FxService, supportedCorridors, type QuoteRequest } from './fx/service.js';
import { FxError, type FxConfig, type FxProvider } from './fx/types.js';
import { loadDiditConfig } from './kyc/config.js';
import { DiditRestProvider } from './kyc/didit-provider.js';
import {
  MemoryKycRepository,
  PrismaKycRepository,
  resetKycStore,
  type KycRepository,
} from './kyc/repository.js';
import { createDiditWebhookHandler, createKycRouter } from './kyc/router.js';
import { KycService } from './kyc/service.js';
import { KycError, type DiditConfig, type DiditProvider, type KycStatus } from './kyc/types.js';
import { loadMobileTopUpConfig } from './topup/config.js';
import { ReloadlySandboxTopUpProvider } from './topup/reloadly-provider.js';
import {
  MemoryMobileTopUpRepository,
  PrismaMobileTopUpRepository,
  resetMobileTopUpStore,
  type MobileTopUpRepository,
} from './topup/repository.js';
import { createMobileTopUpRouter } from './topup/router.js';
import { MobileTopUpService } from './topup/service.js';
import {
  MockMobileTopUpPaymentProvider,
  MobileTopUpError,
  type MobileTopUpConfig,
  type MobileTopUpPaymentProvider,
  type MobileTopUpProvider,
} from './topup/types.js';
import {
  assessRisk,
  enforceTransactionLimits,
  KeyedMutex,
  loadSecurityConfig,
  MemoryLoginProtector,
  redactAuditMetadata,
  securityIdentityHash,
  SecurityError,
  UnavailableSanctionsAmlProvider,
  type ComplianceStatus,
  type SanctionsAmlProvider,
  type SecurityConfig,
} from './security.js';
import { runPrismaReconciliation } from './reconciliation.js';
import { requirePermission, type AdminPermission, type AdminRequest } from './admin-access.js';
import {
  assertSafePayoutTransition,
  AdminOperationError,
  feeLimitConfigurationSchema,
  maskEmail,
  maskPhone,
  payoutConfigurationUpdateSchema,
  payoutMethods,
  transferTimeline,
  type PublicPayoutConfiguration,
} from './admin-operations.js';

type StoredUser = PublicUser & {
  passwordHash: string;
  accountLocked: boolean;
  fundingRestricted: boolean;
  payoutRestricted: boolean;
  restrictionReason?: string;
};
type AuthRequest = AdminRequest;
type RefreshSession = { userId: string; tokenHash: string; expiresAt: number };
type AuditRecord = {
  id: string; userId?: string; action: string; entity: string;
  entityId?: string; metadata?: Record<string, unknown>; createdAt: string;
};
type MemoryCompliance = { status: ComplianceStatus; reasons: string[]; reviewedAt?: string };

function normalizedKycStatus(status: string): PublicUser['kycStatus'] {
  if (status === 'REJECTED') return 'DECLINED';
  if (status === 'REVIEW_REQUIRED') return 'IN_REVIEW';
  return status as PublicUser['kycStatus'];
}

const users = new Map<string, StoredUser>();
const recipients = new Map<string, Recipient & { userId: string }>();
const transfers = new Map<string, Transfer & { userId: string }>();
const refreshSessions = new Map<string, RefreshSession>();
const idempotentTransfers = new Map<
  string,
  { requestFingerprint: string; transfer: Transfer }
>();
const auditRecords: AuditRecord[] = [];
const memoryCompliance = new Map<string, MemoryCompliance>();
const memoryPayoutConfigurations = new Map<string, PublicPayoutConfiguration>();
const memoryAdminConfigurations: Array<{
  id: string; version: number; values: Record<string, unknown>; reason: string;
  effectiveAt: string; retiredAt?: string; createdByUserId?: string;
}> = [];

const defaultAccessSecret = 'development-access-secret-change-before-production';
const accessSecret = process.env.JWT_ACCESS_SECRET ?? defaultAccessSecret;
const paymentsMode = process.env.PAYMENTS_MODE ?? 'mock';
const payoutsMode = process.env.PAYOUTS_MODE ?? 'mock';
const productionWebOrigins = ['https://ticash-app.com', 'https://www.ticash-app.com'] as const;
const adminEmail = process.env.ADMIN_EMAIL ?? 'admin@ticash.local';
const adminPassword = process.env.ADMIN_PASSWORD ?? 'AdminPass123!';
const demoEmail = process.env.DEMO_EMAIL ?? 'demo@ticash.local';
const demoPassword = process.env.DEMO_PASSWORD ?? 'DemoPass123!';
const isProduction = process.env.NODE_ENV === 'production';
if (isProduction &&
    (accessSecret === defaultAccessSecret || accessSecret.length < 32 || accessSecret.includes('replace'))) {
  throw new Error('A strong JWT_ACCESS_SECRET is required in production');
}
if (isProduction && (!process.env.ADMIN_PASSWORD || adminPassword === 'AdminPass123!')) {
  throw new Error('A strong ADMIN_PASSWORD is required in production');
}
if (paymentsMode !== 'mock' || payoutsMode !== 'mock') {
  throw new Error('This API supports mock payment and payout modes only');
}

function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function configuredCorsOrigins(env: NodeJS.ProcessEnv): string[] {
  const configured = [
    ...parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS),
    ...parseAllowedOrigins(env.CORS_ORIGIN),
  ];
  if (env.NODE_ENV === 'production') configured.push(...productionWebOrigins);
  return [...new Set(configured)];
}

const refreshLifetimeMs = 30 * 24 * 60 * 60 * 1000;
const credentialsSchema = z.object({
  email: z.email().transform((value) => value.toLowerCase()),
  password: z.string().min(8).max(128),
});
const internationalAddressShape = {
  countryCode: z.string().trim().length(2).transform((value) => value.toUpperCase()),
  addressLine1: z.string().trim().min(3).max(180),
  addressLine2: z.string().trim().max(180).nullable().optional(),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100).nullable().optional(),
  postalCode: z.string().trim().max(24).nullable().optional(),
};
const registerSchema = credentialsSchema.extend({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  countryCode: internationalAddressShape.countryCode.optional(),
  addressLine1: internationalAddressShape.addressLine1.optional(),
  addressLine2: internationalAddressShape.addressLine2,
  city: internationalAddressShape.city.optional(),
  region: internationalAddressShape.region,
  postalCode: internationalAddressShape.postalCode,
});
const changePasswordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(8).max(128),
}).refine((value) => value.currentPassword !== value.newPassword, {
  message: 'New password must be different from the current password',
  path: ['newPassword'],
});
const profileSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  phoneNumber: z.string().trim().regex(/^\+[1-9]\d{7,14}$/).nullable().optional(),
  countryCode: internationalAddressShape.countryCode.nullable().optional(),
  addressLine1: internationalAddressShape.addressLine1.nullable().optional(),
  addressLine2: internationalAddressShape.addressLine2,
  city: internationalAddressShape.city.nullable().optional(),
  region: internationalAddressShape.region,
  postalCode: internationalAddressShape.postalCode,
});
const kycDecisionSchema = z.object({
  status: z.enum(['APPROVED', 'DECLINED', 'IN_REVIEW', 'EXPIRED']),
});
const transferStatusSchema = z.object({
  status: z.enum(['COMPLETED', 'FAILED']),
});
const accountRestrictionSchema = z.object({
  accountLocked: z.boolean(),
  fundingRestricted: z.boolean(),
  payoutRestricted: z.boolean(),
  reason: z.string().trim().min(3).max(500),
}).strict();
const complianceDecisionSchema = z.object({
  status: z.enum(['CLEAR', 'REVIEW', 'BLOCKED']),
  reason: z.string().trim().min(3).max(500),
}).strict();
const adminListQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.string().trim().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).strict();
const reversalSchema = z.object({
  reasonCode: z.enum(['CUSTOMER_REQUEST', 'PROVIDER_REVERSAL', 'DUPLICATE', 'OPERATIONS_CORRECTION']),
  note: z.string().trim().min(5).max(500),
}).strict();
const staffRoleSchema = z.object({
  role: z.enum(['SUPER_ADMIN', 'COMPLIANCE', 'OPERATIONS', 'SUPPORT', 'READ_ONLY']),
  reason: z.string().trim().min(5).max(500),
}).strict();
const recipientSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  middleName: z.string().trim().max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  fullName: z.string().trim().min(3).max(240).optional(),
  country: z.literal('HT'),
  phoneNumber: z.string().regex(/^\+509\d{8}$/),
  address: z.string().trim().min(3).max(180),
  city: z.string().trim().min(2).max(100),
  department: z.string().trim().min(2).max(100),
  payoutMethod: z.enum(['MONCASH', 'NATCASH']),
}).strict().superRefine((value, context) => {
  if (value.firstName && value.lastName) return;
  const legacyParts = value.fullName?.split(/\s+/).filter(Boolean) ?? [];
  if (legacyParts.length < 2) {
    context.addIssue({
      code: 'custom',
      path: ['lastName'],
      message: 'Recipient first name and last name are required',
    });
  }
}).transform((value) => {
  const legacyParts = value.fullName?.split(/\s+/).filter(Boolean) ?? [];
  const firstName = value.firstName ?? legacyParts[0] ?? '';
  const lastName = value.lastName ?? legacyParts.at(-1) ?? '';
  const middleName = value.middleName?.trim() ||
    (value.firstName ? undefined : legacyParts.slice(1, -1).join(' ') || undefined);
  const fullName = [firstName, middleName, lastName].filter(Boolean).join(' ');
  return { ...value, firstName, middleName, lastName, fullName };
});
const transferDetailsSchema = z.object({
  recipient: recipientSchema,
  amount: z.number().positive().max(1_000_000),
  amountCurrency: z.enum(['USD', 'CAD', 'EUR', 'MXN', 'BRL', 'CLP', 'DOP', 'HTG']).default('USD'),
  sendCountry: z.string().trim().length(2).transform((value) => value.toUpperCase()).default('US'),
  sourceCurrency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
  targetCurrency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
}).strict();
const quoteInputSchema = transferDetailsSchema;
const transferInputSchema = transferDetailsSchema.extend({
  quoteId: z.uuid(),
}).strict();
const transferFundingSchema = z.object({ fundingSourceId: z.uuid() }).strict();

function publicUser(user: StoredUser): PublicUser {
  return {
    id: user.id, email: user.email, firstName: user.firstName,
    lastName: user.lastName, phoneNumber: user.phoneNumber,
    countryCode: user.countryCode, addressLine1: user.addressLine1,
    addressLine2: user.addressLine2, city: user.city,
    region: user.region, postalCode: user.postalCode,
    kycStatus: user.kycStatus, role: user.role, createdAt: user.createdAt,
  };
}

function storedUserFromDb(user: {
  id: string; email: string; phone: string | null; passwordHash: string;
  firstName: string | null; lastName: string | null; kycStatus: string;
  countryCode: string | null; addressLine1: string | null; addressLine2: string | null;
  city: string | null; region: string | null; postalCode: string | null;
  role: string; createdAt: Date; accountLocked: boolean; fundingRestricted: boolean;
  payoutRestricted: boolean; restrictionReason: string | null;
}): StoredUser {
  return {
    id: user.id,
    email: user.email,
    phoneNumber: user.phone ?? undefined,
    passwordHash: user.passwordHash,
    firstName: user.firstName ?? '',
    lastName: user.lastName ?? '',
    countryCode: user.countryCode ?? undefined,
    addressLine1: user.addressLine1 ?? undefined,
    addressLine2: user.addressLine2 ?? undefined,
    city: user.city ?? undefined,
    region: user.region ?? undefined,
    postalCode: user.postalCode ?? undefined,
    kycStatus: normalizedKycStatus(user.kycStatus),
    role: user.role as PublicUser['role'],
    createdAt: user.createdAt.toISOString(),
    accountLocked: user.accountLocked,
    fundingRestricted: user.fundingRestricted,
    payoutRestricted: user.payoutRestricted,
    restrictionReason: user.restrictionReason ?? undefined,
  };
}

function recipientFromDb(recipient: {
  id: string; name: string; firstName: string | null; middleName: string | null;
  lastName: string | null; phone: string; address: string; city: string;
  department: string; provider: string;
}): Recipient {
  const legacyParts = recipient.name.split(/\s+/).filter(Boolean);
  const firstName = recipient.firstName ?? legacyParts[0] ?? '';
  const lastName = recipient.lastName ?? legacyParts.at(-1) ?? '';
  const middleName = recipient.middleName ??
    (legacyParts.slice(1, -1).join(' ') || undefined);
  return {
    id: recipient.id,
    firstName,
    middleName,
    lastName,
    fullName: [firstName, middleName, lastName].filter(Boolean).join(' '),
    country: 'HT',
    phoneNumber: recipient.phone,
    address: recipient.address,
    city: recipient.city,
    department: recipient.department,
    payoutMethod: recipient.provider as Recipient['payoutMethod'],
  };
}

function transferFromDb(transfer: {
  id: string; recipientId: string; provider: string; amountUsd: unknown;
  feeUsd: unknown; exchangeRate: unknown; amountHtg: unknown; status: string;
  providerTransactionId: string | null; failureCode: string | null; createdAt: Date; completedAt: Date | null;
  referenceNumber: string | null; stage: string; complianceStatus: string; testMode: boolean;
  ticashFeeUsd: unknown | null; providerFeeUsd: unknown | null; totalChargeUsd: unknown | null;
  recipient: { phone: string; name: string };
  fundingTransaction?: { id: string } | null;
  quote?: {
    sourceCurrency: string; targetCurrency: string; sendAmount: unknown;
    ticashFee: unknown; providerFee: unknown; totalCustomerCharge: unknown;
    recipientAmount: unknown;
  } | null;
  recipientNameSnapshot?: string | null; recipientPhoneSnapshot?: string | null;
  configurationVersionId?: string | null;
}): Transfer {
  const combinedFee = transfer.quote
    ? Number(transfer.quote.ticashFee) + Number(transfer.quote.providerFee)
    : Number(transfer.feeUsd);
  const ticashFee = transfer.quote
    ? Number(transfer.quote.ticashFee)
    : transfer.ticashFeeUsd == null ? combinedFee : Number(transfer.ticashFeeUsd);
  const providerFundingFee = transfer.quote
    ? Number(transfer.quote.providerFee)
    : transfer.providerFeeUsd == null ? 0 : Number(transfer.providerFeeUsd);
  return {
    id: transfer.id,
    referenceNumber: transfer.referenceNumber ?? `TC-${transfer.id.replaceAll('-', '').slice(0, 12).toUpperCase()}`,
    recipientId: transfer.recipientId,
    recipientName: transfer.recipientNameSnapshot ?? transfer.recipient.name,
    recipientPhone: transfer.recipientPhoneSnapshot ?? transfer.recipient.phone,
    payoutMethod: transfer.provider as Transfer['payoutMethod'],
    amount: transfer.quote ? Number(transfer.quote.sendAmount) : Number(transfer.amountUsd),
    sourceCurrency: (transfer.quote?.sourceCurrency ?? 'USD') as Transfer['sourceCurrency'],
    targetCurrency: (transfer.quote?.targetCurrency ?? 'HTG') as Transfer['targetCurrency'],
    fee: combinedFee,
    ticashFee,
    providerFundingFee,
    totalCharged: transfer.quote
      ? Number(transfer.quote.totalCustomerCharge)
      : transfer.totalChargeUsd == null ? Number(transfer.amountUsd) + combinedFee : Number(transfer.totalChargeUsd),
    exchangeRate: Number(transfer.exchangeRate),
    amountReceived: transfer.quote ? Number(transfer.quote.recipientAmount) : Number(transfer.amountHtg),
    status: transfer.status as Transfer['status'],
    stage: transfer.stage as Transfer['stage'],
    complianceStatus: transfer.complianceStatus as Transfer['complianceStatus'],
    testMode: transfer.testMode,
    fundingTransactionId: transfer.fundingTransaction?.id,
    providerTransactionId: transfer.providerTransactionId ?? undefined,
    failureCode: transfer.failureCode ?? undefined,
    configurationVersionId: transfer.configurationVersionId ?? undefined,
    createdAt: transfer.createdAt.toISOString(),
    completedAt: transfer.completedAt?.toISOString(),
  };
}

function publicRecipient(recipient: Recipient & { userId: string }): Recipient {
  return {
    id: recipient.id, firstName: recipient.firstName,
    middleName: recipient.middleName, lastName: recipient.lastName,
    fullName: recipient.fullName, country: recipient.country,
    phoneNumber: recipient.phoneNumber, address: recipient.address,
    city: recipient.city, department: recipient.department,
    payoutMethod: recipient.payoutMethod,
  };
}

function publicTransfer(transfer: Transfer & { userId: string }): Transfer {
  const { userId, ...safe } = transfer;
  void userId;
  return safe;
}

function adminTransfer(transfer: Transfer): Transfer {
  return { ...transfer, recipientPhone: maskPhone(transfer.recipientPhone) ?? '••••' };
}

function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

async function recordAudit(
  userId: string | undefined,
  action: string,
  entity: string,
  entityId?: string,
  metadata?: Record<string, unknown>,
) {
  const safeMetadata = redactAuditMetadata(metadata);
  if (databaseEnabled) {
    await prisma.auditLog.create({ data: { userId, action, entity, entityId, metadata: safeMetadata as Prisma.InputJsonValue | undefined } });
    return;
  }
  auditRecords.unshift({
    id: randomUUID(), userId, action, entity, entityId,
    metadata: safeMetadata,
    createdAt: new Date().toISOString(),
  });
}

async function issueTokens(userId: string) {
  const accessToken = jwt.sign({ sub: userId, type: 'access', jti: randomUUID() }, accessSecret, {
    expiresIn: 15 * 60,
    issuer: 'ticash-api',
    audience: 'ticash-mobile',
  });
  const refreshToken = randomUUID();
  const hash = tokenHash(refreshToken);
  const expiresAt = Date.now() + refreshLifetimeMs;
  if (databaseEnabled) {
    await prisma.session.create({
      data: { userId, refreshHash: hash, expiresAt: new Date(expiresAt) },
    });
  } else {
    refreshSessions.set(hash, { userId, tokenHash: hash, expiresAt });
  }
  return { accessToken, refreshToken };
}

async function authenticate(req: AuthRequest, res: Response, next: NextFunction) {
  const [scheme, token] = req.header('authorization')?.split(' ') ?? [];
  if (scheme !== 'Bearer' || !token) {
    res.status(401).json({ error: 'Authentication required', code: 'UNAUTHENTICATED' });
    return;
  }
  try {
    const payload = jwt.verify(token, accessSecret, {
      issuer: 'ticash-api',
      audience: 'ticash-mobile',
    });
    if (typeof payload === 'string' || payload.type !== 'access' || !payload.sub) {
      throw new Error('Invalid token');
    }
    req.userId = payload.sub;
    const accountLocked = databaseEnabled
      ? (await prisma.user.findUnique({ where: { id: payload.sub }, select: { accountLocked: true } }))?.accountLocked
      : users.get(payload.sub)?.accountLocked;
    if (accountLocked === undefined) {
      res.status(401).json({ error: 'Account is unavailable', code: 'INVALID_TOKEN' });
      return;
    }
    if (accountLocked) {
      res.status(423).json({ error: 'Account access is locked', code: 'ACCOUNT_LOCKED' });
      return;
    }
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired access token', code: 'INVALID_TOKEN' });
  }
}

async function requireApprovedKyc(req: AuthRequest, res: Response, next: NextFunction) {
  const status = databaseEnabled
    ? (await prisma.user.findUnique({ where: { id: req.userId! }, select: { kycStatus: true } }))?.kycStatus
    : users.get(req.userId!)?.kycStatus;
  if (status !== 'APPROVED') {
    res.status(403).json({
      error: 'Identity verification must be approved before sending money',
      code: 'KYC_REQUIRED',
    });
    return;
  }
  next();
}

async function requireFundingAllowed(req: AuthRequest, res: Response, next: NextFunction) {
  const state = databaseEnabled
    ? await prisma.user.findUnique({ where: { id: req.userId! }, select: { fundingRestricted: true } })
    : users.get(req.userId!);
  if (!state) {
    res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    return;
  }
  if (state.fundingRestricted) {
    res.status(403).json({ error: 'Funding is restricted for this account', code: 'FUNDING_RESTRICTED' });
    return;
  }
  next();
}

function quoteRequest(input: z.infer<typeof quoteInputSchema>): QuoteRequest {
  return {
    sendCountry: input.sendCountry,
    receiveCountry: input.recipient.country,
    sourceCurrency: input.sourceCurrency,
    targetCurrency: input.targetCurrency,
    payoutMethod: input.recipient.payoutMethod,
    sendAmount: input.amount,
    amountCurrency: input.amountCurrency,
  };
}

export function resetStore() {
  users.clear();
  recipients.clear();
  transfers.clear();
  refreshSessions.clear();
  idempotentTransfers.clear();
  auditRecords.length = 0;
  memoryCompliance.clear();
  memoryPayoutConfigurations.clear();
  memoryAdminConfigurations.length = 0;
  resetFundingStore();
  resetKycStore();
  resetFxQuoteStore();
  resetMobileTopUpStore();
}

export interface CreateAppOptions {
  fundingConfig?: FundingConfig;
  fundingProvider?: DwollaFundingProvider;
  fundingRepository?: FundingRepository;
  diditConfig?: DiditConfig;
  diditProvider?: DiditProvider;
  kycRepository?: KycRepository;
  fxConfig?: FxConfig;
  fxProvider?: FxProvider;
  fxRepository?: FxQuoteRepository;
  fxClock?: () => Date;
  payoutConfig?: PayoutConfig;
  securityConfig?: SecurityConfig;
  sanctionsAmlProvider?: SanctionsAmlProvider;
  mobileTopUpConfig?: MobileTopUpConfig;
  mobileTopUpProvider?: MobileTopUpProvider;
  mobileTopUpPaymentProvider?: MobileTopUpPaymentProvider;
  mobileTopUpRepository?: MobileTopUpRepository;
  mobileTopUpClock?: () => Date;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  const allowlistedOrigins = configuredCorsOrigins(process.env);
  const securityConfig = options.securityConfig ?? loadSecurityConfig();
  const sanctionsAmlProvider = options.sanctionsAmlProvider ?? new UnavailableSanctionsAmlProvider();
  const loginProtector = new MemoryLoginProtector(securityConfig);
  const transferMutex = new KeyedMutex();
  const resolveRole = async (userId: string) => databaseEnabled
    ? (await prisma.user.findUnique({ where: { id: userId }, select: { role: true } }))?.role
    : users.get(userId)?.role;
  const permission = (value: AdminPermission) => requirePermission(value, resolveRole);
  const loginState = {
    async assertAllowed(identityHash: string) {
      if (!databaseEnabled) return loginProtector.assertAllowed(identityHash);
      const state = await prisma.loginSecurityState.findUnique({ where: { identityHash } });
      if (state?.lockedUntil && state.lockedUntil > new Date()) {
        throw new SecurityError('ACCOUNT_TEMPORARILY_LOCKED', 'Too many failed sign-in attempts. Try again later.', 429);
      }
    },
    async failure(identityHash: string) {
      if (!databaseEnabled) return loginProtector.recordFailure(identityHash);
      const current = await prisma.loginSecurityState.findUnique({ where: { identityHash } });
      const expiredLock = current?.lockedUntil && current.lockedUntil <= new Date();
      const updated = await prisma.loginSecurityState.upsert({
        where: { identityHash },
        update: expiredLock
          ? { failedCount: 1, lastFailedAt: new Date(), lockedUntil: null }
          : { failedCount: { increment: 1 }, lastFailedAt: new Date() },
        create: { identityHash, failedCount: 1, lastFailedAt: new Date() },
      });
      const failedCount = updated.failedCount;
      const lockedUntil = failedCount >= securityConfig.loginMaxFailures
        ? new Date(Date.now() + securityConfig.loginLockMinutes * 60_000)
        : null;
      if (lockedUntil) await prisma.loginSecurityState.update({ where: { identityHash }, data: { lockedUntil } });
      return { failedCount, lockedUntil: lockedUntil?.getTime() };
    },
    async clear(identityHash: string) {
      if (!databaseEnabled) return loginProtector.clear(identityHash);
      await prisma.loginSecurityState.deleteMany({ where: { identityHash } });
    },
  };
  const activeAdminConfiguration = async () => databaseEnabled
    ? await prisma.adminConfigVersion.findFirst({ where: { type: 'FEES_AND_LIMITS', retiredAt: null }, orderBy: { version: 'desc' } })
    : [...memoryAdminConfigurations].reverse().find((item) => !item.retiredAt);
  const requestSecurityConfig = async (): Promise<SecurityConfig> => {
    const active = await activeAdminConfiguration();
    if (!active || typeof active.values !== 'object' || active.values === null || Array.isArray(active.values)) return securityConfig;
    const values = active.values as Record<string, unknown>;
    return {
      ...securityConfig,
      transferLimitsEnabled: values.limitsEnabled === true,
      limits: {
        perTransaction: typeof values.perTransactionUsd === 'number' ? values.perTransactionUsd : undefined,
        daily: typeof values.dailyUsd === 'number' ? values.dailyUsd : undefined,
        weekly: typeof values.weeklyUsd === 'number' ? values.weeklyUsd : undefined,
        monthly: typeof values.monthlyUsd === 'number' ? values.monthlyUsd : undefined,
      },
    };
  };
  const evaluateRisk = async (userId: string, recipientId: string, recipientPhone: string, amountUsd: number) => {
    const now = new Date();
    const historicalTransfers = databaseEnabled
      ? (await prisma.transfer.findMany({
          where: { senderUserId: userId, createdAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60_000) } },
          select: { amountUsd: true, recipientId: true, createdAt: true, status: true },
        })).map((transfer) => ({
          amountUsd: Number(transfer.amountUsd), recipientId: transfer.recipientId,
          createdAt: transfer.createdAt, status: transfer.status,
        }))
      : [...transfers.values()].filter((transfer) => transfer.userId === userId).map((transfer) => ({
          amountUsd: transfer.amount, recipientId: transfer.recipientId,
          createdAt: new Date(transfer.createdAt), status: transfer.status,
        }));
    const failedFundingAttempts24h = databaseEnabled
      ? await prisma.fundingTransaction.count({
          where: { userId, status: 'FAILED', createdAt: { gte: new Date(now.getTime() - 24 * 60 * 60_000) } },
        })
      : [...transfers.values()].filter((transfer) => transfer.userId === userId &&
          transfer.status === 'FAILED' && transfer.failureCode?.startsWith('FUNDING_') &&
          new Date(transfer.createdAt).getTime() >= now.getTime() - 24 * 60 * 60_000).length;
    const recipientSharedAcrossAccounts = databaseEnabled
      ? await prisma.recipient.count({ where: { phone: recipientPhone, userId: { not: userId } } }) > 0
      : [...recipients.values()].some((recipient) => recipient.phoneNumber === recipientPhone && recipient.userId !== userId);
    const context = { amountUsd, recipientId, historicalTransfers, failedFundingAttempts24h, recipientSharedAcrossAccounts, now };
    const effectiveSecurity = await requestSecurityConfig();
    enforceTransactionLimits(effectiveSecurity, context);
    return assessRisk(effectiveSecurity, context);
  };
  const fundingConfig = options.fundingConfig ?? loadFundingConfig();
  const fundingRepository = options.fundingRepository ?? (
    databaseEnabled ? new PrismaFundingRepository(prisma) : new MemoryFundingRepository()
  );
  const fundingProvider = options.fundingProvider ?? (
    fundingConfig.enabled ? new DwollaRestFundingProvider(fundingConfig) : undefined
  );
  const payoutConfig = options.payoutConfig ?? loadPayoutConfig();
  const assertPayoutOperational = async (method: string) => {
    const configured = databaseEnabled
      ? await prisma.payoutMethodConfig.findUnique({ where: { method: method as never } })
      : memoryPayoutConfigurations.get(method);
    if (configured && !['SANDBOX', 'ACTIVE'].includes(configured.state)) {
      throw new PayoutError('PAYOUT_METHOD_SUSPENDED', `${method} is not available in its current operational state`, 409);
    }
  };
  const syncTransferFromFunding = async (funding: FundingTransactionRecord) => {
    if (!funding.transferId) return;
    const linkedTransferId = funding.transferId;
    return transferMutex.run(`payout:${linkedTransferId}`, async () => {
    if (databaseEnabled) {
      const transfer = await prisma.transfer.findUnique({ where: { id: linkedTransferId }, include: { recipient: true } });
      if (!transfer || transfer.senderUserId !== funding.userId) return;
      if (funding.status === 'COMPLETED') {
        if (transfer.immutableAt || transfer.stage === 'PAYOUT_PROCESSING' || transfer.stage === 'DELIVERED') return;
        const total = Number(transfer.totalChargeUsd ?? transfer.amountUsd.plus(transfer.feeUsd));
        await fundingRepository.reserveWalletForTransfer(funding.userId, transfer.id, total);
        const account = await prisma.user.findUnique({
          where: { id: funding.userId }, select: { payoutRestricted: true, accountLocked: true },
        });
        const screening = await sanctionsAmlProvider.screen({
          userId: funding.userId, transferId: transfer.id, amountUsd: Number(transfer.amountUsd),
          recipientName: transfer.recipient.name, recipientCountry: 'HT',
        });
        const riskFlags = Array.isArray(transfer.riskFlags) ? transfer.riskFlags.filter((value): value is string => typeof value === 'string') : [];
        const reasons = [
          ...(account?.accountLocked ? ['ACCOUNT_LOCKED'] : []),
          ...(account?.payoutRestricted ? ['PAYOUT_RESTRICTED'] : []),
          ...riskFlags,
          ...screening.reasons,
        ];
        const sandboxAutoClear = !isProduction && (securityConfig.sandboxComplianceAutoClear ||
          (process.env.NODE_ENV === 'test' && options.securityConfig === undefined));
        const complianceStatus: ComplianceStatus = account?.accountLocked || account?.payoutRestricted || screening.status === 'BLOCKED'
          ? 'BLOCKED'
          : riskFlags.length || (screening.status !== 'CLEAR' && !sandboxAutoClear) ? 'REVIEW' : 'CLEAR';
        await prisma.complianceDecision.create({ data: {
          transferId: transfer.id, subjectUserId: funding.userId, status: complianceStatus,
          reasons: (sandboxAutoClear && screening.status !== 'CLEAR' ? [...reasons, 'SANDBOX_TEST_AUTO_CLEAR'] : reasons) as Prisma.InputJsonValue,
          screeningProvider: screening.provider, screeningReferenceId: screening.referenceId,
          screeningPerformed: screening.performed,
        } });
        await prisma.transfer.update({ where: { id: transfer.id }, data: {
          complianceStatus, complianceReviewedAt: new Date(),
          stage: complianceStatus === 'CLEAR' ? 'FUNDING_PROCESSING' : 'COMPLIANCE_REVIEW',
        } });
        await recordAudit(funding.userId, `COMPLIANCE_${complianceStatus}`, 'Transfer', transfer.id, {
          reasons, screeningProvider: screening.provider, screeningPerformed: screening.performed,
        });
        if (complianceStatus !== 'CLEAR') return;
        try {
          if (transfer.provider === 'HAITIAN_BANK') throw new PayoutError('PAYOUT_METHOD_UNAVAILABLE', 'Haitian bank payout is not enabled', 409);
          await assertPayoutOperational(transfer.provider);
          const payout = await payoutAdapterFor(transfer.provider, payoutConfig).submit({
            recipientPhone: transfer.recipient.phone, amountHtg: Number(transfer.amountHtg), transferId: transfer.id,
          });
          await prisma.transfer.update({ where: { id: transfer.id }, data: {
            status: 'PROCESSING', stage: 'PAYOUT_PROCESSING', payoutStartedAt: new Date(),
            immutableAt: new Date(),
            providerTransactionId: payout.providerTransactionId, failureCode: null,
          } });
          await recordAudit(funding.userId, 'PAYOUT_REQUESTED', 'Transfer', transfer.id, {
            payoutProvider: transfer.provider, providerTransactionId: payout.providerTransactionId,
          });
        } catch (error) {
          await fundingRepository.releaseWalletForTransfer(funding.userId, transfer.id, total);
          await prisma.transfer.update({ where: { id: transfer.id }, data: { status: 'FAILED', stage: 'FAILED', failureCode: error instanceof PayoutError ? error.code : 'PAYOUT_REQUEST_FAILED' } });
          await recordAudit(funding.userId, 'PAYOUT_REQUEST_FAILED', 'Transfer', transfer.id, {
            failureCode: error instanceof PayoutError ? error.code : 'PAYOUT_REQUEST_FAILED',
          });
        }
      } else if (funding.status === 'FAILED' || funding.status === 'CANCELLED' || funding.status === 'REVERSED') {
        if (funding.status === 'REVERSED') await fundingRepository.releaseWalletForTransfer(funding.userId, transfer.id, Number(transfer.totalChargeUsd ?? transfer.amountUsd.plus(transfer.feeUsd)));
        await prisma.transfer.update({ where: { id: transfer.id }, data: {
          status: funding.status === 'REVERSED' ? 'REVERSED' : 'FAILED',
          stage: funding.status === 'REVERSED' ? 'REVERSED' : funding.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED',
          failureCode: funding.failureCode ?? `FUNDING_${funding.status}`,
        } });
      } else {
        await prisma.transfer.update({ where: { id: transfer.id }, data: { status: 'PROCESSING', stage: 'FUNDING_PROCESSING' } });
      }
      return;
    }
    const transfer = transfers.get(linkedTransferId);
    if (!transfer || transfer.userId !== funding.userId) return;
    if (funding.status === 'COMPLETED') {
      if (transfer.stage === 'PAYOUT_PROCESSING' || transfer.stage === 'DELIVERED') return;
      await fundingRepository.reserveWalletForTransfer(funding.userId, transfer.id, transfer.totalCharged);
      const account = users.get(funding.userId);
      const screening = await sanctionsAmlProvider.screen({
        userId: funding.userId, transferId: transfer.id, amountUsd: transfer.amount,
        recipientName: transfer.recipientName, recipientCountry: 'HT',
      });
      const existingRisk = memoryCompliance.get(transfer.id)?.reasons ?? [];
      const reasons = [
        ...(account?.accountLocked ? ['ACCOUNT_LOCKED'] : []),
        ...(account?.payoutRestricted ? ['PAYOUT_RESTRICTED'] : []),
        ...existingRisk,
        ...screening.reasons,
      ];
      const sandboxAutoClear = !isProduction && (securityConfig.sandboxComplianceAutoClear ||
        (process.env.NODE_ENV === 'test' && options.securityConfig === undefined));
      const complianceStatus: ComplianceStatus = account?.accountLocked || account?.payoutRestricted || screening.status === 'BLOCKED'
        ? 'BLOCKED'
        : existingRisk.length || (screening.status !== 'CLEAR' && !sandboxAutoClear) ? 'REVIEW' : 'CLEAR';
      memoryCompliance.set(transfer.id, { status: complianceStatus, reasons, reviewedAt: new Date().toISOString() });
      await recordAudit(funding.userId, `COMPLIANCE_${complianceStatus}`, 'Transfer', transfer.id, {
        reasons, screeningProvider: screening.provider, screeningPerformed: screening.performed,
      });
      if (complianceStatus !== 'CLEAR') {
        transfers.set(transfer.id, { ...transfer, status: 'PROCESSING', stage: 'COMPLIANCE_REVIEW', complianceStatus, fundingTransactionId: funding.id });
        return;
      }
      try {
        await assertPayoutOperational(transfer.payoutMethod);
        const payout = await payoutAdapterFor(transfer.payoutMethod, payoutConfig).submit({ recipientPhone: transfer.recipientPhone, amountHtg: transfer.amountReceived, transferId: transfer.id });
        transfers.set(transfer.id, { ...transfer, status: 'PROCESSING', stage: 'PAYOUT_PROCESSING', complianceStatus: 'CLEAR', fundingTransactionId: funding.id, providerTransactionId: payout.providerTransactionId, failureCode: undefined });
        await recordAudit(funding.userId, 'PAYOUT_REQUESTED', 'Transfer', transfer.id, {
          payoutProvider: transfer.payoutMethod, providerTransactionId: payout.providerTransactionId,
        });
      } catch (error) {
        await fundingRepository.releaseWalletForTransfer(funding.userId, transfer.id, transfer.totalCharged);
        transfers.set(transfer.id, { ...transfer, status: 'FAILED', stage: 'FAILED', fundingTransactionId: funding.id, failureCode: error instanceof PayoutError ? error.code : 'PAYOUT_REQUEST_FAILED' });
        await recordAudit(funding.userId, 'PAYOUT_REQUEST_FAILED', 'Transfer', transfer.id, {
          failureCode: error instanceof PayoutError ? error.code : 'PAYOUT_REQUEST_FAILED',
        });
      }
    } else if (funding.status === 'FAILED' || funding.status === 'CANCELLED' || funding.status === 'REVERSED') {
      if (funding.status === 'REVERSED') await fundingRepository.releaseWalletForTransfer(funding.userId, transfer.id, transfer.totalCharged);
      transfers.set(transfer.id, { ...transfer, status: funding.status === 'REVERSED' ? 'REVERSED' : 'FAILED', stage: funding.status === 'REVERSED' ? 'REVERSED' : funding.status === 'CANCELLED' ? 'CANCELLED' : 'FAILED', fundingTransactionId: funding.id, failureCode: funding.failureCode ?? `FUNDING_${funding.status}` });
    } else {
      transfers.set(transfer.id, { ...transfer, status: 'PROCESSING', stage: 'FUNDING_PROCESSING', fundingTransactionId: funding.id });
    }
    });
  };
  const fundingService = new FundingService(fundingConfig, fundingRepository, fundingProvider, recordAudit, syncTransferFromFunding);
  const diditConfig = options.diditConfig ?? loadDiditConfig();
  const kycRepository = options.kycRepository ?? (
    databaseEnabled
      ? new PrismaKycRepository(prisma)
      : new MemoryKycRepository(
          (userId) => {
            const user = users.get(userId);
            return user ? {
              userId: user.id,
              email: user.email,
              phone: user.phoneNumber,
              firstName: user.firstName,
              lastName: user.lastName,
              status: user.kycStatus as KycStatus,
            } : undefined;
          },
          (userId, status) => {
            const user = users.get(userId);
            if (user) users.set(userId, { ...user, kycStatus: status });
          },
        )
  );
  const diditProvider = options.diditProvider ?? (
    diditConfig.enabled ? new DiditRestProvider(diditConfig) : undefined
  );
  const kycService = new KycService(diditConfig, kycRepository, diditProvider, recordAudit);
  const fxConfig = options.fxConfig ?? loadFxConfig();
  const fxRepository = options.fxRepository ?? (
    databaseEnabled ? new PrismaFxQuoteRepository(prisma) : new MemoryFxQuoteRepository()
  );
  const fxProvider = options.fxProvider ?? (
    fxConfig.mode === 'mock' && (fxConfig.mockHtgRates || fxConfig.mockUsdHtgRate)
      ? new MockTestFxProvider(fxConfig.mockHtgRates ?? fxConfig.mockUsdHtgRate!)
      : undefined
  );
  const fxService = new FxService(fxConfig, fxRepository, fxProvider, options.fxClock);
  const mobileTopUpConfig = options.mobileTopUpConfig ?? loadMobileTopUpConfig();
  const mobileTopUpRepository = options.mobileTopUpRepository ?? (
    databaseEnabled ? new PrismaMobileTopUpRepository(prisma) : new MemoryMobileTopUpRepository()
  );
  const mobileTopUpProvider = options.mobileTopUpProvider ?? new ReloadlySandboxTopUpProvider(mobileTopUpConfig);
  const mobileTopUpPaymentProvider = options.mobileTopUpPaymentProvider ?? new MockMobileTopUpPaymentProvider();
  const mobileTopUpService = new MobileTopUpService(
    mobileTopUpConfig,
    mobileTopUpProvider,
    mobileTopUpPaymentProvider,
    mobileTopUpRepository,
    recordAudit,
    options.mobileTopUpClock,
  );
  const effectiveQuotePricing = async () => {
    let active = await activeAdminConfiguration();
    if (!active) {
      const values = {
        ticashFeePercent: Number(fxConfig.ticashFeePercent), ticashMinimumFeeUsd: Number(fxConfig.ticashMinimumFeeUsd),
        providerFundingFeeUsd: Number(fxConfig.providerFundingFeeUsd), limitsEnabled: securityConfig.transferLimitsEnabled,
        perTransactionUsd: securityConfig.limits.perTransaction ?? null, dailyUsd: securityConfig.limits.daily ?? null,
        weeklyUsd: securityConfig.limits.weekly ?? null, monthlyUsd: securityConfig.limits.monthly ?? null,
      };
      if (databaseEnabled) {
        active = await prisma.adminConfigVersion.upsert({
          where: { type_version: { type: 'FEES_AND_LIMITS', version: 1 } }, update: {},
          create: { type: 'FEES_AND_LIMITS', version: 1, values, reason: 'Initial environment-backed configuration' },
        });
      } else {
        const baseline = { id: randomUUID(), version: 1, values, reason: 'Initial environment-backed configuration', effectiveAt: new Date().toISOString() };
        memoryAdminConfigurations.push(baseline);
        active = baseline;
      }
    }
    const values = active.values as Record<string, unknown>;
    return {
      configurationVersionId: active.id,
      ticashFeePercent: String(values.ticashFeePercent ?? fxConfig.ticashFeePercent),
      ticashMinimumFeeUsd: String(values.ticashMinimumFeeUsd ?? fxConfig.ticashMinimumFeeUsd),
      providerFundingFeeUsd: String(values.providerFundingFeeUsd ?? fxConfig.providerFundingFeeUsd),
    };
  };
  app.disable('x-powered-by');
  app.use(helmet());
  app.post(
    '/api/webhooks/dwolla',
    express.raw({ type: 'application/json', limit: '256kb' }),
    createDwollaWebhookHandler(fundingService),
  );
  app.post(
    '/api/webhooks/didit',
    express.raw({ type: 'application/json', limit: '256kb' }),
    createDiditWebhookHandler(kycService),
  );
  app.use(cors({
    origin(origin, callback) {
      const localDevelopmentOrigin = process.env.NODE_ENV !== 'production' &&
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin ?? '');
      if (!origin || localDevelopmentOrigin || allowlistedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new SecurityError('CORS_ORIGIN_DENIED', 'Origin is not allowed by CORS', 403));
    },
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'],
    optionsSuccessStatus: 204,
  }));
  app.use(express.json({ limit: '128kb' }));
  app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: 'draft-8' }));
  const authenticationLimiter = rateLimit({
    windowMs: 15 * 60_000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: { error: 'Too many authentication attempts. Please try again later.', code: 'RATE_LIMITED' },
  });

  app.get(['/api/health', '/api/v1/health'], (_req, res) => {
    res.json({
      status: 'healthy',
      mode: databaseEnabled ? 'postgresql' : 'memory',
      payments: 'mock',
      funding: fundingService.availability(),
      payouts: { mode: payoutConfig.mode, testMode: true, methods: publicPayoutMethods(payoutConfig) },
      kyc: kycService.availability(),
      fx: fxService.availability(),
      mobileTopUps: mobileTopUpService.availability(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/api/corridors', async (_req, res) => {
    const persistedCorridors = databaseEnabled
      ? await prisma.corridorConfig.findMany({
          where: { receiveCountry: 'HT', targetCurrency: 'HTG' },
          orderBy: [{ sendCountry: 'asc' }, { payoutMethod: 'asc' }],
        })
      : [];
    res.json({
      receivingMarkets: [{ country: 'HT', currencies: ['HTG'] }],
      corridors: supportedCorridors.map((supported) => {
        const persisted = persistedCorridors.filter((candidate) =>
          candidate.sendCountry === supported.sendCountry &&
          candidate.sourceCurrency === supported.sourceCurrency &&
          candidate.receiveCountry === supported.receiveCountry &&
          candidate.targetCurrency === supported.targetCurrency);
        return {
          ...supported,
          fundingProvider: supported.sourceCurrency === 'USD' ? 'DWOLLA' : 'UNCONFIGURED',
          payoutMethods: persisted.length > 0
            ? persisted.map((candidate) => candidate.payoutMethod)
            : payoutConfig.enabledMethods,
          quoteEnabled: fxConfig.mode === 'mock',
          fundingEnabled: supported.sourceCurrency === 'USD' && fundingConfig.enabled && fundingConfig.environment === 'sandbox',
          enabledForSandbox: fxConfig.mode === 'mock',
          approvedForLiveUse: persisted.length > 0 && persisted.every((candidate) => candidate.approvedForLiveUse),
          fundingProviderApproved: persisted.length > 0 && persisted.every((candidate) => candidate.fundingProviderApproved),
          payoutProviderApproved: persisted.length > 0 && persisted.every((candidate) => candidate.payoutProviderApproved),
          regulatoryApproved: persisted.length > 0 && persisted.every((candidate) => candidate.regulatoryApproved),
        };
      }),
    });
  });

  app.get('/api/payout-methods', async (_req, res) => {
    const methods = [];
    for (const method of publicPayoutMethods(payoutConfig)) {
      const configured = databaseEnabled
        ? await prisma.payoutMethodConfig.findUnique({ where: { method: method.id as never } })
        : memoryPayoutConfigurations.get(method.id);
      if (!configured || ['SANDBOX', 'ACTIVE'].includes(configured.state)) methods.push(method);
    }
    res.json({ destination: 'HT', currency: 'HTG', methods });
  });

  app.use('/api/funding', createFundingRouter({
    authenticate,
    requireApprovedKyc,
    requireFundingAllowed,
    service: fundingService,
    resolveUserIdentity: async (userId) => {
      if (databaseEnabled) {
        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { firstName: true, lastName: true, email: true },
        });
        if (!user?.firstName || !user.lastName) return undefined;
        return { firstName: user.firstName, lastName: user.lastName, email: user.email };
      }
      const user = users.get(userId);
      if (!user) return undefined;
      return { firstName: user.firstName, lastName: user.lastName, email: user.email };
    },
  }));

  app.use('/api/kyc', createKycRouter({
    authenticate,
    service: kycService,
  }));

  app.use('/api/mobile-topups', createMobileTopUpRouter({
    authenticate,
    requireFundingAllowed,
    service: mobileTopUpService,
  }));

  app.post('/api/auth/register', authenticationLimiter, async (req, res) => {
    const input = registerSchema.parse(req.body);
    const existingUser = databaseEnabled
      ? await prisma.user.findUnique({ where: { email: input.email } })
      : [...users.values()].find((user) => user.email === input.email);
    if (existingUser) {
      res.status(409).json({ error: 'An account with this email already exists', code: 'EMAIL_EXISTS' });
      return;
    }
    const passwordHash = await bcrypt.hash(input.password, 12);
    const user: StoredUser = databaseEnabled
      ? storedUserFromDb(await prisma.user.create({
          data: {
            email: input.email, firstName: input.firstName,
            lastName: input.lastName, passwordHash,
            countryCode: input.countryCode, addressLine1: input.addressLine1,
            addressLine2: input.addressLine2, city: input.city,
            region: input.region, postalCode: input.postalCode,
          },
        }))
      : {
          id: randomUUID(), email: input.email, firstName: input.firstName,
           lastName: input.lastName, countryCode: input.countryCode,
           addressLine1: input.addressLine1, addressLine2: input.addressLine2 ?? undefined,
           city: input.city, region: input.region ?? undefined,
           postalCode: input.postalCode ?? undefined,
           kycStatus: 'NOT_STARTED', role: 'CUSTOMER',
          createdAt: new Date().toISOString(), passwordHash,
          accountLocked: false, fundingRestricted: false, payoutRestricted: false,
        };
    if (!databaseEnabled) users.set(user.id, user);
    await recordAudit(user.id, 'ACCOUNT_REGISTERED', 'User', user.id);
    res.status(201).json({ user: publicUser(user), ...await issueTokens(user.id) });
  });

  app.post('/api/auth/login', authenticationLimiter, async (req, res) => {
    const input = credentialsSchema.parse(req.body);
    // The email is never stored in the lockout table. An email-scoped HMAC
    // fingerprint protects the account across rotating source IPs; the route limiter
    // independently protects each source IP.
    const identityHash = securityIdentityHash(input.email, undefined, accessSecret);
    await loginState.assertAllowed(identityHash);
    let user = databaseEnabled
      ? (await prisma.user.findUnique({ where: { email: input.email } }))
          ? storedUserFromDb((await prisma.user.findUnique({ where: { email: input.email } }))!)
          : undefined
      : [...users.values()].find((candidate) => candidate.email === input.email);
    if (!isProduction && !user && input.email === adminEmail && input.password === adminPassword) {
      user = {
        id: randomUUID(), email: adminEmail, firstName: 'TiCash', lastName: 'Admin',
        kycStatus: 'APPROVED', role: 'ADMIN', createdAt: new Date().toISOString(),
        passwordHash: await bcrypt.hash(adminPassword, 12),
        accountLocked: false, fundingRestricted: false, payoutRestricted: false,
      };
      if (databaseEnabled) {
        user = storedUserFromDb(await prisma.user.create({
          data: {
            email: adminEmail, firstName: 'TiCash', lastName: 'Admin',
            role: 'ADMIN', kycStatus: 'APPROVED', passwordHash: user.passwordHash,
          },
        }));
      } else users.set(user.id, user);
    }
    if (!isProduction && !user && input.email === demoEmail && input.password === demoPassword) {
      user = {
        id: randomUUID(), email: demoEmail, firstName: 'Demo', lastName: 'Customer',
        role: 'CUSTOMER', kycStatus: 'APPROVED', createdAt: new Date().toISOString(),
        passwordHash: await bcrypt.hash(demoPassword, 12),
        accountLocked: false, fundingRestricted: false, payoutRestricted: false,
      };
      if (databaseEnabled) {
        user = storedUserFromDb(await prisma.user.create({
          data: {
            email: demoEmail, firstName: 'Demo', lastName: 'Customer',
            role: 'CUSTOMER', kycStatus: 'APPROVED', passwordHash: user.passwordHash,
          },
        }));
      } else users.set(user.id, user);
    }
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) {
      const state = await loginState.failure(identityHash);
      await recordAudit(undefined, 'LOGIN_FAILED', 'Security', undefined, {
        identityHash, locked: Boolean(state.lockedUntil),
      });
      res.status(401).json({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
      return;
    }
    if (user.accountLocked) {
      await recordAudit(user.id, 'LOGIN_BLOCKED_ACCOUNT_LOCKED', 'Security', user.id);
      return res.status(423).json({ error: 'Account access is locked', code: 'ACCOUNT_LOCKED' });
    }
    await loginState.clear(identityHash);
    await recordAudit(user.id, 'LOGIN_SUCCEEDED', 'Security', user.id);
    res.json({ user: publicUser(user), ...await issueTokens(user.id) });
  });

  app.post('/api/auth/refresh', async (req, res) => {
    const { refreshToken } = z.object({ refreshToken: z.string().uuid() }).parse(req.body);
    const hash = tokenHash(refreshToken);
    const dbSession = databaseEnabled
      ? await prisma.session.findUnique({ where: { refreshHash: hash } })
      : null;
    const memorySession = databaseEnabled ? undefined : refreshSessions.get(hash);
    if (databaseEnabled && dbSession) await prisma.session.delete({ where: { id: dbSession.id } });
    if (!databaseEnabled) refreshSessions.delete(hash);
    const session = dbSession
      ? { userId: dbSession.userId, expiresAt: dbSession.expiresAt.getTime() }
      : memorySession;
    if (!session || session.expiresAt <= Date.now()) {
      await recordAudit(undefined, 'REFRESH_TOKEN_REJECTED', 'Security');
      res.status(401).json({ error: 'Invalid or expired refresh token', code: 'INVALID_REFRESH' });
      return;
    }
    const refreshUser = databaseEnabled
      ? await prisma.user.findUnique({ where: { id: session.userId }, select: { accountLocked: true } })
      : users.get(session.userId);
    if (!refreshUser || refreshUser.accountLocked) {
      await recordAudit(session.userId, 'REFRESH_TOKEN_BLOCKED', 'Security', session.userId);
      return res.status(423).json({ error: 'Account access is locked', code: 'ACCOUNT_LOCKED' });
    }
    res.json(await issueTokens(session.userId));
  });

  app.post('/api/auth/logout', async (req, res) => {
    const refreshToken = (req.body as { refreshToken?: unknown })?.refreshToken;
    if (typeof refreshToken === 'string') {
      const hash = tokenHash(refreshToken);
      if (databaseEnabled) await prisma.session.deleteMany({ where: { refreshHash: hash } });
      else refreshSessions.delete(hash);
    }
    await recordAudit(undefined, 'SESSION_LOGOUT', 'Security');
    res.status(204).end();
  });

  app.get('/api/users/me', authenticate, async (req: AuthRequest, res) => {
    const dbUser = databaseEnabled
      ? await prisma.user.findUnique({ where: { id: req.userId! } })
      : null;
    const user = dbUser ? storedUserFromDb(dbUser) : users.get(req.userId!);
    if (!user) return res.status(404).json({ error: 'User not found' });
    return res.json({ user: publicUser(user) });
  });

  app.patch('/api/users/me', authenticate, async (req: AuthRequest, res) => {
    const input = profileSchema.parse(req.body);
    if (databaseEnabled) {
      if (input.phoneNumber) {
        const phoneOwner = await prisma.user.findUnique({ where: { phone: input.phoneNumber } });
        if (phoneOwner && phoneOwner.id !== req.userId) {
          return res.status(409).json({
            error: 'This phone number is already linked to another account',
            code: 'PHONE_EXISTS',
          });
        }
      }
      const updated = await prisma.user.update({
        where: { id: req.userId! },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phoneNumber ?? null,
          countryCode: input.countryCode ?? null,
          addressLine1: input.addressLine1 ?? null,
          addressLine2: input.addressLine2 ?? null,
          city: input.city ?? null,
          region: input.region ?? null,
          postalCode: input.postalCode ?? null,
        },
      });
      await recordAudit(req.userId, 'PROFILE_UPDATED', 'User', req.userId);
      return res.json({ user: publicUser(storedUserFromDb(updated)) });
    }
    const user = users.get(req.userId!);
    if (!user) return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    if (input.phoneNumber && [...users.values()].some((candidate) =>
      candidate.id !== user.id && candidate.phoneNumber === input.phoneNumber)) {
      return res.status(409).json({
        error: 'This phone number is already linked to another account',
        code: 'PHONE_EXISTS',
      });
    }
    const updated = {
      ...user, firstName: input.firstName, lastName: input.lastName,
      phoneNumber: input.phoneNumber ?? undefined,
      countryCode: input.countryCode ?? undefined,
      addressLine1: input.addressLine1 ?? undefined,
      addressLine2: input.addressLine2 ?? undefined,
      city: input.city ?? undefined,
      region: input.region ?? undefined,
      postalCode: input.postalCode ?? undefined,
    };
    users.set(user.id, updated);
    await recordAudit(req.userId, 'PROFILE_UPDATED', 'User', req.userId);
    return res.json({ user: publicUser(updated) });
  });

  app.put('/api/users/me/password', authenticate, async (req: AuthRequest, res) => {
    const input = changePasswordSchema.parse(req.body);
    const dbUser = databaseEnabled
      ? await prisma.user.findUnique({ where: { id: req.userId! } })
      : null;
    const user = dbUser ? storedUserFromDb(dbUser) : users.get(req.userId!);
    if (!user) return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    if (!(await bcrypt.compare(input.currentPassword, user.passwordHash))) {
      return res.status(400).json({ error: 'Current password is incorrect', code: 'INVALID_PASSWORD' });
    }
    const passwordHash = await bcrypt.hash(input.newPassword, 12);
    if (databaseEnabled) {
      await prisma.$transaction([
        prisma.user.update({ where: { id: user.id }, data: { passwordHash } }),
        prisma.session.deleteMany({ where: { userId: user.id } }),
      ]);
    } else {
      users.set(user.id, { ...user, passwordHash });
      for (const [hash, session] of refreshSessions.entries()) {
        if (session.userId === user.id) refreshSessions.delete(hash);
      }
    }
    await recordAudit(user.id, 'PASSWORD_CHANGED', 'User', user.id);
    return res.status(204).end();
  });

  app.post('/api/kyc/submit', authenticate, async (req: AuthRequest, res) => {
    z.object({ attested: z.literal(true) }).parse(req.body);
    if (databaseEnabled) {
      const user = await prisma.$transaction(async (transaction) => {
        await transaction.kycProfile.upsert({
          where: { userId: req.userId! },
          update: { status: 'PENDING', submittedAt: new Date(), reviewedAt: null },
          create: { userId: req.userId!, status: 'PENDING', submittedAt: new Date() },
        });
        return transaction.user.update({
          where: { id: req.userId! }, data: { kycStatus: 'PENDING' },
        });
      });
      await recordAudit(req.userId, 'KYC_REVIEW_REQUESTED', 'User', req.userId);
      return res.status(202).json({ user: publicUser(storedUserFromDb(user)) });
    }
    const user = users.get(req.userId!);
    if (!user) return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    const updated = { ...user, kycStatus: 'PENDING' as const };
    users.set(user.id, updated);
    await recordAudit(req.userId, 'KYC_REVIEW_REQUESTED', 'User', req.userId);
    return res.status(202).json({ user: publicUser(updated) });
  });

  app.get('/api/recipients', authenticate, async (req: AuthRequest, res) => {
    if (databaseEnabled) {
      const result = await prisma.recipient.findMany({
        where: { userId: req.userId! }, orderBy: { createdAt: 'desc' },
      });
      return res.json({ recipients: result.map(recipientFromDb) });
    }
    return res.json({ recipients: [...recipients.values()]
      .filter((item) => item.userId === req.userId).map(publicRecipient) });
  });

  app.post('/api/recipients', authenticate, async (req: AuthRequest, res) => {
    const input = recipientSchema.parse(req.body);
    if (databaseEnabled) {
      const duplicate = await prisma.recipient.findUnique({
        where: {
          userId_phone_provider: {
            userId: req.userId!, phone: input.phoneNumber, provider: input.payoutMethod,
          },
        },
      });
      if (duplicate) return res.status(409).json({ error: 'Recipient already exists', code: 'RECIPIENT_EXISTS' });
      const created = await prisma.recipient.create({
        data: {
          userId: req.userId!, name: input.fullName,
          firstName: input.firstName, middleName: input.middleName,
          lastName: input.lastName, phone: input.phoneNumber,
          address: input.address, city: input.city, department: input.department,
          provider: input.payoutMethod,
        },
      });
      await recordAudit(req.userId, 'RECIPIENT_CREATED', 'Recipient', created.id);
      return res.status(201).json({ recipient: recipientFromDb(created) });
    }
    const duplicate = [...recipients.values()].some((item) =>
      item.userId === req.userId && item.phoneNumber === input.phoneNumber && item.payoutMethod === input.payoutMethod,
    );
    if (duplicate) return res.status(409).json({ error: 'Recipient already exists', code: 'RECIPIENT_EXISTS' });
    const recipient = { id: randomUUID(), userId: req.userId!, ...input };
    recipients.set(recipient.id, recipient);
    await recordAudit(req.userId, 'RECIPIENT_CREATED', 'Recipient', recipient.id);
    return res.status(201).json({ recipient: publicRecipient(recipient) });
  });

  app.patch('/api/recipients/:id', authenticate, async (req: AuthRequest, res) => {
    const input = recipientSchema.parse(req.body);
    const recipientId = req.params.id as string;
    if (databaseEnabled) {
      const existing = await prisma.recipient.findFirst({
        where: { id: recipientId, userId: req.userId! },
      });
      if (!existing) {
        return res.status(404).json({ error: 'Recipient not found', code: 'RECIPIENT_NOT_FOUND' });
      }
      const duplicate = await prisma.recipient.findFirst({
        where: {
          userId: req.userId!, phone: input.phoneNumber,
          provider: input.payoutMethod, id: { not: recipientId },
        },
      });
      if (duplicate) {
        return res.status(409).json({ error: 'Recipient already exists', code: 'RECIPIENT_EXISTS' });
      }
      const updated = await prisma.recipient.update({
        where: { id: recipientId },
        data: {
          name: input.fullName, firstName: input.firstName,
          middleName: input.middleName, lastName: input.lastName,
          phone: input.phoneNumber,
          address: input.address, city: input.city,
          department: input.department, provider: input.payoutMethod,
        },
      });
      await recordAudit(req.userId, 'RECIPIENT_UPDATED', 'Recipient', recipientId);
      return res.json({ recipient: recipientFromDb(updated) });
    }
    const existing = recipients.get(recipientId);
    if (!existing || existing.userId !== req.userId) {
      return res.status(404).json({ error: 'Recipient not found', code: 'RECIPIENT_NOT_FOUND' });
    }
    const duplicate = [...recipients.values()].some((item) =>
      item.id !== recipientId && item.userId === req.userId &&
      item.phoneNumber === input.phoneNumber && item.payoutMethod === input.payoutMethod,
    );
    if (duplicate) {
      return res.status(409).json({ error: 'Recipient already exists', code: 'RECIPIENT_EXISTS' });
    }
    const updated = { ...existing, ...input };
    recipients.set(recipientId, updated);
    await recordAudit(req.userId, 'RECIPIENT_UPDATED', 'Recipient', recipientId);
    return res.json({ recipient: publicRecipient(updated) });
  });

  app.delete('/api/recipients/:id', authenticate, async (req: AuthRequest, res) => {
    if (databaseEnabled) {
      const result = await prisma.recipient.deleteMany({
        where: { id: req.params.id as string, userId: req.userId! },
      });
      if (result.count) await recordAudit(req.userId, 'RECIPIENT_DELETED', 'Recipient', req.params.id as string);
      return result.count ? res.status(204).end() : res.status(404).json({ error: 'Recipient not found' });
    }
    const recipient = recipients.get(req.params.id as string);
    if (!recipient || recipient.userId !== req.userId) return res.status(404).json({ error: 'Recipient not found' });
    recipients.delete(recipient.id);
    await recordAudit(req.userId, 'RECIPIENT_DELETED', 'Recipient', recipient.id);
    return res.status(204).end();
  });

  app.get('/api/transfers', authenticate, async (req: AuthRequest, res) => {
    if (databaseEnabled) {
      const result = await prisma.transfer.findMany({
        where: { senderUserId: req.userId! }, include: { recipient: true, fundingTransaction: true, quote: true },
        orderBy: { createdAt: 'desc' },
      });
      return res.json({ transfers: result.map(transferFromDb) });
    }
    const result = [...transfers.values()]
      .filter((item) => item.userId === req.userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    res.json({ transfers: result.map(publicTransfer) });
  });

  app.get('/api/transfers/:id', authenticate, async (req: AuthRequest, res) => {
    if (databaseEnabled) {
      const transfer = await prisma.transfer.findFirst({
        where: { id: req.params.id as string, senderUserId: req.userId! },
        include: { recipient: true, fundingTransaction: true, quote: true },
      });
      return transfer ? res.json({ transfer: transferFromDb(transfer) }) : res.status(404).json({ error: 'Transfer not found', code: 'TRANSFER_NOT_FOUND' });
    }
    const transfer = transfers.get(req.params.id as string);
    if (!transfer || transfer.userId !== req.userId) return res.status(404).json({ error: 'Transfer not found', code: 'TRANSFER_NOT_FOUND' });
    return res.json({ transfer: publicTransfer(transfer) });
  });

  app.post('/api/transfers/quote', authenticate, requireApprovedKyc, requireFundingAllowed, async (req: AuthRequest, res) => {
    const input = quoteInputSchema.parse(req.body);
    const quote = await fxService.createQuote(req.userId!, quoteRequest(input), await effectiveQuotePricing());
    await recordAudit(req.userId, 'FX_QUOTE_CREATED', 'FxQuote', quote.quoteId);
    return res.json({ quote });
  });

  app.post('/api/transfers', authenticate, requireApprovedKyc, requireFundingAllowed, async (req: AuthRequest, res) => {
    const input = transferInputSchema.parse(req.body);
    const key = req.header('idempotency-key');
    if (!key || key.length < 8 || key.length > 200) {
      return res.status(400).json({ error: 'A valid Idempotency-Key header is required', code: 'IDEMPOTENCY_REQUIRED' });
    }
    const scope = `${req.userId}:${key}`;
    const requestFingerprint = JSON.stringify(input);
    await assertPayoutOperational(input.recipient.payoutMethod);
    payoutAdapterFor(input.recipient.payoutMethod, payoutConfig);
    return transferMutex.run(`create:${req.userId}`, async () => {
    if (databaseEnabled) {
      const existingKey = await prisma.idempotencyKey.findUnique({ where: { key: scope } });
      if (existingKey && existingKey.requestHash !== requestFingerprint) {
        return res.status(409).json({
          error: 'Idempotency key was already used for a different request',
          code: 'IDEMPOTENCY_CONFLICT',
        });
      }
      if (existingKey?.responseBody) {
        return res.json({ transfer: existingKey.responseBody, idempotentReplay: true });
      }
      const transferId = randomUUID();
      const quote = await fxService.consumeQuote(
        req.userId!,
        input.quoteId,
        quoteRequest(input),
      );
      const recipientRow = await prisma.recipient.upsert({
        where: {
          userId_phone_provider: {
            userId: req.userId!, phone: input.recipient.phoneNumber,
            provider: input.recipient.payoutMethod,
          },
        },
        update: {
          name: input.recipient.fullName,
          firstName: input.recipient.firstName,
          middleName: input.recipient.middleName,
          lastName: input.recipient.lastName,
          address: input.recipient.address,
          city: input.recipient.city, department: input.recipient.department,
        },
        create: {
          userId: req.userId!, name: input.recipient.fullName,
          firstName: input.recipient.firstName,
          middleName: input.recipient.middleName,
          lastName: input.recipient.lastName,
          phone: input.recipient.phoneNumber, address: input.recipient.address,
          city: input.recipient.city, department: input.recipient.department,
          provider: input.recipient.payoutMethod,
        },
      });
      const amountUsd = fxService.toUsdEquivalent(quote.sendAmount, quote.sourceCurrency, quote.exchangeRate);
      const ticashFeeUsd = fxService.toUsdEquivalent(quote.ticashFee, quote.sourceCurrency, quote.exchangeRate);
      const providerFeeUsd = fxService.toUsdEquivalent(quote.providerFee, quote.sourceCurrency, quote.exchangeRate);
      const totalChargeUsd = fxService.toUsdEquivalent(quote.totalCustomerCharge, quote.sourceCurrency, quote.exchangeRate);
      const riskFlags = await evaluateRisk(req.userId!, recipientRow.id, recipientRow.phone, amountUsd.toNumber());
      const referenceNumber = `TC-${transferId.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
      const created = await prisma.transfer.create({
        data: {
          id: transferId, senderUserId: req.userId!, recipientId: recipientRow.id,
          recipientNameSnapshot: recipientRow.name,
          recipientPhoneSnapshot: recipientRow.phone,
          payoutDestinationSnapshot: recipientRow.phone,
          provider: input.recipient.payoutMethod, amountUsd,
          feeUsd: ticashFeeUsd.plus(providerFeeUsd), exchangeRate: quote.exchangeRate,
          ticashFeeUsd, providerFeeUsd,
          totalChargeUsd,
          amountHtg: quote.recipientAmount, status: 'PENDING', stage: 'AWAITING_FUNDING',
          referenceNumber, testMode: true,
          quoteId: quote.id,
          idempotencyKey: scope,
          complianceStatus: 'REVIEW',
          riskFlags: riskFlags as Prisma.InputJsonValue,
          configurationVersionId: quote.configurationVersionId,
        },
        include: { recipient: true, fundingTransaction: true, quote: true },
      });
      const safeTransfer = transferFromDb(created);
      await prisma.idempotencyKey.create({
        data: {
          key: scope, scope: req.userId!, requestHash: requestFingerprint,
          responseCode: 201,
          responseBody: safeTransfer as unknown as Prisma.InputJsonValue,
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        },
      });
      await recordAudit(req.userId, 'TRANSFER_CREATED', 'Transfer', safeTransfer.id);
      return res.status(201).json({ transfer: safeTransfer });
    }
    const existing = idempotentTransfers.get(scope);
    if (existing && existing.requestFingerprint !== requestFingerprint) {
      return res.status(409).json({
        error: 'Idempotency key was already used for a different request',
        code: 'IDEMPOTENCY_CONFLICT',
      });
    }
    if (existing) {
      return res.json({ transfer: existing.transfer, idempotentReplay: true });
    }
    const transferId = randomUUID();
    const quote = await fxService.consumeQuote(
      req.userId!,
      input.quoteId,
      quoteRequest(input),
    );
    let recipient = [...recipients.values()].find((item) =>
      item.userId === req.userId &&
      item.phoneNumber === input.recipient.phoneNumber &&
      item.payoutMethod === input.recipient.payoutMethod,
    );
    if (!recipient) {
      recipient = { id: randomUUID(), userId: req.userId!, ...input.recipient };
      recipients.set(recipient.id, recipient);
    }
    const amountUsd = fxService.toUsdEquivalent(quote.sendAmount, quote.sourceCurrency, quote.exchangeRate);
    const riskFlags = await evaluateRisk(req.userId!, recipient.id, recipient.phoneNumber, amountUsd.toNumber());
    memoryCompliance.set(transferId, { status: 'REVIEW', reasons: riskFlags });
    const transfer: Transfer & { userId: string } = {
      id: transferId, referenceNumber: `TC-${transferId.replaceAll('-', '').slice(0, 12).toUpperCase()}`,
      userId: req.userId!, recipientId: recipient.id, recipientName: recipient.fullName,
      recipientPhone: recipient.phoneNumber, payoutMethod: recipient.payoutMethod,
      amount: quote.sendAmount.toNumber(),
      sourceCurrency: quote.sourceCurrency as Transfer['sourceCurrency'],
      targetCurrency: quote.targetCurrency as Transfer['targetCurrency'],
      fee: quote.ticashFee.plus(quote.providerFee).toNumber(),
      ticashFee: quote.ticashFee.toNumber(), providerFundingFee: quote.providerFee.toNumber(),
      totalCharged: quote.totalCustomerCharge.toNumber(),
      exchangeRate: quote.exchangeRate.toNumber(),
      amountReceived: quote.recipientAmount.toNumber(), status: 'PENDING', stage: 'AWAITING_FUNDING', complianceStatus: 'REVIEW', testMode: true,
      configurationVersionId: quote.configurationVersionId ?? undefined,
      createdAt: new Date().toISOString(),
    };
    transfers.set(transfer.id, transfer);
    const safeTransfer = publicTransfer(transfer);
    idempotentTransfers.set(scope, { requestFingerprint, transfer: safeTransfer });
    await recordAudit(req.userId, 'TRANSFER_CREATED', 'Transfer', safeTransfer.id);
    return res.status(201).json({ transfer: safeTransfer });
    });
  });

  app.post('/api/transfers/:id/funding', authenticate, requireApprovedKyc, requireFundingAllowed, async (req: AuthRequest, res) => {
    const input = transferFundingSchema.parse(req.body);
    const key = req.header('idempotency-key');
    if (!key || key.length < 8 || key.length > 200) return res.status(400).json({ error: 'A valid Idempotency-Key header is required', code: 'IDEMPOTENCY_REQUIRED' });
    const transferId = req.params.id as string;
    let amount: number;
    if (databaseEnabled) {
      const transfer = await prisma.transfer.findFirst({
        where: { id: transferId, senderUserId: req.userId! },
        include: { fundingTransaction: true, quote: true },
      });
      if (!transfer) return res.status(404).json({ error: 'Transfer not found', code: 'TRANSFER_NOT_FOUND' });
      if (transfer.quote?.sourceCurrency !== 'USD') {
        return res.status(409).json({
          error: `Funding is not configured for ${transfer.quote?.sourceCurrency ?? 'this currency'}`,
          code: 'FUNDING_PROVIDER_UNAVAILABLE',
        });
      }
      if (transfer.fundingTransaction) {
        return res.json({ transaction: await fundingService.getFunding(req.userId!, transfer.fundingTransaction.id), idempotentReplay: true });
      }
      if (transfer.stage !== 'AWAITING_FUNDING' && transfer.stage !== 'FUNDING_PROCESSING') return res.status(409).json({ error: 'Transfer cannot be funded in its current state', code: 'INVALID_TRANSFER_STATE' });
      amount = Number(transfer.totalChargeUsd ?? transfer.amountUsd.plus(transfer.feeUsd));
    } else {
      const transfer = transfers.get(transferId);
      if (!transfer || transfer.userId !== req.userId) return res.status(404).json({ error: 'Transfer not found', code: 'TRANSFER_NOT_FOUND' });
      if (transfer.sourceCurrency !== 'USD') {
        return res.status(409).json({
          error: `Funding is not configured for ${transfer.sourceCurrency}`,
          code: 'FUNDING_PROVIDER_UNAVAILABLE',
        });
      }
      if (transfer.fundingTransactionId) {
        return res.json({ transaction: await fundingService.getFunding(req.userId!, transfer.fundingTransactionId), idempotentReplay: true });
      }
      if (transfer.stage !== 'AWAITING_FUNDING' && transfer.stage !== 'FUNDING_PROCESSING') return res.status(409).json({ error: 'Transfer cannot be funded in its current state', code: 'INVALID_TRANSFER_STATE' });
      amount = transfer.totalCharged;
    }
    const result = await transferMutex.run(`funding:${req.userId}`, () =>
      fundingService.initiateFunding(req.userId!, input.fundingSourceId, amount, key, transferId));
    return res.status(result.idempotentReplay ? 200 : 202).json(result);
  });

  app.get('/api/admin/session', authenticate, permission('admin.view'), async (req: AuthRequest, res) => {
    res.json({ role: req.staffRole, permissions: req.permissions, environment: isProduction ? 'PRODUCTION' : 'SANDBOX' });
  });

  app.get('/api/admin/overview', authenticate, permission('admin.view'), async (_req, res) => {
    if (databaseEnabled) {
      const [dbUsers, dbRecipients, dbTransfers, dbAuditLogs] = await Promise.all([
        prisma.user.findMany({ orderBy: { createdAt: 'desc' } }),
        prisma.recipient.count(),
        prisma.transfer.findMany({ include: { recipient: true, quote: true }, orderBy: { createdAt: 'desc' } }),
        prisma.auditLog.findMany({ orderBy: { createdAt: 'desc' }, take: 50 }),
      ]);
      const safeTransfers = dbTransfers.map(transferFromDb);
      return res.json({
        metrics: {
          totalCustomers: dbUsers.filter((user) => user.role === 'CUSTOMER').length,
          customers: dbUsers.filter((user) => user.role === 'CUSTOMER').length,
          kycPending: dbUsers.filter((user) => ['PENDING', 'NOT_STARTED'].includes(user.kycStatus)).length,
          kycApproved: dbUsers.filter((user) => user.kycStatus === 'APPROVED').length,
          kycDeclined: dbUsers.filter((user) => ['DECLINED', 'REJECTED'].includes(user.kycStatus)).length,
          kycReview: dbUsers.filter((user) => ['IN_REVIEW', 'REVIEW_REQUIRED'].includes(user.kycStatus)).length,
          transfersToday: dbTransfers.filter((transfer) => transfer.createdAt >= new Date(new Date().setHours(0, 0, 0, 0))).length,
          transfersProcessing: dbTransfers.filter((transfer) => transfer.status === 'PROCESSING').length,
          completedTransfers: dbTransfers.filter((transfer) => transfer.status === 'COMPLETED').length,
          failedTransfers: dbTransfers.filter((transfer) => transfer.status === 'FAILED').length,
          complianceReviews: dbTransfers.filter((transfer) => transfer.stage === 'COMPLIANCE_REVIEW').length,
          fundingFailures: dbTransfers.filter((transfer) => transfer.failureCode?.startsWith('FUNDING_')).length,
          payoutFailures: dbTransfers.filter((transfer) => transfer.failureCode?.includes('PAYOUT')).length,
          reconciliationDiscrepancies: await prisma.reconciliationDiscrepancy.count(),
          recipients: dbRecipients,
          transfers: safeTransfers.length,
          volumeUsd: safeTransfers.reduce((sum, transfer) => sum + transfer.amount, 0),
          volumeHtg: safeTransfers.reduce((sum, transfer) => sum + transfer.amountReceived, 0),
          processing: safeTransfers.filter((transfer) => transfer.status === 'PROCESSING').length,
        },
        users: dbUsers.filter((user) => user.role === 'CUSTOMER').map((user) => ({ ...publicUser(storedUserFromDb(user)), email: maskEmail(user.email), phoneNumber: maskPhone(user.phone),
          accountLocked: user.accountLocked, fundingRestricted: user.fundingRestricted, payoutRestricted: user.payoutRestricted })),
        transfers: safeTransfers.map(adminTransfer),
        auditLogs: dbAuditLogs.map((item) => ({
          id: item.id, userId: item.userId ?? undefined, action: item.action,
          entity: item.entity, entityId: item.entityId ?? undefined,
          metadata: item.metadata,
          createdAt: item.createdAt.toISOString(),
        })),
      });
    }
    const allTransfers = [...transfers.values()];
    res.json({
      metrics: {
        totalCustomers: [...users.values()].filter((user) => user.role === 'CUSTOMER').length,
        customers: [...users.values()].filter((user) => user.role === 'CUSTOMER').length,
        kycPending: [...users.values()].filter((user) => ['PENDING', 'NOT_STARTED'].includes(user.kycStatus)).length,
        kycApproved: [...users.values()].filter((user) => user.kycStatus === 'APPROVED').length,
        kycDeclined: [...users.values()].filter((user) => user.kycStatus === 'DECLINED').length,
        kycReview: [...users.values()].filter((user) => user.kycStatus === 'IN_REVIEW').length,
        transfersToday: allTransfers.filter((transfer) => new Date(transfer.createdAt).toDateString() === new Date().toDateString()).length,
        transfersProcessing: allTransfers.filter((transfer) => transfer.status === 'PROCESSING').length,
        completedTransfers: allTransfers.filter((transfer) => transfer.status === 'COMPLETED').length,
        failedTransfers: allTransfers.filter((transfer) => transfer.status === 'FAILED').length,
        complianceReviews: allTransfers.filter((transfer) => transfer.stage === 'COMPLIANCE_REVIEW').length,
        fundingFailures: allTransfers.filter((transfer) => transfer.failureCode?.startsWith('FUNDING_')).length,
        payoutFailures: allTransfers.filter((transfer) => transfer.failureCode?.includes('PAYOUT')).length,
        reconciliationDiscrepancies: 0,
        recipients: recipients.size,
        transfers: allTransfers.length,
        volumeUsd: allTransfers.reduce((sum, transfer) => sum + transfer.amount, 0),
        volumeHtg: allTransfers.reduce((sum, transfer) => sum + transfer.amountReceived, 0),
        processing: allTransfers.filter((transfer) => transfer.status === 'PROCESSING').length,
      },
      users: [...users.values()].filter((user) => user.role === 'CUSTOMER').map((user) => ({ ...publicUser(user), email: maskEmail(user.email),
        phoneNumber: maskPhone(user.phoneNumber), accountLocked: user.accountLocked,
        fundingRestricted: user.fundingRestricted, payoutRestricted: user.payoutRestricted })),
      transfers: allTransfers.map(publicTransfer).map(adminTransfer),
      auditLogs: auditRecords.slice(0, 50),
    });
  });

  app.get('/api/admin/customers', authenticate, permission('customers.view'), async (req: AuthRequest, res) => {
    const query = adminListQuerySchema.parse(req.query);
    if (databaseEnabled) {
      const rows = await prisma.user.findMany({
        where: {
          role: 'CUSTOMER',
          ...(query.status ? { kycStatus: query.status as never } : {}),
          ...(query.q ? { OR: [
            { email: { contains: query.q, mode: 'insensitive' } },
            { firstName: { contains: query.q, mode: 'insensitive' } },
            { lastName: { contains: query.q, mode: 'insensitive' } },
          ] } : {}),
        },
        orderBy: { createdAt: 'desc' }, take: query.limit,
      });
      return res.json({ customers: rows.map((user) => ({
        id: user.id, name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
        email: maskEmail(user.email), phone: maskPhone(user.phone), kycStatus: normalizedKycStatus(user.kycStatus),
        accountLocked: user.accountLocked, fundingRestricted: user.fundingRestricted,
        payoutRestricted: user.payoutRestricted, createdAt: user.createdAt.toISOString(),
      })) });
    }
    const needle = query.q?.toLowerCase();
    const result = [...users.values()].filter((user) => user.role === 'CUSTOMER' &&
      (!query.status || user.kycStatus === query.status) &&
      (!needle || `${user.firstName} ${user.lastName} ${user.email}`.toLowerCase().includes(needle)))
      .slice(0, query.limit).map((user) => ({
        id: user.id, name: `${user.firstName} ${user.lastName}`.trim(), email: maskEmail(user.email),
        phone: maskPhone(user.phoneNumber), kycStatus: user.kycStatus, accountLocked: user.accountLocked,
        fundingRestricted: user.fundingRestricted, payoutRestricted: user.payoutRestricted, createdAt: user.createdAt,
      }));
    return res.json({ customers: result });
  });

  app.get('/api/admin/customers/:id', authenticate, permission('customers.view'), async (req: AuthRequest, res) => {
    const userId = req.params.id as string;
    if (databaseEnabled) {
      const customer = await prisma.user.findUnique({ where: { id: userId }, include: {
        kycProfile: true, recipients: { orderBy: { createdAt: 'desc' } },
        transfers: { include: { recipient: true, fundingTransaction: true, quote: true }, orderBy: { createdAt: 'desc' }, take: 100 },
      } });
      if (!customer || customer.role !== 'CUSTOMER') return res.status(404).json({ error: 'Customer not found', code: 'CUSTOMER_NOT_FOUND' });
      await recordAudit(req.userId, 'ADMIN_CUSTOMER_RECORD_VIEWED', 'User', userId);
      return res.json({ customer: {
        id: customer.id, name: `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim(),
        email: maskEmail(customer.email), phone: maskPhone(customer.phone), kycStatus: normalizedKycStatus(customer.kycStatus),
        kyc: customer.kycProfile ? { status: normalizedKycStatus(customer.kycProfile.status),
          startedAt: customer.kycProfile.kycStartedAt?.toISOString(), verifiedAt: customer.kycProfile.kycVerifiedAt?.toISOString(),
          failureReason: customer.kycProfile.kycFailureReason } : null,
        accountLocked: customer.accountLocked, fundingRestricted: customer.fundingRestricted,
        payoutRestricted: customer.payoutRestricted, restrictionReason: customer.restrictionReason,
        recipients: customer.recipients.map((recipient) => ({ id: recipient.id, name: recipient.name,
          phone: maskPhone(recipient.phone), city: recipient.city, department: recipient.department, payoutMethod: recipient.provider })),
        transfers: customer.transfers.map(transferFromDb).map(adminTransfer),
      } });
    }
    const customer = users.get(userId);
    if (!customer || customer.role !== 'CUSTOMER') return res.status(404).json({ error: 'Customer not found', code: 'CUSTOMER_NOT_FOUND' });
    await recordAudit(req.userId, 'ADMIN_CUSTOMER_RECORD_VIEWED', 'User', userId);
    return res.json({ customer: {
      id: customer.id, name: `${customer.firstName} ${customer.lastName}`.trim(), email: maskEmail(customer.email),
      phone: maskPhone(customer.phoneNumber), kycStatus: customer.kycStatus, accountLocked: customer.accountLocked,
      fundingRestricted: customer.fundingRestricted, payoutRestricted: customer.payoutRestricted,
      restrictionReason: customer.restrictionReason,
      recipients: [...recipients.values()].filter((item) => item.userId === userId).map((item) => ({
        id: item.id, name: item.fullName, phone: maskPhone(item.phoneNumber), city: item.city,
        department: item.department, payoutMethod: item.payoutMethod,
      })), transfers: [...transfers.values()].filter((item) => item.userId === userId).map(publicTransfer).map(adminTransfer),
    } });
  });

  app.get('/api/admin/transfers', authenticate, permission('transfers.view'), async (req: AuthRequest, res) => {
    const query = adminListQuerySchema.parse(req.query);
    if (databaseEnabled) {
      const rows = await prisma.transfer.findMany({
        where: {
          AND: [
            ...(query.status ? [{ OR: [{ status: query.status as never }, { stage: query.status as never }, { complianceStatus: query.status as never }] }] : []),
            ...(query.q ? [{ OR: [
              { referenceNumber: { contains: query.q, mode: 'insensitive' as const } },
              { sender: { email: { contains: query.q, mode: 'insensitive' as const } } },
              { recipient: { name: { contains: query.q, mode: 'insensitive' as const } } },
            ] }] : []),
          ],
        },
        include: { recipient: true, sender: true, fundingTransaction: true, quote: true }, orderBy: { createdAt: 'desc' }, take: query.limit,
      });
      return res.json({ transfers: rows.map((row) => ({ ...adminTransfer(transferFromDb(row)), sender: maskEmail(row.sender.email),
        fundingStatus: row.fundingTransaction?.status ?? 'NOT_STARTED' })) });
    }
    const needle = query.q?.toLowerCase();
    return res.json({ transfers: [...transfers.values()].filter((transfer) =>
      (!query.status || [transfer.status, transfer.stage, transfer.complianceStatus].includes(query.status as never)) &&
      (!needle || `${transfer.referenceNumber} ${transfer.recipientName}`.toLowerCase().includes(needle)))
      .slice(0, query.limit).map(publicTransfer).map(adminTransfer) });
  });

  app.get('/api/admin/transfers/:id', authenticate, permission('transfers.view'), async (req: AuthRequest, res) => {
    const transferId = req.params.id as string;
    if (databaseEnabled) {
      const row = await prisma.transfer.findUnique({ where: { id: transferId }, include: {
        sender: true, recipient: true, fundingTransaction: true, quote: true,
        complianceDecisions: { orderBy: { createdAt: 'asc' } },
      } });
      if (!row) return res.status(404).json({ error: 'Transfer not found', code: 'TRANSFER_NOT_FOUND' });
      await recordAudit(req.userId, 'ADMIN_TRANSFER_RECORD_VIEWED', 'Transfer', transferId);
      return res.json({ transfer: { ...adminTransfer(transferFromDb(row)), sender: maskEmail(row.sender.email),
        fundingStatus: row.fundingTransaction?.status ?? 'NOT_STARTED', riskFlags: row.riskFlags,
        providerReferences: { funding: row.fundingTransaction?.providerTransferId ?? null, payout: row.providerTransactionId },
        complianceDecisions: row.complianceDecisions, timeline: transferTimeline({ ...row,
          fundingStatus: row.fundingTransaction?.status, fundingCreatedAt: row.fundingTransaction?.createdAt,
          fundingCompletedAt: row.fundingTransaction?.completedAt }),
      } });
    }
    const row = transfers.get(transferId);
    if (!row) return res.status(404).json({ error: 'Transfer not found', code: 'TRANSFER_NOT_FOUND' });
    await recordAudit(req.userId, 'ADMIN_TRANSFER_RECORD_VIEWED', 'Transfer', transferId);
    return res.json({ transfer: { ...adminTransfer(publicTransfer(row)), riskFlags: memoryCompliance.get(row.id)?.reasons ?? [],
      timeline: transferTimeline(row) } });
  });

  app.get('/api/admin/reviews', authenticate, permission('compliance.decide'), async (_req: AuthRequest, res) => {
    if (databaseEnabled) {
      const [reviewTransfers, reviewUsers] = await Promise.all([
        prisma.transfer.findMany({ where: { OR: [{ complianceStatus: 'REVIEW' }, { stage: 'COMPLIANCE_REVIEW' }] },
          include: { sender: true, recipient: true, fundingTransaction: true, quote: true }, orderBy: { updatedAt: 'asc' } }),
        prisma.user.findMany({ where: { kycStatus: { in: ['PENDING', 'IN_REVIEW', 'REVIEW_REQUIRED'] } }, orderBy: { updatedAt: 'asc' } }),
      ]);
      return res.json({ transfers: reviewTransfers.map((row) => ({ ...adminTransfer(transferFromDb(row)), sender: maskEmail(row.sender.email),
        riskFlags: row.riskFlags, fundingStatus: row.fundingTransaction?.status ?? 'NOT_STARTED' })),
        customers: reviewUsers.map((user) => ({ id: user.id, name: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim(),
          email: maskEmail(user.email), kycStatus: normalizedKycStatus(user.kycStatus) })) });
    }
    return res.json({ transfers: [...transfers.values()].filter((item) => item.stage === 'COMPLIANCE_REVIEW').map(publicTransfer).map(adminTransfer),
      customers: [...users.values()].filter((item) => ['PENDING', 'IN_REVIEW'].includes(item.kycStatus)).map((item) => ({
        id: item.id, name: `${item.firstName} ${item.lastName}`, email: maskEmail(item.email), kycStatus: item.kycStatus,
      })) });
  });

  app.patch('/api/admin/staff/:id/role', authenticate, permission('staff.manage'), async (req: AuthRequest, res) => {
    const input = staffRoleSchema.parse(req.body);
    const targetId = req.params.id as string;
    if (targetId === req.userId) return res.status(409).json({ error: 'Staff members cannot change their own role', code: 'SELF_ROLE_CHANGE_BLOCKED' });
    if (databaseEnabled) {
      const target = await prisma.user.findUnique({ where: { id: targetId } });
      if (!target) return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      await prisma.user.update({ where: { id: targetId }, data: { role: input.role } });
    } else {
      const target = users.get(targetId);
      if (!target) return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      users.set(targetId, { ...target, role: input.role });
    }
    await recordAudit(req.userId, 'STAFF_ROLE_CHANGED', 'User', targetId, { role: input.role, reason: input.reason });
    return res.json({ userId: targetId, role: input.role });
  });

  app.patch('/api/admin/users/:id/kyc', authenticate, permission('kyc.review'), async (req: AuthRequest, res) => {
    const { status } = kycDecisionSchema.parse(req.body);
    const userId = req.params.id as string;
    if (status === 'APPROVED' && (isProduction || diditConfig.enabled)) {
      return res.status(409).json({
        error: 'KYC approval must come from the configured verification provider',
        code: 'KYC_PROVIDER_AUTHORITATIVE',
      });
    }
    if (databaseEnabled) {
      const existing = await prisma.user.findUnique({ where: { id: userId } });
      if (!existing) return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      const user = await prisma.$transaction(async (transaction) => {
        await transaction.kycProfile.upsert({
          where: { userId },
          update: { status, reviewedAt: new Date() },
          create: { userId, status, reviewedAt: new Date() },
        });
        return transaction.user.update({ where: { id: userId }, data: { kycStatus: status } });
      });
      await recordAudit(req.userId, `KYC_${status}`, 'User', userId);
      return res.json({ user: publicUser(storedUserFromDb(user)) });
    }
    const user = users.get(userId);
    if (!user) return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
    const updated = { ...user, kycStatus: status };
    users.set(user.id, updated);
    await recordAudit(req.userId, `KYC_${status}`, 'User', userId);
    return res.json({ user: publicUser(updated) });
  });

  app.patch('/api/admin/users/:id/restrictions', authenticate, permission('customers.restrict'), async (req: AuthRequest, res) => {
    const input = accountRestrictionSchema.parse(req.body);
    const userId = req.params.id as string;
    if (databaseEnabled) {
      const existing = await prisma.user.findUnique({ where: { id: userId } });
      if (!existing) return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      await prisma.$transaction([
        prisma.user.update({ where: { id: userId }, data: {
          accountLocked: input.accountLocked,
          fundingRestricted: input.fundingRestricted,
          payoutRestricted: input.payoutRestricted,
          restrictionReason: input.reason,
          restrictedAt: input.accountLocked || input.fundingRestricted || input.payoutRestricted ? new Date() : null,
        } }),
        ...(input.accountLocked ? [prisma.session.deleteMany({ where: { userId } })] : []),
      ]);
    } else {
      const user = users.get(userId);
      if (!user) return res.status(404).json({ error: 'User not found', code: 'USER_NOT_FOUND' });
      users.set(userId, { ...user, accountLocked: input.accountLocked,
        fundingRestricted: input.fundingRestricted, payoutRestricted: input.payoutRestricted,
        restrictionReason: input.reason });
      if (input.accountLocked) {
        for (const [hash, session] of refreshSessions) if (session.userId === userId) refreshSessions.delete(hash);
      }
    }
    await recordAudit(req.userId, 'ACCOUNT_RESTRICTIONS_UPDATED', 'User', userId, {
      accountLocked: input.accountLocked, fundingRestricted: input.fundingRestricted,
      payoutRestricted: input.payoutRestricted, reason: input.reason,
    });
    return res.json({ accountLocked: input.accountLocked, fundingRestricted: input.fundingRestricted,
      payoutRestricted: input.payoutRestricted });
  });

  app.patch('/api/admin/transfers/:id/compliance', authenticate, permission('compliance.decide'), async (req: AuthRequest, res) => {
    const input = complianceDecisionSchema.parse(req.body);
    const transferId = req.params.id as string;
    if (databaseEnabled) {
      const transfer = await prisma.transfer.findUnique({
        where: { id: transferId }, include: { recipient: true, fundingTransaction: true, sender: true, quote: true },
      });
      if (!transfer) return res.status(404).json({ error: 'Transfer not found', code: 'TRANSFER_NOT_FOUND' });
      if (transfer.immutableAt && input.status !== transfer.complianceStatus) {
        return res.status(409).json({ error: 'Compliance state cannot change after payout begins', code: 'TRANSFER_IMMUTABLE' });
      }
      if (input.status === 'CLEAR' && (transfer.sender.accountLocked || transfer.sender.payoutRestricted)) {
        return res.status(409).json({ error: 'Account restrictions prevent payout', code: 'PAYOUT_RESTRICTED' });
      }
      if (input.status === 'CLEAR' &&
          (transfer.stage !== 'COMPLIANCE_REVIEW' || transfer.fundingTransaction?.status !== 'COMPLETED')) {
        return res.status(409).json({ error: 'Confirmed funding and compliance review are required', code: 'INVALID_TRANSFER_STATE' });
      }
      await prisma.complianceDecision.create({ data: {
        transferId, subjectUserId: transfer.senderUserId, reviewedByUserId: req.userId,
        status: input.status, reasons: [input.reason], screeningPerformed: false,
      } });
      if (input.status === 'CLEAR') {
        if (transfer.provider === 'HAITIAN_BANK') {
          return res.status(409).json({ error: 'Haitian bank payout is not enabled', code: 'PAYOUT_METHOD_UNAVAILABLE' });
        }
        await assertPayoutOperational(transfer.provider);
        const payout = await payoutAdapterFor(transfer.provider, payoutConfig).submit({
          recipientPhone: transfer.recipientPhoneSnapshot ?? transfer.recipient.phone,
          amountHtg: Number(transfer.amountHtg), transferId,
        });
        await prisma.transfer.update({ where: { id: transferId }, data: {
          complianceStatus: 'CLEAR', complianceReviewedAt: new Date(), status: 'PROCESSING',
          stage: 'PAYOUT_PROCESSING', payoutStartedAt: new Date(), immutableAt: new Date(),
          providerTransactionId: payout.providerTransactionId, failureCode: null,
        } });
      } else {
        await prisma.transfer.update({ where: { id: transferId }, data: {
          complianceStatus: input.status, complianceReviewedAt: new Date(),
          status: 'PROCESSING', stage: 'COMPLIANCE_REVIEW',
        } });
      }
      const updated = await prisma.transfer.findUniqueOrThrow({
        where: { id: transferId }, include: { recipient: true, fundingTransaction: true, quote: true },
      });
      await recordAudit(req.userId, `COMPLIANCE_${input.status}`, 'Transfer', transferId, { reason: input.reason });
      return res.json({ transfer: transferFromDb(updated) });
    }
    const transfer = transfers.get(transferId);
    if (!transfer) return res.status(404).json({ error: 'Transfer not found', code: 'TRANSFER_NOT_FOUND' });
    const account = users.get(transfer.userId);
    if (input.status === 'CLEAR' && (account?.accountLocked || account?.payoutRestricted)) {
      return res.status(409).json({ error: 'Account restrictions prevent payout', code: 'PAYOUT_RESTRICTED' });
    }
    let updated = transfer;
    if (input.status === 'CLEAR') {
      if (transfer.stage !== 'COMPLIANCE_REVIEW' || !transfer.fundingTransactionId) {
        return res.status(409).json({ error: 'Confirmed funding and compliance review are required', code: 'INVALID_TRANSFER_STATE' });
      }
      const funding = await fundingService.getFunding(transfer.userId, transfer.fundingTransactionId);
      if (funding.status !== 'COMPLETED') return res.status(409).json({ error: 'Funding is not complete', code: 'INVALID_TRANSFER_STATE' });
      await assertPayoutOperational(transfer.payoutMethod);
      const payout = await payoutAdapterFor(transfer.payoutMethod, payoutConfig).submit({
        recipientPhone: transfer.recipientPhone, amountHtg: transfer.amountReceived, transferId,
      });
      updated = { ...transfer, status: 'PROCESSING', stage: 'PAYOUT_PROCESSING',
        complianceStatus: 'CLEAR', providerTransactionId: payout.providerTransactionId, failureCode: undefined };
    } else {
      updated = { ...transfer, status: 'PROCESSING', stage: 'COMPLIANCE_REVIEW', complianceStatus: input.status };
    }
    transfers.set(transferId, updated);
    memoryCompliance.set(transferId, { status: input.status, reasons: [input.reason], reviewedAt: new Date().toISOString() });
    await recordAudit(req.userId, `COMPLIANCE_${input.status}`, 'Transfer', transferId, { reason: input.reason });
    return res.json({ transfer: publicTransfer(updated) });
  });

  app.get('/api/admin/providers', authenticate, permission('providers.view'), async (_req: AuthRequest, res) => {
    const fallback = payoutMethods.map((method): PublicPayoutConfiguration => {
      const enabled = method !== 'HAITIAN_BANK' && payoutConfig.enabledMethods.includes(method);
      return memoryPayoutConfigurations.get(method) ?? {
        method, state: enabled ? 'SANDBOX' : 'DISABLED', environment: 'MOCK',
        providerConfigured: enabled, providerApproved: false, regulatoryApproved: false,
        approvedForLiveUse: false, version: 1,
        statusMessage: method === 'HAITIAN_BANK' ? 'No approved Haiti bank payout provider configured' : 'Mock sandbox adapter only',
        updatedAt: new Date(0).toISOString(),
      };
    });
    const payouts = databaseEnabled
      ? (await prisma.payoutMethodConfig.findMany({ orderBy: { method: 'asc' } })).map((item) => ({
          method: item.method, state: item.state, environment: item.environment,
          providerConfigured: item.providerConfigured, providerApproved: item.providerApproved,
          regulatoryApproved: item.regulatoryApproved, approvedForLiveUse: false as const,
          version: item.version, statusMessage: item.statusMessage ?? undefined, updatedAt: item.updatedAt.toISOString(),
        }))
      : fallback;
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const recent = databaseEnabled ? {
      diditEvents24h: await prisma.kycWebhookEvent.count({ where: { receivedAt: { gte: since } } }),
      diditFailures24h: await prisma.kycWebhookEvent.count({ where: { receivedAt: { gte: since }, status: 'FAILED' } }),
      dwollaEvents24h: await prisma.providerWebhookEvent.count({ where: { receivedAt: { gte: since } } }),
      dwollaFailures24h: await prisma.providerWebhookEvent.count({ where: { receivedAt: { gte: since }, status: 'FAILED' } }),
    } : {
      diditEvents24h: auditRecords.filter((item) => item.action.startsWith('KYC_') && new Date(item.createdAt) >= since).length,
      diditFailures24h: 0,
      dwollaEvents24h: auditRecords.filter((item) => item.action.startsWith('DWOLLA_') && new Date(item.createdAt) >= since).length,
      dwollaFailures24h: 0,
    };
    const configuredMethods = new Set(payouts.map((item) => item.method));
    res.json({
      corridor: { sendCountry: 'US', sourceCurrency: 'USD', receiveCountry: 'HT', targetCurrency: 'HTG', approvedForLiveUse: false },
      services: [
        { id: 'DIDIT', kind: 'KYC', environment: diditConfig.enabled ? 'SANDBOX' : 'NOT_CONFIGURED', status: {
          ...kycService.availability(), recentEvents24h: recent.diditEvents24h, failedEvents24h: recent.diditFailures24h } },
        { id: 'DWOLLA', kind: 'FUNDING', environment: fundingConfig.environment?.toUpperCase() ?? 'SANDBOX', status: {
          ...fundingService.availability(), recentEvents24h: recent.dwollaEvents24h, failedEvents24h: recent.dwollaFailures24h } },
        { id: 'FX', kind: 'FX', environment: fxConfig.mode === 'mock' ? 'MOCK' : 'NOT_CONFIGURED', status: fxService.availability() },
        { id: 'TERRAPAY', kind: 'PAYOUT', environment: 'NOT_CONFIGURED', status: { configured: false, prospectiveOnly: true } },
      ],
      payouts: [...payouts, ...fallback.filter((item) => !configuredMethods.has(item.method))],
    });
  });

  app.patch('/api/admin/providers/payouts/:method', authenticate, permission('providers.manage'), async (req: AuthRequest, res) => {
    const method = z.enum(payoutMethods).parse(req.params.method);
    const input = payoutConfigurationUpdateSchema.parse(req.body);
    const fallbackEnabled = method !== 'HAITIAN_BANK' && payoutConfig.enabledMethods.includes(method);
    if (databaseEnabled) {
      const current = await prisma.payoutMethodConfig.findUnique({ where: { method } });
      const state = current?.state ?? (fallbackEnabled ? 'SANDBOX' : 'DISABLED');
      assertSafePayoutTransition({ current: state, requested: input.state,
        environment: current?.environment ?? 'MOCK', providerConfigured: current?.providerConfigured ?? fallbackEnabled,
        providerApproved: current?.providerApproved ?? false, regulatoryApproved: current?.regulatoryApproved ?? false,
        approvedForLiveUse: false });
      const updated = await prisma.payoutMethodConfig.upsert({ where: { method }, update: {
        state: input.state, version: { increment: 1 }, updatedByUserId: req.userId, statusMessage: input.reason,
      }, create: { method, state: input.state, environment: 'MOCK', providerConfigured: fallbackEnabled,
        providerApproved: false, regulatoryApproved: false, approvedForLiveUse: false,
        updatedByUserId: req.userId, statusMessage: input.reason } });
      await recordAudit(req.userId, 'PAYOUT_CONFIGURATION_CHANGED', 'PayoutMethodConfig', updated.id,
        { method, from: state, to: input.state, version: updated.version, reason: input.reason });
      return res.json({ configuration: { ...updated, approvedForLiveUse: false } });
    }
    const current = memoryPayoutConfigurations.get(method) ?? {
      method, state: fallbackEnabled ? 'SANDBOX' : 'DISABLED', environment: 'MOCK', providerConfigured: fallbackEnabled,
      providerApproved: false, regulatoryApproved: false, approvedForLiveUse: false as const, version: 1,
      statusMessage: fallbackEnabled ? 'Mock sandbox adapter only' : 'Not configured', updatedAt: new Date(0).toISOString(),
    };
    assertSafePayoutTransition({ current: current.state, requested: input.state, environment: current.environment,
      providerConfigured: current.providerConfigured, providerApproved: current.providerApproved,
      regulatoryApproved: current.regulatoryApproved, approvedForLiveUse: false });
    const updated: PublicPayoutConfiguration = { ...current, state: input.state, version: current.version + 1,
      statusMessage: input.reason, updatedAt: new Date().toISOString() };
    memoryPayoutConfigurations.set(method, updated);
    await recordAudit(req.userId, 'PAYOUT_CONFIGURATION_CHANGED', 'PayoutMethodConfig', method,
      { method, from: current.state, to: input.state, version: updated.version, reason: input.reason });
    return res.json({ configuration: updated });
  });

  app.get('/api/admin/configuration/fees-limits', authenticate, permission('configuration.view'), async (_req: AuthRequest, res) => {
    const fallback = { id: 'environment-defaults', version: 1, effectiveAt: new Date(0).toISOString(), reason: 'Environment defaults',
      values: { ticashFeePercent: Number(fxConfig.ticashFeePercent), ticashMinimumFeeUsd: Number(fxConfig.ticashMinimumFeeUsd),
        providerFundingFeeUsd: Number(fxConfig.providerFundingFeeUsd), limitsEnabled: securityConfig.transferLimitsEnabled,
        perTransactionUsd: securityConfig.limits.perTransaction ?? null, dailyUsd: securityConfig.limits.daily ?? null,
        weeklyUsd: securityConfig.limits.weekly ?? null, monthlyUsd: securityConfig.limits.monthly ?? null } };
    const versions = databaseEnabled ? await prisma.adminConfigVersion.findMany({
      where: { type: 'FEES_AND_LIMITS' }, orderBy: { version: 'desc' }, take: 50,
    }) : [...memoryAdminConfigurations].reverse();
    return res.json({ active: versions.find((item) => item.retiredAt == null) ?? fallback, versions });
  });

  app.post('/api/admin/configuration/fees-limits', authenticate, permission('configuration.manage'), async (req: AuthRequest, res) => {
    const input = feeLimitConfigurationSchema.parse(req.body);
    const { reason, ...values } = input;
    if (databaseEnabled) {
      const latest = await prisma.adminConfigVersion.findFirst({ where: { type: 'FEES_AND_LIMITS' }, orderBy: { version: 'desc' } });
      const now = new Date();
      const created = await prisma.$transaction(async (transaction) => {
        await transaction.adminConfigVersion.updateMany({ where: { type: 'FEES_AND_LIMITS', retiredAt: null }, data: { retiredAt: now } });
        return transaction.adminConfigVersion.create({ data: { type: 'FEES_AND_LIMITS', version: (latest?.version ?? 0) + 1,
          values: values as Prisma.InputJsonValue, reason, effectiveAt: now, createdByUserId: req.userId } });
      });
      await recordAudit(req.userId, 'FEE_LIMIT_CONFIGURATION_VERSION_CREATED', 'AdminConfigVersion', created.id,
        { version: created.version, reason, values });
      return res.status(201).json({ configuration: created });
    }
    for (const version of memoryAdminConfigurations) if (!('retiredAt' in version)) Object.assign(version, { retiredAt: new Date().toISOString() });
    const created = { id: randomUUID(), version: (memoryAdminConfigurations.at(-1)?.version ?? 0) + 1,
      values, reason, effectiveAt: new Date().toISOString(), createdByUserId: req.userId };
    memoryAdminConfigurations.push(created);
    await recordAudit(req.userId, 'FEE_LIMIT_CONFIGURATION_VERSION_CREATED', 'AdminConfigVersion', created.id,
      { version: created.version, reason, values });
    return res.status(201).json({ configuration: created });
  });

  app.get('/api/admin/ledger', authenticate, permission('ledger.view'), async (req: AuthRequest, res) => {
    const query = adminListQuerySchema.parse(req.query);
    if (!databaseEnabled) return res.json({ readOnly: true, transactions: [], message: 'Persistent ledger is unavailable in memory mode' });
    const rows = await prisma.ledgerTransaction.findMany({
      where: query.q ? { reference: { contains: query.q, mode: 'insensitive' } } : undefined,
      include: { entries: { include: { account: true } }, fundingTransaction: true },
      orderBy: { createdAt: 'desc' }, take: query.limit,
    });
    return res.json({ readOnly: true, transactions: rows.map((transaction) => ({
      id: transaction.id, reference: transaction.reference, type: transaction.type,
      fundingTransactionId: transaction.fundingTransactionId, createdAt: transaction.createdAt,
      balanced: ['USD', 'HTG'].every((currency) => {
        const entries = transaction.entries.filter((entry) => entry.currency === currency);
        const debit = entries.filter((entry) => entry.direction === 'DEBIT').reduce((sum, entry) => sum + Number(entry.amount), 0);
        const credit = entries.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum + Number(entry.amount), 0);
        return Math.abs(debit - credit) < 0.001;
      }),
      entries: transaction.entries.map((entry) => ({ direction: entry.direction, amount: Number(entry.amount), currency: entry.currency,
        account: { key: entry.account.key, name: entry.account.name, type: entry.account.type } })),
    })) });
  });

  app.get('/api/admin/audit', authenticate, permission('audit.view'), async (req: AuthRequest, res) => {
    const query = adminListQuerySchema.parse(req.query);
    if (databaseEnabled) {
      const rows = await prisma.auditLog.findMany({ where: query.q ? { OR: [
        { action: { contains: query.q, mode: 'insensitive' } }, { entity: { contains: query.q, mode: 'insensitive' } },
        { entityId: { contains: query.q, mode: 'insensitive' } },
      ] } : undefined, orderBy: { createdAt: 'desc' }, take: query.limit });
      return res.json({ events: rows });
    }
    const needle = query.q?.toLowerCase();
    return res.json({ events: auditRecords.filter((event) => !needle || `${event.action} ${event.entity} ${event.entityId ?? ''}`.toLowerCase().includes(needle)).slice(0, query.limit) });
  });

  app.post('/api/admin/transfers/:id/reversal', authenticate, permission('transfers.operate'), async (req: AuthRequest, res) => {
    const input = reversalSchema.parse(req.body);
    const transferId = req.params.id as string;
    if (databaseEnabled) {
      const transfer = await prisma.transfer.findUnique({ where: { id: transferId } });
      if (!transfer) return res.status(404).json({ error: 'Transfer not found', code: 'TRANSFER_NOT_FOUND' });
      if (transfer.status === 'REVERSED') return res.status(409).json({ error: 'Transfer is already reversed', code: 'DUPLICATE_REVERSAL' });
      if (!['PAYOUT_PROCESSING', 'DELIVERED', 'FAILED'].includes(transfer.stage)) {
        return res.status(409).json({ error: 'Transfer cannot be reversed from its current state', code: 'INVALID_TRANSFER_STATE' });
      }
      await fundingRepository.releaseWalletForTransfer(transfer.senderUserId, transfer.id, Number(transfer.totalChargeUsd ?? transfer.amountUsd.plus(transfer.feeUsd)));
      const updated = await prisma.transfer.update({ where: { id: transferId }, data: { status: 'REVERSED', stage: 'REVERSED',
        failureCode: `REVERSAL_${input.reasonCode}` }, include: { recipient: true, fundingTransaction: true, quote: true } });
      await recordAudit(req.userId, 'TRANSFER_REVERSAL_CREATED', 'Transfer', transferId, input);
      return res.json({ transfer: transferFromDb(updated) });
    }
    const transfer = transfers.get(transferId);
    if (!transfer) return res.status(404).json({ error: 'Transfer not found', code: 'TRANSFER_NOT_FOUND' });
    if (transfer.status === 'REVERSED') return res.status(409).json({ error: 'Transfer is already reversed', code: 'DUPLICATE_REVERSAL' });
    if (!['PAYOUT_PROCESSING', 'DELIVERED', 'FAILED'].includes(transfer.stage)) return res.status(409).json({ error: 'Transfer cannot be reversed from its current state', code: 'INVALID_TRANSFER_STATE' });
    await fundingRepository.releaseWalletForTransfer(transfer.userId, transfer.id, transfer.totalCharged);
    const updated = { ...transfer, status: 'REVERSED' as const, stage: 'REVERSED' as const, failureCode: `REVERSAL_${input.reasonCode}` };
    transfers.set(transferId, updated);
    await recordAudit(req.userId, 'TRANSFER_REVERSAL_CREATED', 'Transfer', transferId, input);
    return res.json({ transfer: publicTransfer(updated) });
  });

  app.post('/api/admin/reconciliation/run', authenticate, permission('reconciliation.run'), async (req: AuthRequest, res) => {
    if (!databaseEnabled) {
      await recordAudit(req.userId, 'RECONCILIATION_REQUIRES_DATABASE', 'Reconciliation');
      return res.status(409).json({
        status: 'DISCREPANCIES_FOUND', autoCorrected: false,
        discrepancies: [{ code: 'PERSISTENT_LEDGER_UNAVAILABLE', entity: 'Database' }],
      });
    }
    const report = await runPrismaReconciliation(prisma, req.userId);
    await recordAudit(req.userId, 'RECONCILIATION_COMPLETED', 'ReconciliationRun', report.id, {
      status: report.status, discrepancyCount: report.discrepancyCount,
    });
    return res.json(report);
  });

  app.get('/api/admin/reconciliation', authenticate, permission('reconciliation.view'), async (_req: AuthRequest, res) => {
    if (!databaseEnabled) return res.json({
      runs: [],
      summary: {
        matchedTransactions: 0,
        unmatchedProviderEvents: 0,
        amountDiscrepancies: 0,
        duplicateEventAttempts: 0,
        transfersRequiringInvestigation: 0,
        providerReconciliationConfigured: false,
      },
    });
    const runs = await prisma.reconciliationRun.findMany({
      orderBy: { startedAt: 'desc' }, take: 25, include: { discrepancies: true },
    });
    const latestDiscrepancies = runs[0]?.discrepancies ?? [];
    const [matchedTransactions, failedFundingEvents, failedKycEvents, fundingDuplicates, kycDuplicates] = await Promise.all([
      prisma.fundingTransaction.count({
        where: {
          status: 'COMPLETED',
          ledgerTransactions: { some: { reference: { endsWith: ':settled' } } },
        },
      }),
      prisma.providerWebhookEvent.count({ where: { status: 'FAILED' } }),
      prisma.kycWebhookEvent.count({ where: { status: 'FAILED' } }),
      prisma.providerWebhookEvent.aggregate({ _sum: { duplicateDeliveryCount: true } }),
      prisma.kycWebhookEvent.aggregate({ _sum: { duplicateDeliveryCount: true } }),
    ]);
    const investigationIds = new Set(
      latestDiscrepancies
        .filter((item) => item.entityId && item.code !== 'PROVIDER_RECONCILIATION_NOT_CONFIGURED')
        .map((item) => `${item.entity}:${item.entityId}`),
    );
    return res.json({
      runs,
      summary: {
        matchedTransactions,
        unmatchedProviderEvents: failedFundingEvents + failedKycEvents,
        amountDiscrepancies: latestDiscrepancies.filter((item) => item.code === 'PROVIDER_AMOUNT_MISMATCH').length,
        duplicateEventAttempts:
          (fundingDuplicates._sum.duplicateDeliveryCount ?? 0)
          + (kycDuplicates._sum.duplicateDeliveryCount ?? 0),
        transfersRequiringInvestigation: investigationIds.size,
        providerReconciliationConfigured: false,
      },
    });
  });

  app.patch('/api/admin/transfers/:id/status', authenticate, permission('transfers.operate'), async (req: AuthRequest, res) => {
    const { status } = transferStatusSchema.parse(req.body);
    const transferId = req.params.id as string;
    if (databaseEnabled) {
      const existing = await prisma.transfer.findUnique({ where: { id: transferId } });
      if (!existing) return res.status(404).json({ error: 'Transfer not found', code: 'TRANSFER_NOT_FOUND' });
      if (status === 'COMPLETED' && (existing.stage !== 'PAYOUT_PROCESSING' || !existing.providerTransactionId)) {
        return res.status(409).json({ error: 'Payout must be processing before it can be delivered', code: 'INVALID_TRANSFER_STATE' });
      }
      if (status === 'COMPLETED' && existing.complianceStatus !== 'CLEAR') {
        return res.status(409).json({ error: 'Compliance clearance is required before delivery', code: 'COMPLIANCE_REQUIRED' });
      }
      if (status === 'FAILED' && existing.stage === 'PAYOUT_PROCESSING') {
        await fundingRepository.releaseWalletForTransfer(existing.senderUserId, existing.id, Number(existing.totalChargeUsd ?? existing.amountUsd.plus(existing.feeUsd)));
      }
      const updated = await prisma.transfer.update({
        where: { id: transferId },
        data: {
          status,
          stage: status === 'COMPLETED' ? 'DELIVERED' : 'FAILED',
          failureCode: status === 'FAILED' ? 'MOCK_PAYOUT_FAILED' : existing.failureCode,
          completedAt: status === 'COMPLETED' ? new Date() : existing.completedAt,
        },
        include: { recipient: true, quote: true },
      });
      await recordAudit(req.userId, `TRANSFER_${status}`, 'Transfer', transferId);
      return res.json({ transfer: transferFromDb(updated) });
    }
    const existing = transfers.get(transferId);
    if (!existing) return res.status(404).json({ error: 'Transfer not found', code: 'TRANSFER_NOT_FOUND' });
    if (status === 'COMPLETED' && (existing.stage !== 'PAYOUT_PROCESSING' || !existing.providerTransactionId)) return res.status(409).json({ error: 'Payout must be processing before it can be delivered', code: 'INVALID_TRANSFER_STATE' });
    if (status === 'COMPLETED' && memoryCompliance.get(transferId)?.status !== 'CLEAR') return res.status(409).json({ error: 'Compliance clearance is required before delivery', code: 'COMPLIANCE_REQUIRED' });
    if (status === 'FAILED' && existing.stage === 'PAYOUT_PROCESSING') await fundingRepository.releaseWalletForTransfer(existing.userId, existing.id, existing.totalCharged);
    const updated: Transfer & { userId: string } = { ...existing, status, stage: status === 'COMPLETED' ? 'DELIVERED' : 'FAILED', failureCode: status === 'FAILED' ? 'MOCK_PAYOUT_FAILED' : existing.failureCode, completedAt: status === 'COMPLETED' ? new Date().toISOString() : existing.completedAt };
    transfers.set(transferId, updated);
    await recordAudit(req.userId, `TRANSFER_${status}`, 'Transfer', transferId);
    return res.json({ transfer: publicTransfer(updated) });
  });

  app.use((_req, res) => res.status(404).json({ error: 'Not found', code: 'NOT_FOUND' }));
  app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
    void next;
    if (error instanceof ZodError) {
      res.status(400).json({ error: 'Validation failed', code: 'VALIDATION_ERROR', details: error.issues });
      return;
    }
    if (error instanceof FundingError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof PayoutError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof KycError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof FxError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof MobileTopUpError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof SecurityError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof AdminOperationError) {
      res.status(error.statusCode).json({ error: error.message, code: error.code });
      return;
    }
    console.error('Unexpected API error', { name: error instanceof Error ? error.name : 'UnknownError' });
    res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' });
  });
  return app;
}
