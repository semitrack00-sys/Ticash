import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import type { KycStatus, KycUserRecord } from './types.js';
import { KycError, failureReasonFor } from './types.js';

export interface KycWebhookReservation {
  duplicate: boolean;
  eventId: string;
}

export interface KycRepository {
  getUser(userId: string): Promise<KycUserRecord | undefined>;
  saveSession(userId: string, sessionId: string, status: KycStatus): Promise<KycUserRecord>;
  applyProviderStatus(input: {
    sessionId: string;
    vendorData?: string;
    status: KycStatus;
    providerUpdatedAt: string;
  }): Promise<KycUserRecord | undefined>;
  reserveWebhook(input: {
    providerEventId: string;
    webhookType: string;
    sessionId?: string;
    payloadHash: string;
  }): Promise<KycWebhookReservation>;
  completeWebhook(eventId: string): Promise<void>;
  failWebhook(eventId: string, errorCode: string): Promise<void>;
}

type MemoryProfile = {
  diditSessionId?: string;
  kycStartedAt?: string;
  kycVerifiedAt?: string;
  kycFailureReason?: string;
  diditStatusUpdatedAt?: string;
};

const memoryProfiles = new Map<string, MemoryProfile>();
const memoryWebhookEvents = new Map<string, {
  id: string;
  status: string;
  payloadHash: string;
}>();

export function resetKycStore(): void {
  memoryProfiles.clear();
  memoryWebhookEvents.clear();
}

export class MemoryKycRepository implements KycRepository {
  constructor(
    private readonly readUser: (userId: string) => KycUserRecord | undefined,
    private readonly writeStatus: (userId: string, status: KycStatus) => void,
  ) {}

  async getUser(userId: string): Promise<KycUserRecord | undefined> {
    const user = this.readUser(userId);
    return user ? { ...user, ...memoryProfiles.get(userId) } : undefined;
  }

  async saveSession(userId: string, sessionId: string, status: KycStatus): Promise<KycUserRecord> {
    const user = this.readUser(userId);
    if (!user) throw new KycError('USER_NOT_FOUND', 'User was not found', 404);
    const owner = [...memoryProfiles.entries()].find(
      ([candidateId, profile]) => candidateId !== userId && profile.diditSessionId === sessionId,
    );
    if (owner) throw new KycError('KYC_SESSION_CONFLICT', 'Verification session is already assigned', 409);
    const now = new Date().toISOString();
    memoryProfiles.set(userId, {
      diditSessionId: sessionId,
      kycStartedAt: now,
    });
    this.writeStatus(userId, status);
    return (await this.getUser(userId))!;
  }

  async applyProviderStatus(input: {
    sessionId: string;
    vendorData?: string;
    status: KycStatus;
    providerUpdatedAt: string;
  }): Promise<KycUserRecord | undefined> {
    const entry = [...memoryProfiles.entries()].find(
      ([, profile]) => profile.diditSessionId === input.sessionId,
    );
    if (!entry) return undefined;
    const [userId, profile] = entry;
    if (input.vendorData && input.vendorData !== userId) {
      throw new KycError('KYC_VENDOR_MISMATCH', 'Verification session ownership does not match', 409);
    }
    if (profile.diditStatusUpdatedAt &&
        new Date(input.providerUpdatedAt).getTime() <= new Date(profile.diditStatusUpdatedAt).getTime()) {
      return this.getUser(userId);
    }
    const updated: MemoryProfile = {
      ...profile,
      diditStatusUpdatedAt: input.providerUpdatedAt,
      kycVerifiedAt: input.status === 'APPROVED'
        ? profile.kycVerifiedAt ?? input.providerUpdatedAt
        : undefined,
      kycFailureReason: failureReasonFor(input.status),
    };
    memoryProfiles.set(userId, updated);
    this.writeStatus(userId, input.status);
    return this.getUser(userId);
  }

  async reserveWebhook(input: {
    providerEventId: string; webhookType: string; sessionId?: string; payloadHash: string;
  }): Promise<KycWebhookReservation> {
    void input.webhookType;
    void input.sessionId;
    const existing = memoryWebhookEvents.get(input.providerEventId);
    if (existing) {
      if (existing.payloadHash !== input.payloadHash) {
        throw new KycError(
          'KYC_WEBHOOK_EVENT_CONFLICT',
          'Webhook event ID was reused with a different payload',
          409,
        );
      }
      if (existing.status === 'FAILED') {
        memoryWebhookEvents.set(input.providerEventId, { ...existing, status: 'PROCESSING' });
        return { duplicate: false, eventId: existing.id };
      }
      return { duplicate: true, eventId: existing.id };
    }
    const event = { id: randomUUID(), status: 'PROCESSING', payloadHash: input.payloadHash };
    memoryWebhookEvents.set(input.providerEventId, event);
    return { duplicate: false, eventId: event.id };
  }

  async completeWebhook(eventId: string): Promise<void> {
    for (const [providerEventId, event] of memoryWebhookEvents) {
      if (event.id === eventId) {
        memoryWebhookEvents.set(providerEventId, { ...event, status: 'PROCESSED' });
      }
    }
  }

  async failWebhook(eventId: string, _errorCode: string): Promise<void> {
    void _errorCode;
    for (const [providerEventId, event] of memoryWebhookEvents) {
      if (event.id === eventId) {
        memoryWebhookEvents.set(providerEventId, { ...event, status: 'FAILED' });
      }
    }
  }
}

function recordFromDb(user: {
  id: string;
  email: string;
  phone: string | null;
  firstName: string | null;
  lastName: string | null;
  kycStatus: string;
  kycProfile: {
    diditSessionId: string | null;
    kycStartedAt: Date | null;
    kycVerifiedAt: Date | null;
    kycFailureReason: string | null;
    diditStatusUpdatedAt: Date | null;
  } | null;
}): KycUserRecord {
  const normalizedStatus = user.kycStatus === 'REJECTED'
    ? 'DECLINED'
    : user.kycStatus === 'REVIEW_REQUIRED'
      ? 'IN_REVIEW'
      : user.kycStatus;
  return {
    userId: user.id,
    email: user.email,
    phone: user.phone ?? undefined,
    firstName: user.firstName ?? undefined,
    lastName: user.lastName ?? undefined,
    status: normalizedStatus as KycStatus,
    diditSessionId: user.kycProfile?.diditSessionId ?? undefined,
    kycStartedAt: user.kycProfile?.kycStartedAt?.toISOString(),
    kycVerifiedAt: user.kycProfile?.kycVerifiedAt?.toISOString(),
    kycFailureReason: user.kycProfile?.kycFailureReason ?? undefined,
    diditStatusUpdatedAt: user.kycProfile?.diditStatusUpdatedAt?.toISOString(),
  };
}

export class PrismaKycRepository implements KycRepository {
  constructor(private readonly client: PrismaClient) {}

  async getUser(userId: string): Promise<KycUserRecord | undefined> {
    const user = await this.client.user.findUnique({
      where: { id: userId },
      include: { kycProfile: true },
    });
    return user ? recordFromDb(user) : undefined;
  }

  async saveSession(userId: string, sessionId: string, status: KycStatus): Promise<KycUserRecord> {
    const now = new Date();
    try {
      const user = await this.client.$transaction(async (transaction) => {
        await transaction.kycProfile.upsert({
          where: { userId },
          update: {
            status,
            diditSessionId: sessionId,
            kycStartedAt: now,
            kycVerifiedAt: null,
            kycFailureReason: null,
            diditStatusUpdatedAt: null,
            submittedAt: now,
            reviewedAt: null,
          },
          create: {
            userId,
            status,
            diditSessionId: sessionId,
            kycStartedAt: now,
            submittedAt: now,
          },
        });
        return transaction.user.update({
          where: { id: userId },
          data: { kycStatus: status },
          include: { kycProfile: true },
        });
      });
      return recordFromDb(user);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new KycError('KYC_SESSION_CONFLICT', 'Verification session is already assigned', 409);
      }
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new KycError('USER_NOT_FOUND', 'User was not found', 404);
      }
      throw error;
    }
  }

  async applyProviderStatus(input: {
    sessionId: string;
    vendorData?: string;
    status: KycStatus;
    providerUpdatedAt: string;
  }): Promise<KycUserRecord | undefined> {
    const profile = await this.client.kycProfile.findUnique({
      where: { diditSessionId: input.sessionId },
    });
    if (!profile) return undefined;
    if (input.vendorData && input.vendorData !== profile.userId) {
      throw new KycError('KYC_VENDOR_MISMATCH', 'Verification session ownership does not match', 409);
    }
    const providerUpdatedAt = new Date(input.providerUpdatedAt);
    if (profile.diditStatusUpdatedAt && providerUpdatedAt <= profile.diditStatusUpdatedAt) {
      return this.getUser(profile.userId);
    }
    const verifiedAt = input.status === 'APPROVED'
      ? profile.kycVerifiedAt ?? providerUpdatedAt
      : null;
    const reviewedAt = ['APPROVED', 'DECLINED', 'IN_REVIEW'].includes(input.status)
      ? providerUpdatedAt
      : null;
    const user = await this.client.$transaction(async (transaction) => {
      const result = await transaction.kycProfile.updateMany({
        where: {
          id: profile.id,
          OR: [
            { diditStatusUpdatedAt: null },
            { diditStatusUpdatedAt: { lt: providerUpdatedAt } },
          ],
        },
        data: {
          status: input.status,
          kycVerifiedAt: verifiedAt,
          kycFailureReason: failureReasonFor(input.status) ?? null,
          diditStatusUpdatedAt: providerUpdatedAt,
          reviewedAt,
        },
      });
      if (result.count === 0) {
        return transaction.user.findUnique({
          where: { id: profile.userId },
          include: { kycProfile: true },
        });
      }
      return transaction.user.update({
        where: { id: profile.userId },
        data: { kycStatus: input.status },
        include: { kycProfile: true },
      });
    });
    return user ? recordFromDb(user) : undefined;
  }

  async reserveWebhook(input: {
    providerEventId: string; webhookType: string; sessionId?: string; payloadHash: string;
  }): Promise<KycWebhookReservation> {
    try {
      const event = await this.client.kycWebhookEvent.create({
        data: {
          providerEventId: input.providerEventId,
          webhookType: input.webhookType,
          diditSessionId: input.sessionId,
          payloadHash: input.payloadHash,
        },
      });
      return { duplicate: false, eventId: event.id };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const event = await this.client.kycWebhookEvent.findUnique({
          where: { providerEventId: input.providerEventId },
          select: { id: true, status: true, payloadHash: true },
        });
        if (event) {
          await this.client.kycWebhookEvent.update({
            where: { id: event.id },
            data: {
              duplicateDeliveryCount: { increment: 1 },
              lastReceivedAt: new Date(),
            },
          });
          if (event.payloadHash !== input.payloadHash) {
            throw new KycError(
              'KYC_WEBHOOK_EVENT_CONFLICT',
              'Webhook event ID was reused with a different payload',
              409,
            );
          }
          if (event.status === 'FAILED') {
            const retry = await this.client.kycWebhookEvent.updateMany({
              where: { id: event.id, status: 'FAILED' },
              data: { status: 'PROCESSING', errorCode: null, processedAt: null },
            });
            if (retry.count === 1) return { duplicate: false, eventId: event.id };
          }
          return { duplicate: true, eventId: event.id };
        }
      }
      throw error;
    }
  }

  async completeWebhook(eventId: string): Promise<void> {
    await this.client.kycWebhookEvent.update({
      where: { id: eventId },
      data: { status: 'PROCESSED', processedAt: new Date(), errorCode: null },
    });
  }

  async failWebhook(eventId: string, errorCode: string): Promise<void> {
    await this.client.kycWebhookEvent.update({
      where: { id: eventId },
      data: { status: 'FAILED', processedAt: new Date(), errorCode },
    });
  }
}
