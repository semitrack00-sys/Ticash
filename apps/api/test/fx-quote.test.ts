import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp, resetStore } from '../src/app.js';
import { MockTestFxProvider } from '../src/fx/mock-provider.js';
import type { FxConfig } from '../src/fx/types.js';

const config: FxConfig = {
  mode: 'mock',
  quoteTtlSeconds: 300,
  mockUsdHtgRate: '132.1234567',
  mockHtgRates: {
    USD: '132.1234567', CAD: '97.000000', EUR: '145.000000',
    MXN: '7.500000', BRL: '26.000000', CLP: '0.140000', DOP: '2.200000',
  },
  ticashFeePercent: '2.5',
  ticashMinimumFeeUsd: '1.99',
  providerFundingFeeUsd: '0.25',
};

const recipient = {
  fullName: 'Jean Recipient',
  country: 'HT',
  phoneNumber: '+50937123456',
  address: '12 Rue Capois',
  city: 'Port-au-Prince',
  department: 'Ouest',
  payoutMethod: 'MONCASH',
};

function quoteInput(amount = 100) {
  return {
    recipient,
    amount,
    sendCountry: 'US',
    sourceCurrency: 'USD',
    targetCurrency: 'HTG',
  };
}

async function approvedUser(app: ReturnType<typeof createApp>, suffix = 'one') {
  const registered = await request(app).post('/api/auth/register').send({
    email: `fx-${suffix}@example.com`,
    password: 'correct-horse-42',
    firstName: 'Ti',
    lastName: 'Sender',
  }).expect(201);
  const admin = await request(app).post('/api/auth/login').send({
    email: 'admin@ticash.local',
    password: 'AdminPass123!',
  }).expect(200);
  await request(app)
    .patch(`/api/admin/users/${registered.body.user.id}/kyc`)
    .set('Authorization', `Bearer ${admin.body.accessToken}`)
    .send({ status: 'APPROVED' })
    .expect(200);
  return { Authorization: `Bearer ${registered.body.accessToken}` };
}

function testApp(clock?: () => Date) {
  return createApp({
    fxConfig: config,
    fxProvider: new MockTestFxProvider(config.mockHtgRates!),
    fxClock: clock,
  });
}

describe('server-side FX and remittance quotes', () => {
  beforeEach(resetStore);

  it('returns precise, server-calculated U.S. to Haiti quote terms and fees', async () => {
    const app = testApp();
    const auth = await approvedUser(app);
    const response = await request(app)
      .post('/api/transfers/quote')
      .set(auth)
      .send(quoteInput(12.34))
      .expect(200);

    expect(response.body.quote).toMatchObject({
      provider: 'mock_test_fx',
      testMode: true,
      corridor: {
        sendCountry: 'US', receiveCountry: 'HT',
        sourceCurrency: 'USD', targetCurrency: 'HTG',
      },
      sendAmount: 12.34,
      exchangeRate: 132.123457,
      ticashFee: 1.99,
      providerFundingFee: 0.25,
      totalCustomerCharge: 14.58,
      recipientAmount: 1630.4,
    });
    expect(response.body.quote.quoteId).toMatch(/^[0-9a-f-]{36}$/);
    expect(Date.parse(response.body.quote.expiresAt)).toBeGreaterThan(Date.now());
  });

  it('derives the authoritative USD charge when the customer enters an HTG receive amount', async () => {
    const app = testApp();
    const auth = await approvedUser(app, 'receive-amount');
    const response = await request(app).post('/api/transfers/quote').set(auth)
      .send({ ...quoteInput(13333.33), amountCurrency: 'HTG' }).expect(200);
    expect(response.body.quote.recipientAmount).toBe(13333.33);
    expect(response.body.quote.sendAmount).toBe(100.92);
    expect(response.body.quote.totalCustomerCharge).toBeGreaterThan(100.92);
  });

  it('rejects a payout method that backend configuration does not expose', async () => {
    const app = createApp({
      fxConfig: config,
      fxProvider: new MockTestFxProvider(config.mockHtgRates!),
      payoutConfig: { mode: 'mock', enabledMethods: ['MONCASH'] },
    });
    const auth = await approvedUser(app, 'disabled-payout');
    const input = { ...quoteInput(20), recipient: { ...recipient, payoutMethod: 'NATCASH' } };
    const quoted = await request(app).post('/api/transfers/quote').set(auth).send(input).expect(200);
    const response = await request(app).post('/api/transfers').set(auth)
      .set('Idempotency-Key', 'disabled-payout-1')
      .send({ ...input, quoteId: quoted.body.quote.quoteId }).expect(409);
    expect(response.body.code).toBe('PAYOUT_METHOD_UNAVAILABLE');
  });

  it('uses percentage fees above the minimum and rejects excess send precision', async () => {
    const app = testApp();
    const auth = await approvedUser(app);
    const quote = await request(app).post('/api/transfers/quote').set(auth)
      .send(quoteInput(100)).expect(200);
    expect(quote.body.quote).toMatchObject({
      ticashFee: 2.5,
      providerFundingFee: 0.25,
      totalCustomerCharge: 102.75,
    });
    const invalid = await request(app).post('/api/transfers/quote').set(auth)
      .send(quoteInput(10.001)).expect(400);
    expect(invalid.body.code).toBe('INVALID_SEND_AMOUNT');
  });

  it('rejects expired quotes', async () => {
    let now = new Date('2026-01-01T00:00:00.000Z');
    const app = testApp(() => now);
    const auth = await approvedUser(app);
    const quoted = await request(app).post('/api/transfers/quote').set(auth)
      .send(quoteInput()).expect(200);
    now = new Date('2026-01-01T00:05:01.000Z');
    const expired = await request(app).post('/api/transfers').set(auth)
      .set('Idempotency-Key', 'expired-quote-1')
      .send({ ...quoteInput(), quoteId: quoted.body.quote.quoteId })
      .expect(410);
    expect(expired.body.code).toBe('QUOTE_EXPIRED');
  });

  it('supports configured international source currencies while keeping Haiti/HTG fixed', async () => {
    const app = testApp();
    const auth = await approvedUser(app, 'international-currencies');
    for (const [sendCountry, sourceCurrency, expectedRate] of [
      ['CA', 'CAD', 97], ['EU', 'EUR', 145], ['MX', 'MXN', 7.5],
      ['BR', 'BRL', 26], ['CL', 'CLP', 0.14], ['DO', 'DOP', 2.2],
    ] as const) {
      const response = await request(app).post('/api/transfers/quote').set(auth)
        .send({ ...quoteInput(10), sendCountry, sourceCurrency, amountCurrency: sourceCurrency })
        .expect(200);
      expect(response.body.quote.corridor).toEqual({
        sendCountry, sourceCurrency, receiveCountry: 'HT', targetCurrency: 'HTG',
      });
      expect(response.body.quote.exchangeRate).toBe(expectedRate);
    }
  });

  it('rejects unsupported corridors before requesting a provider rate', async () => {
    const app = testApp();
    const auth = await approvedUser(app);
    const response = await request(app).post('/api/transfers/quote').set(auth)
      .send({ ...quoteInput(), sendCountry: 'CA' }).expect(422);
    expect(response.body.code).toBe('UNSUPPORTED_CORRIDOR');
  });

  it('rejects client tampering and server/client amount mismatches', async () => {
    const app = testApp();
    const auth = await approvedUser(app);
    const quoted = await request(app).post('/api/transfers/quote').set(auth)
      .send(quoteInput()).expect(200);
    const quoteId = quoted.body.quote.quoteId as string;

    const injectedTerms = await request(app).post('/api/transfers').set(auth)
      .set('Idempotency-Key', 'tampered-quote-1')
      .send({ ...quoteInput(), quoteId, exchangeRate: 999 })
      .expect(400);
    expect(injectedTerms.body.code).toBe('VALIDATION_ERROR');

    const amountMismatch = await request(app).post('/api/transfers').set(auth)
      .set('Idempotency-Key', 'mismatched-quote-1')
      .send({ ...quoteInput(100.01), quoteId })
      .expect(409);
    expect(amountMismatch.body.code).toBe('QUOTE_MISMATCH');
  });

  it('binds quotes to their authenticated owner', async () => {
    const app = testApp();
    const first = await approvedUser(app, 'owner');
    const second = await approvedUser(app, 'other');
    const quoted = await request(app).post('/api/transfers/quote').set(first)
      .send(quoteInput()).expect(200);
    const response = await request(app).post('/api/transfers').set(second)
      .set('Idempotency-Key', 'stolen-quote-1')
      .send({ ...quoteInput(), quoteId: quoted.body.quote.quoteId })
      .expect(404);
    expect(response.body.code).toBe('QUOTE_NOT_FOUND');
  });

  it('consumes a quote once while preserving same-key idempotent replay', async () => {
    const app = testApp();
    const auth = await approvedUser(app);
    const quoted = await request(app).post('/api/transfers/quote').set(auth)
      .send(quoteInput()).expect(200);
    const submission = { ...quoteInput(), quoteId: quoted.body.quote.quoteId };
    const first = await request(app).post('/api/transfers').set(auth)
      .set('Idempotency-Key', 'quote-submit-1').send(submission).expect(201);
    const replay = await request(app).post('/api/transfers').set(auth)
      .set('Idempotency-Key', 'quote-submit-1').send(submission).expect(200);
    expect(replay.body).toMatchObject({
      idempotentReplay: true,
      transfer: { id: first.body.transfer.id },
    });
    const duplicate = await request(app).post('/api/transfers').set(auth)
      .set('Idempotency-Key', 'quote-submit-2').send(submission).expect(409);
    expect(duplicate.body.code).toBe('QUOTE_ALREADY_USED');
  });
});
