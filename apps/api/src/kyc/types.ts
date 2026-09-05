export type KycStatus =
  | 'NOT_STARTED'
  | 'PENDING'
  | 'IN_REVIEW'
  | 'APPROVED'
  | 'DECLINED'
  | 'EXPIRED';

export interface DiditConfig {
  enabled: boolean;
  apiKey?: string;
  webhookSecret?: string;
  workflowId?: string;
  baseUrl: string;
}

export interface KycUserRecord {
  userId: string;
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  status: KycStatus;
  diditSessionId?: string;
  kycStartedAt?: string;
  kycVerifiedAt?: string;
  kycFailureReason?: string;
  diditStatusUpdatedAt?: string;
}

export interface DiditSession {
  sessionId: string;
  sessionToken: string;
  status: string;
}

export interface DiditDecision {
  sessionId: string;
  status: string;
}

export interface DiditProvider {
  createSession(input: {
    workflowId: string;
    vendorData: string;
  }): Promise<DiditSession>;
  getDecision(sessionId: string): Promise<DiditDecision>;
}

export interface DiditWebhookEvent {
  eventId: string;
  webhookType: string;
  timestamp: number;
  createdAt: number;
  sessionId?: string;
  sessionKind?: string;
  vendorData?: string;
  status: string;
}

export class KycError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'KycError';
  }
}

export function mapDiditStatus(status: string): KycStatus {
  switch (status.trim().toLowerCase().replaceAll('_', ' ')) {
    case 'not started':
    case 'in progress':
    case 'awaiting user':
    case 'resubmitted':
      return 'PENDING';
    case 'in review':
      return 'IN_REVIEW';
    case 'approved':
      return 'APPROVED';
    case 'declined':
      return 'DECLINED';
    case 'expired':
    case 'abandoned':
    case 'kyc expired':
      return 'EXPIRED';
    default:
      throw new KycError('UNKNOWN_DIDIT_STATUS', 'Didit returned an unknown verification status', 502);
  }
}

export function failureReasonFor(status: KycStatus): string | undefined {
  if (status === 'DECLINED') return 'DIDIT_DECLINED';
  if (status === 'EXPIRED') return 'DIDIT_EXPIRED';
  return undefined;
}
