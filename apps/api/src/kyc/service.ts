import type { DiditConfig, DiditProvider, DiditWebhookEvent, KycStatus } from './types.js';
import { KycError, mapDiditStatus } from './types.js';
import type { KycRepository } from './repository.js';

type AuditWriter = (
  userId: string | undefined,
  action: string,
  entity: string,
  entityId?: string,
) => Promise<void>;

export class KycService {
  constructor(
    readonly config: DiditConfig,
    private readonly repository: KycRepository,
    private readonly provider: DiditProvider | undefined,
    private readonly recordAudit: AuditWriter,
  ) {}

  availability() {
    return { enabled: this.config.enabled, provider: 'didit' as const };
  }

  private requireProvider(): { provider: DiditProvider; workflowId: string } {
    if (!this.config.enabled) {
      throw new KycError('KYC_DISABLED', 'Didit identity verification is disabled', 503);
    }
    if (!this.provider || !this.config.workflowId) {
      throw new KycError('KYC_CONFIGURATION_ERROR', 'Identity verification is unavailable', 503);
    }
    return { provider: this.provider, workflowId: this.config.workflowId };
  }

  async createSession(userId: string) {
    const { provider, workflowId } = this.requireProvider();
    const user = await this.repository.getUser(userId);
    if (!user) throw new KycError('USER_NOT_FOUND', 'User was not found', 404);
    if (user.status === 'APPROVED') {
      throw new KycError('KYC_ALREADY_APPROVED', 'Identity verification is already approved', 409);
    }
    const session = await provider.createSession({
      workflowId,
      vendorData: userId,
    });
    const status = mapDiditStatus(session.status);
    await this.repository.saveSession(userId, session.sessionId, status);
    await this.recordAudit(userId, 'KYC_SESSION_CREATED', 'KycProfile', session.sessionId);
    return {
      sessionId: session.sessionId,
      sessionToken: session.sessionToken,
      status,
    };
  }

  async getStatus(userId: string, refreshFromProvider = false) {
    let user = await this.repository.getUser(userId);
    if (!user) throw new KycError('USER_NOT_FOUND', 'User was not found', 404);
    if (refreshFromProvider && this.config.enabled && this.provider && user.diditSessionId &&
        user.status !== 'APPROVED') {
      const decision = await this.provider.getDecision(user.diditSessionId);
      if (decision.sessionId !== user.diditSessionId) {
        throw new KycError('DIDIT_SESSION_MISMATCH', 'Didit returned an unexpected session', 502);
      }
      user = await this.repository.applyProviderStatus({
        sessionId: decision.sessionId,
        vendorData: userId,
        status: mapDiditStatus(decision.status),
        providerUpdatedAt: new Date().toISOString(),
      }) ?? user;
    }
    return {
      status: user.status,
      startedAt: user.kycStartedAt,
      verifiedAt: user.kycVerifiedAt,
      failureReason: user.kycFailureReason,
    };
  }

  async processWebhook(event: DiditWebhookEvent, payloadHash: string) {
    const reservation = await this.repository.reserveWebhook({
      providerEventId: event.eventId,
      webhookType: event.webhookType,
      sessionId: event.sessionId,
      payloadHash,
    });
    if (reservation.duplicate) return { duplicate: true, applied: false };
    try {
      if (!['status.updated', 'data.updated'].includes(event.webhookType) ||
          event.sessionKind === 'business' || !event.sessionId) {
        await this.repository.completeWebhook(reservation.eventId);
        return { duplicate: false, applied: false };
      }
      const status: KycStatus = mapDiditStatus(event.status);
      const user = await this.repository.applyProviderStatus({
        sessionId: event.sessionId,
        vendorData: event.vendorData,
        status,
        providerUpdatedAt: new Date(event.createdAt * 1000).toISOString(),
      });
      await this.repository.completeWebhook(reservation.eventId);
      if (!user) return { duplicate: false, applied: false };
      await this.recordAudit(user.userId, `KYC_${status}`, 'KycProfile', event.sessionId);
      return { duplicate: false, applied: true };
    } catch (error) {
      const code = error instanceof KycError ? error.code : 'KYC_WEBHOOK_PROCESSING_FAILED';
      await this.repository.failWebhook(reservation.eventId, code);
      throw error;
    }
  }
}
