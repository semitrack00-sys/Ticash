import { z } from 'zod';
import type { DiditConfig, DiditDecision, DiditProvider, DiditSession } from './types.js';
import { KycError } from './types.js';

const sessionResponseSchema = z.object({
  session_id: z.string().uuid(),
  session_token: z.string().min(1),
  status: z.string().min(1),
});

const decisionResponseSchema = z.object({
  session_id: z.string().uuid().optional(),
  status: z.string().min(1),
});

export class DiditRestProvider implements DiditProvider {
  constructor(
    private readonly config: DiditConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!this.config.apiKey) {
      throw new KycError('KYC_CONFIGURATION_ERROR', 'Didit credentials are unavailable', 503);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/json',
          'x-api-key': this.config.apiKey,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(15_000),
      });
    } catch {
      throw new KycError('DIDIT_UNAVAILABLE', 'Identity verification is temporarily unavailable', 502);
    }
    const body = await response.json().catch(() => undefined) as unknown;
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        throw new KycError('DIDIT_AUTHENTICATION_FAILED', 'Identity verification is not configured correctly', 503);
      }
      if (response.status === 429) {
        throw new KycError('DIDIT_RATE_LIMITED', 'Identity verification is busy; please try again later', 503);
      }
      throw new KycError(
        'DIDIT_REQUEST_FAILED',
        response.status >= 500
          ? 'Identity verification is temporarily unavailable'
          : 'Identity verification could not be started',
        response.status >= 500 ? 502 : 400,
      );
    }
    return body;
  }

  async createSession(input: { workflowId: string; vendorData: string }): Promise<DiditSession> {
    const body = sessionResponseSchema.parse(await this.request('/v3/session/', {
      method: 'POST',
      body: JSON.stringify({
        workflow_id: input.workflowId,
        vendor_data: input.vendorData,
      }),
    }));
    return {
      sessionId: body.session_id,
      sessionToken: body.session_token,
      status: body.status,
    };
  }

  async getDecision(sessionId: string): Promise<DiditDecision> {
    const body = decisionResponseSchema.parse(
      await this.request(`/v3/session/${encodeURIComponent(sessionId)}/decision/`),
    );
    return { sessionId: body.session_id ?? sessionId, status: body.status };
  }
}
