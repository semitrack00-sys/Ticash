import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp, resetStore } from '../src/app.js';
import type { DiditConfig, DiditProvider } from '../src/kyc/types.js';

const enabledConfig: DiditConfig = {
  enabled: true,
  apiKey: 'didit-test-key',
  webhookSecret: 'didit-webhook-test-secret',
  workflowId: '86ca1503-70df-4a85-8ac4-f3e13f319020',
  baseUrl: 'https://verification.didit.test',
};

const disabledConfig: DiditConfig = {
  enabled: false,
  baseUrl: 'https://verification.didit.me',
};

const account = {
  email: 'kyc-user@example.com',
  password: 'correct-horse-42',
  firstName: 'Ti',
  lastName: 'Cash',
};

class MockDiditProvider implements DiditProvider {
  sessionCalls = 0;
  decisionStatus = 'In Progress';
  readonly sessionId = 'f5faccee-7e82-41ff-bcbc-e8016f520cf8';

  async createSession(input: { workflowId: string; vendorData: string }) {
    expect(input.workflowId).toBe(enabledConfig.workflowId);
    expect(input.vendorData).toBeTruthy();
    this.sessionCalls += 1;
    return {
      sessionId: this.sessionId,
      sessionToken: 'ephemeral-session-token',
      status: 'Not Started',
    };
  }

  async getDecision(sessionId: string) {
    return { sessionId, status: this.decisionStatus };
  }
}

async function registeredUser(app: ReturnType<typeof createApp>) {
  const response = await request(app).post('/api/auth/register').send(account).expect(201);
  return {
    userId: response.body.user.id as string,
    auth: { Authorization: `Bearer ${response.body.accessToken}` },
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>).sort().reduce<Record<string, unknown>>(
      (result, key) => {
        result[key] = canonical((value as Record<string, unknown>)[key]);
        return result;
      },
      {},
    );
  }
  return value;
}

function signedWebhook(body: Record<string, unknown>) {
  const timestamp = body.timestamp as number;
  const signature = createHmac('sha256', enabledConfig.webhookSecret!)
    .update(JSON.stringify(canonical(body)), 'utf8')
    .digest('hex');
  return { timestamp: String(timestamp), signature };
}

async function startSession(app: ReturnType<typeof createApp>, provider: MockDiditProvider) {
  const user = await registeredUser(app);
  const session = await request(app).post('/api/kyc/session').set(user.auth).send({}).expect(201);
  expect(session.body.sessionId).toBe(provider.sessionId);
  expect(session.body.sessionToken).toBe('ephemeral-session-token');
  expect(session.body.apiKey).toBeUndefined();
  return user;
}

function deliverStatus(input: {
  app: ReturnType<typeof createApp>;
  userId: string;
  sessionId: string;
  eventId: string;
  status: string;
  signature?: string;
}) {
  const timestamp = Math.floor(Date.now() / 1000);
  const body = {
    event_id: input.eventId,
    webhook_type: 'status.updated',
    timestamp,
    created_at: timestamp,
    application_id: '34f4cfd7-c47a-4a77-9e0e-bdf3815b0048',
    environment: 'sandbox',
    session_id: input.sessionId,
    status: input.status,
    workflow_id: enabledConfig.workflowId,
    vendor_data: input.userId,
  };
  const signed = signedWebhook(body);
  return request(input.app)
    .post('/api/webhooks/didit')
    .set('Content-Type', 'application/json')
    .set('X-Timestamp', signed.timestamp)
    .set('X-Signature-V2', input.signature ?? signed.signature)
    .send(JSON.stringify(body));
}

describe('Didit KYC integration', () => {
  beforeEach(resetStore);

  it('creates an authenticated backend session and safely reuses Didit vendor idempotency', async () => {
    const provider = new MockDiditProvider();
    const app = createApp({ diditConfig: enabledConfig, diditProvider: provider });
    await request(app).post('/api/kyc/session').send({}).expect(401);
    const user = await startSession(app, provider);
    const duplicate = await request(app).post('/api/kyc/session').set(user.auth).send({}).expect(201);
    expect(duplicate.body.sessionId).toBe(provider.sessionId);
    expect(provider.sessionCalls).toBe(2);
    const status = await request(app).get('/api/kyc/status').set(user.auth).expect(200);
    expect(status.body.status).toBe('PENDING');
  });

  it('returns a controlled response while Didit is disabled', async () => {
    const app = createApp({ diditConfig: disabledConfig });
    const user = await registeredUser(app);
    const response = await request(app).post('/api/kyc/session').set(user.auth).send({}).expect(503);
    expect(response.body.code).toBe('KYC_DISABLED');
  });

  it.each([
    ['Approved', 'APPROVED'],
    ['Declined', 'DECLINED'],
    ['In Review', 'IN_REVIEW'],
  ])('applies signed %s status as %s', async (diditStatus, expectedStatus) => {
    const provider = new MockDiditProvider();
    const app = createApp({ diditConfig: enabledConfig, diditProvider: provider });
    const user = await startSession(app, provider);
    await deliverStatus({
      app,
      userId: user.userId,
      sessionId: provider.sessionId,
      eventId: randomUUID(),
      status: diditStatus,
    }).expect(200);
    const current = await request(app).get('/api/kyc/status').set(user.auth).expect(200);
    expect(current.body.status).toBe(expectedStatus);
    if (expectedStatus === 'APPROVED') expect(current.body.verifiedAt).toBeTruthy();
    if (expectedStatus === 'DECLINED') expect(current.body.failureReason).toBe('DIDIT_DECLINED');
  });

  it('rejects invalid, stale, and malformed webhooks', async () => {
    const provider = new MockDiditProvider();
    const app = createApp({ diditConfig: enabledConfig, diditProvider: provider });
    const user = await startSession(app, provider);
    await deliverStatus({
      app,
      userId: user.userId,
      sessionId: provider.sessionId,
      eventId: randomUUID(),
      status: 'Approved',
      signature: '0'.repeat(64),
    }).expect(401);

    const staleTimestamp = Math.floor(Date.now() / 1000) - 301;
    const staleBody = {
      event_id: randomUUID(), webhook_type: 'status.updated', timestamp: staleTimestamp,
      created_at: staleTimestamp, session_id: provider.sessionId, status: 'Approved',
      vendor_data: user.userId,
    };
    const staleSigned = signedWebhook(staleBody);
    await request(app).post('/api/webhooks/didit')
      .set('Content-Type', 'application/json')
      .set('X-Timestamp', staleSigned.timestamp)
      .set('X-Signature-V2', staleSigned.signature)
      .send(JSON.stringify(staleBody)).expect(401);

    await request(app).post('/api/webhooks/didit')
      .set('Content-Type', 'application/json')
      .set('X-Timestamp', String(Math.floor(Date.now() / 1000)))
      .set('X-Signature', '0'.repeat(64))
      .send('{not-json').expect(400);
  });

  it('processes a repeated webhook event only once', async () => {
    const provider = new MockDiditProvider();
    const app = createApp({ diditConfig: enabledConfig, diditProvider: provider });
    const user = await startSession(app, provider);
    const eventId = randomUUID();
    const first = await deliverStatus({
      app, userId: user.userId, sessionId: provider.sessionId, eventId, status: 'Approved',
    }).expect(200);
    const duplicate = await deliverStatus({
      app, userId: user.userId, sessionId: provider.sessionId, eventId, status: 'Approved',
    }).expect(200);
    expect(first.body.applied).toBe(true);
    expect(duplicate.body.duplicate).toBe(true);
    expect(duplicate.body.applied).toBe(false);
  });

  it('refreshes status through Didit server-side and never trusts a phone-supplied status', async () => {
    const provider = new MockDiditProvider();
    provider.decisionStatus = 'Approved';
    const app = createApp({ diditConfig: enabledConfig, diditProvider: provider });
    const user = await startSession(app, provider);
    const refreshed = await request(app)
      .get('/api/kyc/status?refresh=true&status=Approved')
      .set(user.auth)
      .expect(200);
    expect(refreshed.body.status).toBe('APPROVED');
  });

  it('blocks transfer quotes until the backend-authoritative KYC state is approved', async () => {
    const provider = new MockDiditProvider();
    const app = createApp({ diditConfig: enabledConfig, diditProvider: provider });
    const user = await startSession(app, provider);
    const response = await request(app).post('/api/transfers/quote').set(user.auth).send({
      recipient: {
        fullName: 'Jean Recipient', country: 'HT', phoneNumber: '+50937123456',
        address: '12 Rue Capois', city: 'Port-au-Prince', department: 'Ouest',
        payoutMethod: 'MONCASH',
      },
      amount: 100, sourceCurrency: 'USD', targetCurrency: 'HTG',
    }).expect(403);
    expect(response.body.code).toBe('KYC_REQUIRED');
  });
});
