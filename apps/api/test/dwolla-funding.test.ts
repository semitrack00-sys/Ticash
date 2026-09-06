import { createHmac } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp, resetStore } from '../src/app.js';
import type {
  DwollaCustomerInput,
  DwollaFundingProvider,
  DwollaFundingSourceInput,
  DwollaTransfer,
  FundingConfig,
} from '../src/funding/types.js';
import { FundingError } from '../src/funding/types.js';
import { loadSecurityConfig } from '../src/security.js';

const enabledConfig: FundingConfig = {
  enabled: true,
  environment: 'sandbox',
  clientId: 'sandbox-client',
  clientSecret: 'sandbox-secret',
  webhookSecret: 'webhook-test-secret',
  masterFundingSourceUrl: 'https://api-sandbox.dwolla.com/funding-sources/master-destination',
  productionEnabled: false,
  liveFundingEnabled: false,
  approvedForLiveUse: false,
};

const disabledConfig: FundingConfig = {
  ...enabledConfig,
  enabled: false,
  clientId: undefined,
  clientSecret: undefined,
  webhookSecret: undefined,
  masterFundingSourceUrl: undefined,
};

class MockDwollaProvider implements DwollaFundingProvider {
  transferStatus = 'pending';
  transferCalls = 0;
  cancelCalls = 0;
  getTransferFailuresRemaining = 0;
  transferFailureCode: string | undefined;
  verificationFailuresRemaining = 0;
  private sourceCount = 0;
  private readonly sources = new Map<string, {
    id: string; url: string; name: string; bankName: string;
    bankAccountType: string; status: 'UNVERIFIED' | 'VERIFIED' | 'REMOVED';
  }>();

  async createCustomer(_input: DwollaCustomerInput) {
    void _input;
    return {
      id: 'customer-1',
      url: 'https://api-sandbox.dwolla.com/customers/customer-1',
      status: 'verified',
    };
  }

  async getCustomer(customerUrl: string) {
    return { id: 'customer-1', url: customerUrl, status: 'verified' };
  }

  async createFundingSource(input: DwollaFundingSourceInput) {
    this.sourceCount += 1;
    const source = {
      id: `source-${this.sourceCount}`,
      url: `https://api-sandbox.dwolla.com/funding-sources/source-${this.sourceCount}`,
      name: input.name,
      bankName: 'SANDBOX TEST BANK',
      bankAccountType: input.bankAccountType,
      status: 'UNVERIFIED' as const,
    };
    this.sources.set(source.id, source);
    return source;
  }

  async listFundingSources(_customerUrl: string) {
    void _customerUrl;
    return [...this.sources.values()].filter((source) => source.status !== 'REMOVED');
  }

  async getFundingSource(fundingSourceUrl: string) {
    const id = fundingSourceUrl.split('/').at(-1)!;
    const source = this.sources.get(id);
    if (!source) throw new FundingError('FUNDING_SOURCE_NOT_FOUND', 'Missing test source', 404);
    return source;
  }

  async removeFundingSource(fundingSourceUrl: string) {
    const source = await this.getFundingSource(fundingSourceUrl);
    const removed = { ...source, status: 'REMOVED' as const };
    this.sources.set(source.id, removed);
    return removed;
  }

  setSourceStatus(id: string, status: 'UNVERIFIED' | 'VERIFIED' | 'REMOVED') {
    const source = this.sources.get(id);
    if (!source) throw new Error(`Missing test source ${id}`);
    this.sources.set(id, { ...source, status });
  }

  async initiateMicroDeposits(_fundingSourceUrl: string) {
    void _fundingSourceUrl;
  }

  async verifyMicroDeposits(_fundingSourceUrl: string, _amount1: string, _amount2: string) {
    if (this.verificationFailuresRemaining > 0) {
      this.verificationFailuresRemaining -= 1;
      throw new FundingError('DWOLLA_VALIDATIONERROR', 'Dwolla rejected the request', 400);
    }
    const source = await this.getFundingSource(_fundingSourceUrl);
    void _amount1;
    void _amount2;
    const verified = { ...source, status: 'VERIFIED' as const };
    this.sources.set(source.id, verified);
    return verified;
  }

  async initiateTransfer(input: {
    sourceUrl: string; destinationUrl: string; amount: string; currency: 'USD';
    correlationId: string; idempotencyKey: string;
  }): Promise<DwollaTransfer> {
    void input;
    this.transferCalls += 1;
    return {
      id: 'transfer-1',
      url: 'https://api-sandbox.dwolla.com/transfers/transfer-1',
      status: this.transferStatus,
    };
  }

  async getTransfer(transferUrl: string) {
    if (this.getTransferFailuresRemaining > 0) {
      this.getTransferFailuresRemaining -= 1;
      throw new FundingError('DWOLLA_UNAVAILABLE', 'Temporary test failure', 502);
    }
    return {
      id: 'transfer-1',
      url: transferUrl,
      status: this.transferStatus,
      failureCode: this.transferFailureCode,
    };
  }

  async cancelTransfer(transferUrl: string) {
    this.cancelCalls += 1;
    this.transferStatus = 'cancelled';
    return { id: 'transfer-1', url: transferUrl, status: this.transferStatus };
  }
}

const account = {
  email: 'funding@example.com',
  password: 'correct-horse-42',
  firstName: 'Ti',
  lastName: 'Cash',
};

async function approvedUser(app: ReturnType<typeof createApp>) {
  const registered = await request(app).post('/api/auth/register').send(account).expect(201);
  const admin = await request(app).post('/api/auth/login').send({
    email: 'admin@ticash.local', password: 'AdminPass123!',
  }).expect(200);
  await request(app)
    .patch(`/api/admin/users/${registered.body.user.id}/kyc`)
    .set('Authorization', `Bearer ${admin.body.accessToken}`)
    .send({ status: 'APPROVED' })
    .expect(200);
  return { Authorization: `Bearer ${registered.body.accessToken}` };
}

async function verifiedFundingSource(
  app: ReturnType<typeof createApp>,
  auth: { Authorization: string },
) {
  await request(app).post('/api/funding/dwolla/customer').set(auth).send({}).expect(201);
  const source = await request(app).post('/api/funding/dwolla/funding-sources').set(auth).send({
    routingNumber: '222222226', accountNumber: '123456789', bankAccountType: 'checking',
    name: 'Sandbox checking',
  }).expect(201);
  expect(source.body.fundingSource.lastFour).toBe('6789');
  expect(source.body.fundingSource.accountNumber).toBeUndefined();
  const sourceId = source.body.fundingSource.id as string;
  await request(app)
    .post(`/api/funding/dwolla/funding-sources/${sourceId}/micro-deposits`)
    .set(auth).expect(202);
  await request(app)
    .post(`/api/funding/dwolla/funding-sources/${sourceId}/micro-deposits/verify`)
    .set(auth).send({ amount1: '0.01', amount2: '0.02' }).expect(200);
  return sourceId;
}

function webhookBody(id: string, topic = 'customer_bank_transfer_completed') {
  return JSON.stringify({
    id,
    topic,
    _links: { resource: { href: 'https://api-sandbox.dwolla.com/transfers/transfer-1' } },
  });
}

function fundingSourceWebhookBody(
  id: string,
  topic: string,
  providerSourceId: string,
  microDepositsResource = false,
) {
  const suffix = microDepositsResource ? '/micro-deposits' : '';
  return JSON.stringify({
    id,
    topic,
    _links: {
      resource: {
        href: `https://api-sandbox.dwolla.com/funding-sources/${providerSourceId}${suffix}`,
      },
    },
  });
}

function signature(body: string) {
  return createHmac('sha256', enabledConfig.webhookSecret!).update(body).digest('hex');
}

describe('Dwolla sandbox funding', () => {
  beforeEach(resetStore);

  it('keeps funding disabled without credentials and returns a controlled response', async () => {
    const app = createApp({ fundingConfig: disabledConfig });
    const registered = await request(app).post('/api/auth/register').send(account).expect(201);
    const auth = { Authorization: `Bearer ${registered.body.accessToken}` };
    const status = await request(app).get('/api/funding/status').set(auth).expect(200);
    expect(status.body.enabled).toBe(false);
    expect(status.body.liveMoneyEnabled).toBe(false);

    const admin = await request(app).post('/api/auth/login').send({
      email: 'admin@ticash.local', password: 'AdminPass123!',
    });
    await request(app).patch(`/api/admin/users/${registered.body.user.id}/kyc`)
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .send({ status: 'APPROVED' });
    const response = await request(app).post('/api/funding/dwolla/customer').set(auth).send({}).expect(503);
    expect(response.body.code).toBe('FUNDING_DISABLED');
  });

  it('requires authentication and server-approved KYC', async () => {
    const provider = new MockDwollaProvider();
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: provider });
    await request(app).get('/api/funding/status').expect(401);
    const registered = await request(app).post('/api/auth/register').send(account).expect(201);
    const response = await request(app).post('/api/funding/dwolla/customer')
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
      .send({}).expect(403);
    expect(response.body.code).toBe('KYC_REQUIRED');
  });

  it('validates bank input and only returns masked display metadata', async () => {
    const provider = new MockDwollaProvider();
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: provider });
    const auth = await approvedUser(app);
    await request(app).post('/api/funding/dwolla/customer').set(auth).send({}).expect(201);

    await request(app).post('/api/funding/dwolla/funding-sources').set(auth).send({
      routingNumber: '123', accountNumber: '1', bankAccountType: 'checking', name: 'Test User',
    }).expect(400);

    const created = await request(app).post('/api/funding/dwolla/funding-sources').set(auth).send({
      routingNumber: '222222226', accountNumber: '123456789', bankAccountType: 'checking',
      name: 'Test User',
    }).expect(201);
    expect(created.body.fundingSource).toMatchObject({
      bankName: 'SANDBOX TEST BANK', lastFour: '6789', bankAccountType: 'checking',
      status: 'PENDING', isDefault: false, verificationAttempts: 0,
    });
    expect(JSON.stringify(created.body)).not.toContain('222222226');
    expect(JSON.stringify(created.body)).not.toContain('123456789');

    const listed = await request(app).get('/api/funding/dwolla/funding-sources').set(auth).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain('222222226');
    expect(JSON.stringify(listed.body)).not.toContain('123456789');
  });

  it('handles pending, failed and successful micro-deposit verification safely', async () => {
    const provider = new MockDwollaProvider();
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: provider });
    const auth = await approvedUser(app);
    await request(app).post('/api/funding/dwolla/customer').set(auth).send({}).expect(201);
    const createSource = async (name: string) => request(app)
      .post('/api/funding/dwolla/funding-sources').set(auth).send({
        routingNumber: '222222226', accountNumber: '123456789', bankAccountType: 'savings', name,
      }).expect(201);

    const failedSource = await createSource('Failed verification');
    const failedId = failedSource.body.fundingSource.id as string;
    await request(app).post(`/api/funding/dwolla/funding-sources/${failedId}/micro-deposits`)
      .set(auth).expect(202);
    await request(app).post(`/api/funding/dwolla/funding-sources/${failedId}/micro-deposits`)
      .set(auth).expect(200);
    provider.verificationFailuresRemaining = 3;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await request(app).post(`/api/funding/dwolla/funding-sources/${failedId}/micro-deposits/verify`)
        .set(auth).send({ amount1: '0.01', amount2: '0.02' }).expect(400);
    }
    const exhausted = await request(app)
      .post(`/api/funding/dwolla/funding-sources/${failedId}/micro-deposits/verify`)
      .set(auth).send({ amount1: '0.01', amount2: '0.02' }).expect(429);
    expect(exhausted.body.code).toBe('MICRO_DEPOSIT_ATTEMPTS_EXCEEDED');

    const verifiedSource = await createSource('Verified source');
    const verifiedId = verifiedSource.body.fundingSource.id as string;
    await request(app).post(`/api/funding/dwolla/funding-sources/${verifiedId}/micro-deposits`)
      .set(auth).expect(202);
    const verified = await request(app)
      .post(`/api/funding/dwolla/funding-sources/${verifiedId}/micro-deposits/verify`)
      .set(auth).send({ amount1: '0.03', amount2: '0.09' }).expect(200);
    expect(verified.body.fundingSource).toMatchObject({ status: 'VERIFIED', isDefault: true });
    const duplicate = await request(app)
      .post(`/api/funding/dwolla/funding-sources/${verifiedId}/micro-deposits/verify`)
      .set(auth).send({ amount1: '0.03', amount2: '0.09' }).expect(200);
    expect(duplicate.body.fundingSource.verificationAttempts).toBe(1);
  });

  it('sets a verified default, removes it, and prevents removed-bank funding', async () => {
    const provider = new MockDwollaProvider();
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: provider });
    const auth = await approvedUser(app);
    const fundingSourceId = await verifiedFundingSource(app, auth);

    const selected = await request(app)
      .put(`/api/funding/dwolla/funding-sources/${fundingSourceId}/default`)
      .set(auth).expect(200);
    expect(selected.body.fundingSource.isDefault).toBe(true);
    await request(app).delete(`/api/funding/dwolla/funding-sources/${fundingSourceId}`)
      .set(auth).expect(200);
    const listed = await request(app).get('/api/funding/dwolla/funding-sources').set(auth).expect(200);
    expect(listed.body.fundingSources).toEqual([]);
    const blocked = await request(app).post('/api/funding/dwolla/transfers')
      .set(auth).set('Idempotency-Key', 'removed-bank-funding')
      .send({ fundingSourceId, amount: 10, currency: 'USD' }).expect(409);
    expect(blocked.body.code).toBe('FUNDING_SOURCE_REMOVED');
  });

  it('applies provider-authoritative funding-source webhook states idempotently', async () => {
    const provider = new MockDwollaProvider();
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: provider });
    const auth = await approvedUser(app);
    await request(app).post('/api/funding/dwolla/customer').set(auth).send({}).expect(201);
    const created = await request(app).post('/api/funding/dwolla/funding-sources').set(auth).send({
      routingNumber: '222222226', accountNumber: '123456789', bankAccountType: 'checking',
      name: 'Webhook bank',
    }).expect(201);
    const localSourceId = created.body.fundingSource.id as string;
    provider.setSourceStatus('source-1', 'VERIFIED');

    const verifiedBody = fundingSourceWebhookBody(
      'event-source-verified-1', 'customer_funding_source_verified', 'source-1',
    );
    await request(app).post('/api/webhooks/dwolla')
      .set('Content-Type', 'application/json')
      .set('X-Request-Signature-SHA-256', signature(verifiedBody)).send(verifiedBody).expect(200);
    const duplicate = await request(app).post('/api/webhooks/dwolla')
      .set('Content-Type', 'application/json')
      .set('X-Request-Signature-SHA-256', signature(verifiedBody)).send(verifiedBody).expect(200);
    expect(duplicate.body.duplicate).toBe(true);

    const listed = await request(app).get('/api/funding/dwolla/funding-sources')
      .set(auth).expect(200);
    expect(listed.body.fundingSources).toContainEqual(expect.objectContaining({
      id: localSourceId, status: 'VERIFIED', isDefault: true,
    }));
  });

  it('maps micro-deposit webhook resources to their parent funding source', async () => {
    const provider = new MockDwollaProvider();
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: provider });
    const auth = await approvedUser(app);
    await request(app).post('/api/funding/dwolla/customer').set(auth).send({}).expect(201);
    const created = await request(app).post('/api/funding/dwolla/funding-sources').set(auth).send({
      routingNumber: '222222226', accountNumber: '123456789', bankAccountType: 'savings',
      name: 'Failed micro deposits',
    }).expect(201);

    const failedBody = fundingSourceWebhookBody(
      'event-microdeposit-failed-1', 'customer_microdeposits_maxattempts', 'source-1', true,
    );
    await request(app).post('/api/webhooks/dwolla')
      .set('Content-Type', 'application/json')
      .set('X-Request-Signature-SHA-256', signature(failedBody)).send(failedBody).expect(200);

    const listed = await request(app).get('/api/funding/dwolla/funding-sources')
      .set(auth).expect(200);
    expect(listed.body.fundingSources).toContainEqual(expect.objectContaining({
      id: created.body.fundingSource.id,
      status: 'FAILED',
      isDefault: false,
    }));
  });

  it('creates a verified source and prevents duplicate ACH requests', async () => {
    const provider = new MockDwollaProvider();
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: provider });
    const auth = await approvedUser(app);
    const fundingSourceId = await verifiedFundingSource(app, auth);
    const input = { fundingSourceId, amount: 25, currency: 'USD' };
    const first = await request(app).post('/api/funding/dwolla/transfers')
      .set(auth).set('Idempotency-Key', 'ach-request-0001').send(input).expect(201);
    const replay = await request(app).post('/api/funding/dwolla/transfers')
      .set(auth).set('Idempotency-Key', 'ach-request-0001').send(input).expect(200);
    expect(first.body.transaction.status).toBe('PROCESSING');
    expect(replay.body.transaction.id).toBe(first.body.transaction.id);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(provider.transferCalls).toBe(1);

    const conflict = await request(app).post('/api/funding/dwolla/transfers')
      .set(auth).set('Idempotency-Key', 'ach-request-0001')
      .send({ ...input, amount: 26 }).expect(409);
    expect(conflict.body.code).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('rejects missing and unverified funding sources', async () => {
    const provider = new MockDwollaProvider();
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: provider });
    const auth = await approvedUser(app);
    const missing = await request(app).post('/api/funding/dwolla/transfers')
      .set(auth).set('Idempotency-Key', 'ach-request-0002')
      .send({ fundingSourceId: '0b6c52ff-691a-4cd9-932b-8c971789cdde', amount: 10, currency: 'USD' })
      .expect(404);
    expect(missing.body.code).toBe('FUNDING_SOURCE_NOT_FOUND');

    await request(app).post('/api/funding/dwolla/customer').set(auth).send({});
    const source = await request(app).post('/api/funding/dwolla/funding-sources').set(auth).send({
      routingNumber: '222222226', accountNumber: '123456789', bankAccountType: 'checking',
      name: 'Sandbox checking',
    });
    const unverified = await request(app).post('/api/funding/dwolla/transfers')
      .set(auth).set('Idempotency-Key', 'ach-request-0003')
      .send({ fundingSourceId: source.body.fundingSource.id, amount: 10, currency: 'USD' })
      .expect(409);
    expect(unverified.body.code).toBe('FUNDING_SOURCE_UNVERIFIED');
  });

  it('settles exactly once from a verified webhook and reverses the ledger safely', async () => {
    const provider = new MockDwollaProvider();
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: provider });
    const auth = await approvedUser(app);
    const fundingSourceId = await verifiedFundingSource(app, auth);
    const created = await request(app).post('/api/funding/dwolla/transfers')
      .set(auth).set('Idempotency-Key', 'ach-request-0004')
      .send({ fundingSourceId, amount: 75, currency: 'USD' }).expect(201);

    provider.transferStatus = 'processed';
    const body = webhookBody('event-settled-1');
    await request(app).post('/api/webhooks/dwolla')
      .set('Content-Type', 'application/json')
      .set('X-Request-Signature-SHA-256', signature(body)).send(body).expect(200);
    await request(app).post('/api/webhooks/dwolla')
      .set('Content-Type', 'application/json')
      .set('X-Request-Signature-SHA-256', signature(body)).send(body).expect(200);
    const balance = await request(app).get('/api/funding/wallet').set(auth).expect(200);
    expect(balance.body.balance).toEqual({ currency: 'USD', available: 75 });

    provider.transferStatus = 'failed';
    provider.transferFailureCode = 'R01';
    const reversedBody = webhookBody('event-reversed-1', 'customer_bank_transfer_failed');
    await request(app).post('/api/webhooks/dwolla')
      .set('Content-Type', 'application/json')
      .set('X-Request-Signature-SHA-256', signature(reversedBody)).send(reversedBody).expect(200);
    const reversed = await request(app).get('/api/funding/wallet').set(auth).expect(200);
    expect(reversed.body.balance.available).toBe(0);
    const transaction = await request(app)
      .get(`/api/funding/dwolla/transfers/${created.body.transaction.id}`)
      .set(auth).expect(200);
    expect(transaction.body.transaction).toMatchObject({ status: 'REVERSED', failureCode: 'R01' });
  });

  it('maps a failed ACH webhook without crediting the wallet', async () => {
    const provider = new MockDwollaProvider();
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: provider });
    const auth = await approvedUser(app);
    const fundingSourceId = await verifiedFundingSource(app, auth);
    const created = await request(app).post('/api/funding/dwolla/transfers')
      .set(auth).set('Idempotency-Key', 'ach-request-failed')
      .send({ fundingSourceId, amount: 40, currency: 'USD' }).expect(201);

    provider.transferStatus = 'failed';
    const body = webhookBody('event-failed-1');
    await request(app).post('/api/webhooks/dwolla')
      .set('Content-Type', 'application/json')
      .set('X-Request-Signature-SHA-256', signature(body)).send(body).expect(200);
    const transaction = await request(app)
      .get(`/api/funding/dwolla/transfers/${created.body.transaction.id}`)
      .set(auth).expect(200);
    expect(transaction.body.transaction.status).toBe('FAILED');
    const balance = await request(app).get('/api/funding/wallet').set(auth).expect(200);
    expect(balance.body.balance.available).toBe(0);
  });

  it('retries failed webhook processing and rejects an event ID reused with another payload', async () => {
    const provider = new MockDwollaProvider();
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: provider });
    const auth = await approvedUser(app);
    const fundingSourceId = await verifiedFundingSource(app, auth);
    await request(app).post('/api/funding/dwolla/transfers')
      .set(auth).set('Idempotency-Key', 'ach-request-webhook-retry')
      .send({ fundingSourceId, amount: 31, currency: 'USD' }).expect(201);

    provider.transferStatus = 'processed';
    provider.getTransferFailuresRemaining = 1;
    const body = webhookBody('event-retry-1');
    await request(app).post('/api/webhooks/dwolla')
      .set('Content-Type', 'application/json')
      .set('X-Request-Signature-SHA-256', signature(body)).send(body).expect(502);
    await request(app).post('/api/webhooks/dwolla')
      .set('Content-Type', 'application/json')
      .set('X-Request-Signature-SHA-256', signature(body)).send(body).expect(200);

    const balance = await request(app).get('/api/funding/wallet').set(auth).expect(200);
    expect(balance.body.balance.available).toBe(31);

    const conflicting = webhookBody('event-retry-1', 'customer_transfer_completed');
    const conflict = await request(app).post('/api/webhooks/dwolla')
      .set('Content-Type', 'application/json')
      .set('X-Request-Signature-SHA-256', signature(conflicting)).send(conflicting).expect(409);
    expect(conflict.body.code).toBe('WEBHOOK_EVENT_CONFLICT');
  });

  it('acknowledges signed Dwolla transfer events that are unrelated to a TiCash funding record', async () => {
    const provider = new MockDwollaProvider();
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: provider });
    const body = JSON.stringify({
      id: 'event-unrelated-1',
      topic: 'customer_bank_transfer_completed',
      _links: {
        resource: { href: 'https://api-sandbox.dwolla.com/transfers/unrelated-transfer' },
      },
    });
    const response = await request(app).post('/api/webhooks/dwolla')
      .set('Content-Type', 'application/json')
      .set('X-Request-Signature-SHA-256', signature(body)).send(body).expect(200);
    expect(response.body.ignored).toBe(true);
  });

  it('rejects invalid webhook signatures and supports cancellation', async () => {
    const provider = new MockDwollaProvider();
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: provider });
    const auth = await approvedUser(app);
    const fundingSourceId = await verifiedFundingSource(app, auth);
    const created = await request(app).post('/api/funding/dwolla/transfers')
      .set(auth).set('Idempotency-Key', 'ach-request-0005')
      .send({ fundingSourceId, amount: 12, currency: 'USD' }).expect(201);

    const body = webhookBody('event-invalid-signature');
    const invalid = await request(app).post('/api/webhooks/dwolla')
      .set('Content-Type', 'application/json')
      .set('X-Request-Signature-SHA-256', '0'.repeat(64)).send(body).expect(401);
    expect(invalid.body.code).toBe('INVALID_WEBHOOK_SIGNATURE');

    const cancelled = await request(app)
      .post(`/api/funding/dwolla/transfers/${created.body.transaction.id}/cancel`)
      .set(auth).expect(200);
    expect(cancelled.body.transaction.status).toBe('CANCELLED');
    expect(provider.cancelCalls).toBe(1);
  });

  it('exposes Haiti as the only receiving market and keeps live approval off', async () => {
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: new MockDwollaProvider() });
    const response = await request(app).get('/api/corridors').expect(200);
    expect(response.body.receivingMarkets).toEqual([{ country: 'HT', currencies: ['HTG'] }]);
    expect(response.body.corridors).toHaveLength(7);
    expect(response.body.corridors[0]).toMatchObject({
      sendCountry: 'US', receiveCountry: 'HT', sourceCurrency: 'USD', targetCurrency: 'HTG',
      approvedForLiveUse: false,
    });
    expect(response.body.corridors.map((item: { sourceCurrency: string }) => item.sourceCurrency))
      .toEqual(['USD', 'CAD', 'EUR', 'MXN', 'BRL', 'CLP', 'DOP']);
    expect(response.body.corridors.every((item: { receiveCountry: string; targetCurrency: string; approvedForLiveUse: boolean }) =>
      item.receiveCountry === 'HT' && item.targetCurrency === 'HTG' && item.approvedForLiveUse === false)).toBe(true);
  });

  it('runs the transfer through ACH pending, funding success, mock payout processing, and confirmed delivery', async () => {
    const provider = new MockDwollaProvider();
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: provider });
    const auth = await approvedUser(app);
    const fundingSourceId = await verifiedFundingSource(app, auth);
    const input = {
      recipient: { fullName: 'Jean Recipient', country: 'HT', phoneNumber: '+50937123456', address: '12 Rue Capois', city: 'Port-au-Prince', department: 'Ouest', payoutMethod: 'MONCASH' },
      amount: 25, amountCurrency: 'USD', sendCountry: 'US', sourceCurrency: 'USD', targetCurrency: 'HTG',
    };
    const quote = await request(app).post('/api/transfers/quote').set(auth).send(input).expect(200);
    const created = await request(app).post('/api/transfers').set(auth)
      .set('Idempotency-Key', 'send-flow-create-1').send({ ...input, quoteId: quote.body.quote.quoteId }).expect(201);
    expect(created.body.transfer.stage).toBe('AWAITING_FUNDING');

    const funding = await request(app).post(`/api/transfers/${created.body.transfer.id}/funding`).set(auth)
      .set('Idempotency-Key', 'send-flow-funding-1').send({ fundingSourceId }).expect(202);
    const pending = await request(app).get(`/api/transfers/${created.body.transfer.id}`).set(auth).expect(200);
    expect(pending.body.transfer.stage).toBe('FUNDING_PROCESSING');
    expect(pending.body.transfer.providerTransactionId).toBeUndefined();

    provider.transferStatus = 'processed';
    await request(app).get(`/api/funding/dwolla/transfers/${funding.body.transaction.id}?refresh=true`).set(auth).expect(200);
    const payingOut = await request(app).get(`/api/transfers/${created.body.transfer.id}`).set(auth).expect(200);
    expect(payingOut.body.transfer.stage).toBe('PAYOUT_PROCESSING');
    expect(payingOut.body.transfer.providerTransactionId).toMatch(/^mock-moncash-/);
    expect(payingOut.body.transfer.totalCharged).toBe(quote.body.quote.totalCustomerCharge);

    const admin = await request(app).post('/api/auth/login').send({ email: 'admin@ticash.local', password: 'AdminPass123!' }).expect(200);
    const delivered = await request(app).patch(`/api/admin/transfers/${created.body.transfer.id}/status`)
      .set('Authorization', `Bearer ${admin.body.accessToken}`).send({ status: 'COMPLETED' }).expect(200);
    expect(delivered.body.transfer).toMatchObject({ status: 'COMPLETED', stage: 'DELIVERED', recipientName: 'Jean Recipient', testMode: true });
    const history = await request(app).get('/api/transfers').set(auth).expect(200);
    expect(history.body.transfers[0].referenceNumber).toBe(created.body.transfer.referenceNumber);
  });

  it('holds provider-confirmed funding for compliance review until an authorized decision', async () => {
    const provider = new MockDwollaProvider();
    const securityConfig = loadSecurityConfig({
      LOGIN_MAX_FAILURES: '5', LOGIN_LOCK_MINUTES: '15', TRANSFER_LIMITS_ENABLED: 'false',
      SANDBOX_COMPLIANCE_AUTO_CLEAR: 'false', APPROVED_FOR_LIVE_USE: 'false', LIVE_MONEY_ENABLED: 'false',
    } as NodeJS.ProcessEnv);
    const app = createApp({ fundingConfig: enabledConfig, fundingProvider: provider, securityConfig });
    const auth = await approvedUser(app);
    const fundingSourceId = await verifiedFundingSource(app, auth);
    const input = {
      recipient: { fullName: 'Review Recipient', country: 'HT', phoneNumber: '+50936123456', address: '2 Rue Capois', city: 'Jacmel', department: 'Sud-Est', payoutMethod: 'MONCASH' },
      amount: 20, amountCurrency: 'USD', sendCountry: 'US', sourceCurrency: 'USD', targetCurrency: 'HTG',
    };
    const quote = await request(app).post('/api/transfers/quote').set(auth).send(input).expect(200);
    const created = await request(app).post('/api/transfers').set(auth)
      .set('Idempotency-Key', 'review-create-1').send({ ...input, quoteId: quote.body.quote.quoteId }).expect(201);
    const funding = await request(app).post(`/api/transfers/${created.body.transfer.id}/funding`).set(auth)
      .set('Idempotency-Key', 'review-funding-1').send({ fundingSourceId }).expect(202);
    provider.transferStatus = 'processed';
    await request(app).get(`/api/funding/dwolla/transfers/${funding.body.transaction.id}?refresh=true`).set(auth).expect(200);
    const held = await request(app).get(`/api/transfers/${created.body.transfer.id}`).set(auth).expect(200);
    expect(held.body.transfer).toMatchObject({ stage: 'COMPLIANCE_REVIEW', complianceStatus: 'REVIEW' });
    expect(held.body.transfer.providerTransactionId).toBeUndefined();

    const admin = await request(app).post('/api/auth/login').send({
      email: 'admin@ticash.local', password: 'AdminPass123!',
    }).expect(200);
    const adminAuth = { Authorization: `Bearer ${admin.body.accessToken}` };
    await request(app).patch(`/api/admin/transfers/${created.body.transfer.id}/status`)
      .set(adminAuth).send({ status: 'COMPLETED' }).expect(409);
    const cleared = await request(app).patch(`/api/admin/transfers/${created.body.transfer.id}/compliance`)
      .set(adminAuth).send({ status: 'CLEAR', reason: 'Authorized sandbox analyst review' }).expect(200);
    expect(cleared.body.transfer).toMatchObject({ stage: 'PAYOUT_PROCESSING', complianceStatus: 'CLEAR' });
  });
});
