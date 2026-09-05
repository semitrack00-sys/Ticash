import { describe, expect, it } from 'vitest';
import { MemoryKycRepository, resetKycStore } from '../src/kyc/repository.js';
import type { KycStatus, KycUserRecord } from '../src/kyc/types.js';

function createRepository() {
  let status: KycStatus = 'NOT_STARTED';
  const user: Omit<KycUserRecord, 'status'> = {
    userId: 'user-1',
    email: 'driver@example.com',
  };
  return {
    get status() { return status; },
    repository: new MemoryKycRepository(
      (userId) => userId === user.userId ? { ...user, status } : undefined,
      (_userId, nextStatus) => { status = nextStatus; },
    ),
  };
}

describe('Didit KYC repository protections', () => {
  it('retries a failed webhook but does not reprocess a completed webhook', async () => {
    resetKycStore();
    const { repository } = createRepository();
    const input = {
      providerEventId: 'event-1',
      webhookType: 'status.updated',
      sessionId: 'session-1',
      payloadHash: 'hash-1',
    };

    const first = await repository.reserveWebhook(input);
    expect(first.duplicate).toBe(false);
    await repository.failWebhook(first.eventId, 'TRANSIENT_FAILURE');

    const retry = await repository.reserveWebhook(input);
    expect(retry).toEqual({ duplicate: false, eventId: first.eventId });
    await repository.completeWebhook(retry.eventId);

    await expect(repository.reserveWebhook(input)).resolves.toEqual({
      duplicate: true,
      eventId: first.eventId,
    });
  });

  it('rejects event ID reuse with a different payload', async () => {
    resetKycStore();
    const { repository } = createRepository();
    await repository.reserveWebhook({
      providerEventId: 'event-1',
      webhookType: 'status.updated',
      sessionId: 'session-1',
      payloadHash: 'hash-1',
    });

    await expect(repository.reserveWebhook({
      providerEventId: 'event-1',
      webhookType: 'status.updated',
      sessionId: 'session-1',
      payloadHash: 'hash-2',
    })).rejects.toMatchObject({ code: 'KYC_WEBHOOK_EVENT_CONFLICT', statusCode: 409 });
  });

  it('ignores provider decisions older than the latest applied status', async () => {
    resetKycStore();
    const state = createRepository();
    await state.repository.saveSession('user-1', 'session-1', 'PENDING');
    await state.repository.applyProviderStatus({
      sessionId: 'session-1',
      vendorData: 'user-1',
      status: 'APPROVED',
      providerUpdatedAt: '2026-09-04T12:00:00.000Z',
    });
    await state.repository.applyProviderStatus({
      sessionId: 'session-1',
      vendorData: 'user-1',
      status: 'DECLINED',
      providerUpdatedAt: '2026-09-04T11:59:59.000Z',
    });

    expect(state.status).toBe('APPROVED');
  });
});
