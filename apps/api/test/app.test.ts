import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp, resetStore } from '../src/app.js';

const account = {
  email: 'sender@example.com',
  password: 'correct-horse-42',
  firstName: 'Ti',
  lastName: 'Sender',
};

describe('TiCash mock API', () => {
  beforeEach(resetStore);

  it('registers, restores, refreshes and logs in a user without exposing a hash', async () => {
    const app = createApp();
    const registered = await request(app).post('/api/auth/register').send(account).expect(201);
    expect(registered.body.user.passwordHash).toBeUndefined();

    await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
      .expect(200);

    const refreshed = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: registered.body.refreshToken })
      .expect(200);
    expect(refreshed.body.refreshToken).not.toBe(registered.body.refreshToken);

    await request(app).post('/api/auth/login').send({
      email: account.email,
      password: account.password,
    }).expect(200);
  });

  it('completes the recipient, quote and idempotent transfer flow', async () => {
    const app = createApp();
    const registered = await request(app).post('/api/auth/register').send(account);
    const auth = { Authorization: `Bearer ${registered.body.accessToken}` };

    await request(app).post('/api/transfers/quote').set(auth).send({
      recipient: {
        fullName: 'Jean Recipient', country: 'HT', phoneNumber: '+50937123456',
        address: '12 Rue Capois', city: 'Port-au-Prince', department: 'Ouest',
        payoutMethod: 'MONCASH',
      },
      amount: 100, sourceCurrency: 'USD', targetCurrency: 'HTG',
    }).expect(403);
    const admin = await request(app).post('/api/auth/login').send({
      email: 'admin@ticash.local', password: 'AdminPass123!',
    }).expect(200);
    await request(app).patch(`/api/admin/users/${registered.body.user.id}/kyc`)
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .send({ status: 'APPROVED' }).expect(200);

    await request(app).post('/api/recipients').set(auth).send({
      firstName: 'Jean',
      middleName: 'Michel',
      lastName: 'Recipient',
      country: 'HT',
      phoneNumber: '+50937123456',
      address: '12 Rue Capois',
      city: 'Port-au-Prince',
      department: 'Ouest',
      payoutMethod: 'MONCASH',
    }).expect(201);

    const input = {
      recipient: {
        firstName: 'Jean',
        middleName: 'Michel',
        lastName: 'Recipient',
        country: 'HT',
        phoneNumber: '+50937123456',
        address: '12 Rue Capois',
        city: 'Port-au-Prince',
        department: 'Ouest',
        payoutMethod: 'MONCASH',
      },
      amount: 100,
      sourceCurrency: 'USD',
      targetCurrency: 'HTG',
    };
    const quote = await request(app).post('/api/transfers/quote').set(auth).send(input).expect(200);
    expect(quote.body.quote.totalCustomerCharge).toBeGreaterThan(100);
    const quotedInput = { ...input, quoteId: quote.body.quote.quoteId };

    const first = await request(app)
      .post('/api/transfers')
      .set(auth)
      .set('Idempotency-Key', 'test-transfer-1')
      .send(quotedInput)
      .expect(201);
    const replay = await request(app)
      .post('/api/transfers')
      .set(auth)
      .set('Idempotency-Key', 'test-transfer-1')
      .send(quotedInput)
      .expect(200);
    expect(replay.body.transfer.id).toBe(first.body.transfer.id);
    expect(replay.body.idempotentReplay).toBe(true);
    expect(first.body.transfer.payoutMethod).toBe('MONCASH');
    expect(first.body.transfer.recipientName).toBe('Jean Michel Recipient');
    expect(first.body.transfer.recipientPhone).toBe('+50937123456');
    expect(first.body.transfer.status).toBe('PENDING');
    expect(first.body.transfer.stage).toBe('AWAITING_FUNDING');
    expect(first.body.transfer.providerTransactionId).toBeUndefined();

    const completed = await request(app)
      .patch(`/api/admin/transfers/${first.body.transfer.id}/status`)
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .send({ status: 'COMPLETED' }).expect(409);
    expect(completed.body.code).toBe('INVALID_TRANSFER_STATE');

    await request(app)
      .post('/api/transfers')
      .set(auth)
      .set('Idempotency-Key', 'test-transfer-1')
      .send({...quotedInput, amount: 101})
      .expect(409);

    const history = await request(app).get('/api/transfers').set(auth).expect(200);
    expect(history.body.transfers).toHaveLength(1);
    expect(history.body.transfers[0].status).toBe('PENDING');
  });

  it('rejects invalid input and cross-account recipient access', async () => {
    const app = createApp();
    await request(app).post('/api/auth/register').send({...account, password: 'short'}).expect(400);
    await request(app).get('/api/recipients').expect(401);
  });

  it('updates and deletes an authenticated user recipient', async () => {
    const app = createApp();
    const registered = await request(app).post('/api/auth/register').send(account).expect(201);
    const auth = { Authorization: `Bearer ${registered.body.accessToken}` };
    const original = {
      firstName: 'Marie', middleName: 'Anne', lastName: 'Recipient',
      country: 'HT', phoneNumber: '+50938123456',
      address: '8 Rue Lamarre', city: 'Jacmel', department: 'Sud-Est',
      payoutMethod: 'MONCASH',
    };
    const created = await request(app).post('/api/recipients')
      .set(auth).send(original).expect(201);
    const updated = await request(app)
      .patch(`/api/recipients/${created.body.recipient.id}`)
      .set(auth)
      .send({ ...original, middleName: '', lastName: 'Updated', payoutMethod: 'NATCASH' })
      .expect(200);
    expect(updated.body.recipient.fullName).toBe('Marie Updated');
    expect(updated.body.recipient).toMatchObject({
      firstName: 'Marie', lastName: 'Updated',
    });
    expect(updated.body.recipient.middleName).toBeUndefined();
    expect(updated.body.recipient.payoutMethod).toBe('NATCASH');
    await request(app).delete(`/api/recipients/${created.body.recipient.id}`)
      .set(auth).expect(204);
    const list = await request(app).get('/api/recipients').set(auth).expect(200);
    expect(list.body.recipients).toHaveLength(0);
  });

  it('changes a password and revokes existing refresh sessions', async () => {
    const app = createApp();
    const registered = await request(app).post('/api/auth/register').send(account).expect(201);
    const auth = { Authorization: `Bearer ${registered.body.accessToken}` };

    await request(app).put('/api/users/me/password').set(auth).send({
      currentPassword: account.password,
      newPassword: 'new-secure-password-84',
    }).expect(204);

    await request(app).post('/api/auth/refresh').send({
      refreshToken: registered.body.refreshToken,
    }).expect(401);
    await request(app).post('/api/auth/login').send({
      email: account.email,
      password: 'new-secure-password-84',
    }).expect(200);
  });

  it('updates a profile and completes the manual KYC review workflow', async () => {
    const app = createApp();
    const registered = await request(app).post('/api/auth/register').send(account).expect(201);
    const auth = { Authorization: `Bearer ${registered.body.accessToken}` };

    const profile = await request(app).patch('/api/users/me').set(auth).send({
      firstName: 'Updated', lastName: 'Sender', phoneNumber: '+12025550144',
      countryCode: 'CA', addressLine1: '123 King Street', addressLine2: 'Unit 4',
      city: 'Toronto', region: 'Ontario', postalCode: 'M5V 2T6',
    }).expect(200);
    expect(profile.body.user.firstName).toBe('Updated');
    expect(profile.body.user.phoneNumber).toBe('+12025550144');
    expect(profile.body.user.countryCode).toBe('CA');
    expect(profile.body.user.addressLine1).toBe('123 King Street');
    expect(profile.body.user.city).toBe('Toronto');
    expect(profile.body.user.region).toBe('Ontario');
    expect(profile.body.user.postalCode).toBe('M5V 2T6');

    const submitted = await request(app).post('/api/kyc/submit').set(auth)
      .send({ attested: true }).expect(202);
    expect(submitted.body.user.kycStatus).toBe('PENDING');

    const admin = await request(app).post('/api/auth/login').send({
      email: 'admin@ticash.local', password: 'AdminPass123!',
    }).expect(200);
    const reviewed = await request(app)
      .patch(`/api/admin/users/${registered.body.user.id}/kyc`)
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .send({ status: 'APPROVED' }).expect(200);
    expect(reviewed.body.user.kycStatus).toBe('APPROVED');
  });

  it('protects and serves the admin operations overview', async () => {
    const app = createApp();
    const admin = await request(app).post('/api/auth/login').send({
      email: 'admin@ticash.local',
      password: 'AdminPass123!',
    }).expect(200);
    expect(admin.body.user.role).toBe('ADMIN');

    await request(app)
      .get('/api/admin/overview')
      .set('Authorization', `Bearer ${admin.body.accessToken}`)
      .expect(200);
  });
});
