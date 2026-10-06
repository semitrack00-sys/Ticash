import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pglitePrisma } from './helpers/pglite-prisma.js';
import { deleteFlupFlapAccount } from '../src/flupflap/account-deletion.js';
import express from 'express';
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { createFlupFlapIdentity } from '../src/flupflap/auth.js';
import { FlupFlapIdentityRepository } from '../src/flupflap/repository.js';
import { exportDeletionLedger, ledgerCheckpoint, suppressRestoredFlupFlapAccounts, verifyDeletionLedger } from '../src/flupflap/deletion-ledger.js';

const db = new PGlite();
const prisma = new PrismaClient({ adapter: pglitePrisma(db) });
beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../migrations/', import.meta.url));
  for (const dir of readdirSync(root).sort()) {
    if (dir.includes('_')) await db.exec(readFileSync(`${root}/${dir}/migration.sql`, 'utf8'));
  }
}, 60000);
afterAll(async () => { await prisma.$disconnect(); await db.close(); });

async function fixture() {
  const staff = await prisma.user.create({ data: { email: `${randomUUID()}@example.test`, passwordHash: 'fixture', role: 'ADMIN' } });
  const customer = await prisma.flupFlapCustomer.create({ data: {
    email: `${randomUUID()}@example.test`, passwordHash: 'fixture', firstName: 'Private', lastName: 'Name',
    googleSubject: randomUUID(), phone: `+1555${Date.now()}`, countryCode: 'US',
  } });
  const session = await prisma.flupFlapSession.create({ data: {
    customerId: customer.id, refreshHash: randomUUID(), expiresAt: new Date(Date.now() + 600000),
  } });
  await prisma.flupFlapPasswordResetToken.create({ data: {
    customerId: customer.id, tokenHash: randomUUID(), expiresAt: new Date(Date.now() + 600000),
  } });
  const recipient = await prisma.mobileTopUpRecipient.create({ data: {
    flupFlapCustomerId: customer.id, nickname: 'Private recipient', phone: '+50937050210', countryCode: 'HT',
  } });
  const quote = await prisma.mobileTopUpQuote.create({ data: {
    flupFlapCustomerId: customer.id, recipientPhone: recipient.phone, countryCode: 'HT',
    operatorId: 7, operatorName: 'Fixture', productId: 'fixture', productName: 'Fixture', kind: 'AIRTIME',
    providerAmount: 10, providerCurrency: 'USD', deliveredCurrency: 'HTG', feeUsd: 1, totalChargeUsd: 11,
    expiresAt: new Date(Date.now() + 600000),
  } });
  const transaction = await prisma.mobileTopUpTransaction.create({ data: {
    flupFlapCustomerId: customer.id, quoteId: quote.id, recipientId: recipient.id,
    recipientPhone: recipient.phone, countryCode: 'HT', operatorId: 7, operatorName: 'Fixture',
    productId: 'fixture', productName: 'Fixture', kind: 'AIRTIME', providerAmount: 10,
    providerCurrency: 'USD', deliveredCurrency: 'HTG', feeUsd: 1, totalChargeUsd: 11,
    customIdentifier: randomUUID(), idempotencyKey: randomUUID(), requestHash: 'fixture',
    status: 'DELIVERED', paymentStatus: 'CAPTURED', checkoutResumeTokenHash: randomUUID(),
    checkoutResumeTokenExpiresAt: new Date(Date.now() + 600000), recurringIntervalDays: 7,
  } });
  const unused = await prisma.mobileTopUpQuote.create({ data: {
    flupFlapCustomerId: customer.id, recipientPhone: recipient.phone, countryCode: 'HT',
    operatorId: 7, operatorName: 'Fixture', productId: 'fixture', productName: 'Fixture', kind: 'AIRTIME',
    providerAmount: 10, providerCurrency: 'USD', deliveredCurrency: 'HTG', feeUsd: 1, totalChargeUsd: 11,
    expiresAt: new Date(Date.now() + 600000),
  } });
  const schedule = await prisma.flupFlapRecurringRecharge.create({ data: {
    customerId: customer.id, sourceTransactionId: transaction.id, intervalDays: 7, maxTotalUsd: 11,
    stripeCustomerId: 'cus_fixture', stripePaymentMethodId: 'pm_fixture', billingCountry: 'US',
    nextRunAt: new Date(Date.now() + 600000),
  } });
  const input = { customerId: customer.id, staffId: staff.id, verifiedEmail: customer.email!,
    requestReference: `DELETE_${randomUUID().replaceAll('-', '')}`, verificationMethod: 'REGISTERED_EMAIL_CONTROL',
    maintenanceConfirmed: true };
  return { staff, customer, session, recipient, quote, unused, transaction, schedule, input };
}

describe('controlled FlupFlap account erasure in migrated PostgreSQL', () => {
  it('preview does not mutate identities, sessions or schedules', async () => {
    const f = await fixture();
    expect(await deleteFlupFlapAccount(prisma, { ...f.input, maintenanceConfirmed: false })).toMatchObject({
      mode: 'PREVIEW', recipients: 1, sessions: 1, recurringSchedules: 1, retainedTransactions: 1,
    });
    expect(await prisma.flupFlapCustomer.findUnique({ where: { id: f.customer.id } })).toEqual(f.customer);
    expect(await prisma.flupFlapSession.findUnique({ where: { id: f.session.id } })).not.toBeNull();
  });

  it('erases the verified account, cancels recurrence and preserves financial history and other domains', async () => {
    const f = await fixture(); const other = await fixture();
    const legacy = await prisma.mobileTopUpRecipient.create({ data: {
      userId: f.staff.id, nickname: 'TiCash', phone: '+50937050210', countryCode: 'HT',
    } });
    const visit = await prisma.campaignVisit.create({ data: { capabilityHash: randomUUID(), expiresAt: new Date(Date.now() + 600000) } });
    await prisma.referralAttribution.create({ data: { customerId: f.customer.id, visitId: visit.id } });
    await prisma.campaignEvent.create({ data: { visitId: visit.id, type: 'ACCOUNT_CREATED' } });
    await prisma.referralCode.create({ data: { customerId: f.customer.id, code: randomUUID().replaceAll('-', '') } });
    const promoter = await prisma.promoter.create({ data: { customerId: f.customer.id, name: 'Private promoter' } });
    const campaign = await prisma.promotionCampaign.create({ data: {
      promoterId: promoter.id, name: 'Fixture', code: randomUUID().replaceAll('-', '').toUpperCase(),
      startsAt: new Date(0), endsAt: new Date('2099-01-01'), rules: {},
    } });
    const promotion = await prisma.promotionRedemption.create({ data: {
      quoteId: f.unused.id, customerId: f.customer.id, campaignId: campaign.id,
      campaignVersion: 1, rulesSnapshot: {}, originalFeeCents: 100, benefitCents: 0,
      feeCents: 100, principalCents: 1000, testMode: true, expiresAt: f.unused.expiresAt,
    } });
    const result = await deleteFlupFlapAccount(prisma, f.input, true);
    const deleted = await prisma.flupFlapCustomer.findUniqueOrThrow({ where: { id: f.customer.id } });
    expect(deleted).toMatchObject({ status: 'DELETED', rechargeRestricted: true, authVersion: 1,
      email: null, passwordHash: null, googleSubject: null, firstName: null, lastName: null,
      phone: null, countryCode: null, lastLoginAt: null });
    for (const model of [prisma.flupFlapSession, prisma.flupFlapPasswordResetToken]) {
      expect(await model.count({ where: { customerId: f.customer.id } })).toBe(0);
    }
    expect(await prisma.mobileTopUpRecipient.findUnique({ where: { id: f.recipient.id } })).toBeNull();
    expect(await prisma.flupFlapRecurringRecharge.findUnique({ where: { id: f.schedule.id } })).toBeNull();
    expect(await prisma.mobileTopUpQuote.findUnique({ where: { id: f.unused.id } })).toMatchObject({
      recipientPhone: 'DELETED', receiverQuote: null, productSnapshot: null, expiresAt: new Date(0),
    });
    expect(await prisma.promotionRedemption.findUnique({ where: { id: promotion.id } })).toMatchObject({
      ...promotion, status: 'EXPIRED', updatedAt: expect.any(Date),
    });
    expect(await prisma.mobileTopUpQuote.findUnique({ where: { id: f.quote.id } })).toEqual(f.quote);
    expect(await prisma.mobileTopUpTransaction.findUnique({ where: { id: f.transaction.id } })).toMatchObject({
      status: 'DELIVERED', paymentStatus: 'CAPTURED', totalChargeUsd: f.transaction.totalChargeUsd,
      recipientId: null, checkoutResumeTokenHash: null, recurringIntervalDays: null,
    });
    expect(await prisma.campaignVisit.findUnique({ where: { id: visit.id } })).toBeNull();
    expect(await prisma.campaignEvent.count({ where: { visitId: visit.id } })).toBe(0);
    expect(await prisma.referralCode.findUnique({ where: { customerId: f.customer.id } })).toMatchObject({ disabledAt: expect.any(Date) });
    expect(await prisma.promoter.findUnique({ where: { id: promoter.id } })).toMatchObject({ name: 'Deleted account', disabledAt: expect.any(Date) });
    expect(await prisma.flupFlapCustomer.findUnique({ where: { id: other.customer.id } })).toEqual(other.customer);
    expect(await prisma.mobileTopUpRecipient.findUnique({ where: { id: legacy.id } })).toEqual(legacy);
    const receipt = await prisma.auditLog.findUniqueOrThrow({ where: { id: result.auditId } });
    expect(receipt).toMatchObject({ userId: f.staff.id, action: 'FLUPFLAP_ACCOUNT_DELETED', entityId: f.customer.id });
    expect(JSON.stringify(receipt)).not.toContain(f.customer.email);
    await expect(deleteFlupFlapAccount(prisma, f.input, true)).rejects.toMatchObject({ code: 'ALREADY_DELETED' });
  });

  it('requires verified identity, unlocked admin and maintenance acknowledgement', async () => {
    const f = await fixture();
    await expect(deleteFlupFlapAccount(prisma, { ...f.input, verifiedEmail: 'wrong@example.test' }, true)).rejects.toMatchObject({ code: 'VERIFIED_IDENTITY_MISMATCH' });
    await expect(deleteFlupFlapAccount(prisma, { ...f.input, maintenanceConfirmed: false }, true)).rejects.toMatchObject({ code: 'MAINTENANCE_REQUIRED' });
    await prisma.user.update({ where: { id: f.staff.id }, data: { role: 'SUPPORT' } });
    await expect(deleteFlupFlapAccount(prisma, f.input, true)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    await prisma.user.update({ where: { id: f.staff.id }, data: { role: 'ADMIN', accountLocked: true } });
    await expect(deleteFlupFlapAccount(prisma, f.input, true)).rejects.toMatchObject({ code: 'ADMIN_REQUIRED' });
    expect(await prisma.flupFlapSession.findUnique({ where: { id: f.session.id } })).not.toBeNull();
  });

  it('blocks pending recharge/refund and active recurring claims without partial erasure', async () => {
    const f = await fixture();
    for (const paymentStatus of ['PENDING', 'SESSION_CREATED', 'AUTHORIZED', 'VOID_PENDING', 'REFUND_PENDING'] as const) {
      await prisma.mobileTopUpTransaction.update({ where: { id: f.transaction.id }, data: { paymentStatus } });
      await expect(deleteFlupFlapAccount(prisma, f.input, true)).rejects.toMatchObject({ code: 'PAYMENT_OR_WORKER_UNRESOLVED' });
    }
    await prisma.mobileTopUpTransaction.update({ where: { id: f.transaction.id }, data: { paymentStatus: 'CAPTURED', status: 'PROCESSING' } });
    await expect(deleteFlupFlapAccount(prisma, f.input, true)).rejects.toMatchObject({ code: 'PAYMENT_OR_WORKER_UNRESOLVED' });
    await prisma.mobileTopUpTransaction.update({ where: { id: f.transaction.id }, data: { status: 'DELIVERED' } });
    await prisma.flupFlapRecurringRecharge.update({ where: { id: f.schedule.id }, data: { claimedAt: new Date() } });
    await expect(deleteFlupFlapAccount(prisma, f.input, true)).rejects.toMatchObject({ code: 'PAYMENT_OR_WORKER_UNRESOLVED' });
    expect(await prisma.flupFlapCustomer.findUnique({ where: { id: f.customer.id } })).toEqual(f.customer);
  });

  it('database guards prevent deleted identity reactivation and stale credential/recharge inserts', async () => {
    const f = await fixture(); await deleteFlupFlapAccount(prisma, f.input, true);
    await expect(prisma.flupFlapCustomer.update({ where: { id: f.customer.id }, data: { status: 'ACTIVE', email: f.customer.email, passwordHash: 'fixture' } })).rejects.toThrow();
    await expect(prisma.flupFlapCustomer.update({ where: { id: f.customer.id }, data: { firstName: 'Recreated' } })).rejects.toThrow();
    await expect(prisma.flupFlapSession.create({ data: { customerId: f.customer.id, refreshHash: randomUUID(), expiresAt: new Date() } })).rejects.toThrow();
    await expect(prisma.flupFlapPasswordResetToken.create({ data: { customerId: f.customer.id, tokenHash: randomUUID(), expiresAt: new Date() } })).rejects.toThrow();
    await expect(prisma.mobileTopUpRecipient.create({ data: { flupFlapCustomerId: f.customer.id, nickname: 'Race', phone: '+50937050210' } })).rejects.toThrow();
    await expect(prisma.mobileTopUpQuote.create({ data: { ...f.unused, id: randomUUID() } })).rejects.toThrow();
    await expect(prisma.mobileTopUpTransaction.create({ data: { ...f.transaction, id: randomUUID(), customIdentifier: randomUUID(), idempotencyKey: randomUUID() } })).rejects.toThrow();
    await expect(prisma.flupFlapRecurringRecharge.create({ data: { ...f.schedule, id: randomUUID() } })).rejects.toThrow();
    // New independent registration can reuse the erased email without resurrecting the old UUID.
    expect((await prisma.flupFlapCustomer.create({ data: { email: f.customer.email, passwordHash: 'fixture' } })).id).not.toBe(f.customer.id);
  });

  it('old access, refresh and reset credentials stop working after deletion', async () => {
    const f = await fixture();
    const refreshToken = 'a'.repeat(43); const resetToken = 'b'.repeat(43);
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    await prisma.flupFlapSession.update({ where: { id: f.session.id }, data: { refreshHash: hash(refreshToken) } });
    await prisma.flupFlapPasswordResetToken.updateMany({ where: { customerId: f.customer.id }, data: { tokenHash: hash(resetToken) } });
    const secret = 'test-only-flupflap-secret-at-least-32-characters';
    const identity = createFlupFlapIdentity({
      config: { enabled: true, accessSecret: secret }, repository: new FlupFlapIdentityRepository(prisma),
      accessAllowed: () => true, guestError: () => undefined, audit: async () => {},
      emailService: { sendPasswordReset: async () => {} },
    });
    const app = express(); app.use(express.json()); app.use('/auth', identity.router);
    const token = jwt.sign({ sub: f.customer.id, type: 'access', domain: 'FLUPFLAP', sid: f.session.id, v: 0 }, secret,
      { algorithm: 'HS256', issuer: 'flupflap-api', audience: 'flupflap-customer', expiresIn: 900 });
    await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    await deleteFlupFlapAccount(prisma, f.input, true);
    await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
    await request(app).post('/auth/refresh').send({ refreshToken }).expect(401);
    expect(await new FlupFlapIdentityRepository(prisma).resetPassword(hash(resetToken), 'new', new Date())).toBe(false);
  });

  it('audit failure rolls back every deletion change', async () => {
    const f = await fixture();
    await db.exec(`CREATE FUNCTION test_reject_deletion_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.action = 'FLUPFLAP_ACCOUNT_DELETED' THEN RAISE EXCEPTION 'fixture audit failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_reject_deletion_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION test_reject_deletion_audit();`);
    try {
      await expect(deleteFlupFlapAccount(prisma, f.input, true)).rejects.toThrow();
      expect(await prisma.flupFlapCustomer.findUnique({ where: { id: f.customer.id } })).toEqual(f.customer);
      expect(await prisma.flupFlapSession.findUnique({ where: { id: f.session.id } })).not.toBeNull();
      expect(await prisma.mobileTopUpRecipient.findUnique({ where: { id: f.recipient.id } })).not.toBeNull();
      expect(await prisma.flupFlapRecurringRecharge.findUnique({ where: { id: f.schedule.id } })).not.toBeNull();
    } finally {
      await db.exec('DROP TRIGGER test_reject_deletion_audit ON "AuditLog"; DROP FUNCTION test_reject_deletion_audit();');
    }
  });

  it('authenticates independent ledgers and rejects tampering, stale checkpoints and wrong namespaces', async () => {
    const key = 'independent-test-only-signing-key-at-least-32-bytes';
    const namespace = randomUUID();
    const f = await fixture();
    await deleteFlupFlapAccount(prisma, f.input, true);
    const exported = await exportDeletionLedger(prisma, key, namespace);
    expect(verifyDeletionLedger(exported.manifest, key, namespace, exported.checkpoint)).toEqual(exported.manifest);
    expect(JSON.stringify(exported.manifest)).not.toContain(f.customer.email);
    expect(() => verifyDeletionLedger(exported.manifest, 'short', namespace, exported.checkpoint)).toThrow('LEDGER_KEY_REQUIRED');
    expect(() => verifyDeletionLedger(exported.manifest, key, randomUUID(), exported.checkpoint)).toThrow('LEDGER_NAMESPACE_MISMATCH');
    expect(() => verifyDeletionLedger(exported.manifest, key, namespace, '0'.repeat(64))).toThrow('LEDGER_CHECKPOINT_MISMATCH');
    const tampered = structuredClone(exported.manifest);
    tampered.payload.entries[0]!.customerId = randomUUID();
    expect(() => verifyDeletionLedger(tampered, key, namespace, ledgerCheckpoint(tampered))).toThrow('LEDGER_SIGNATURE_INVALID');
    const later = await fixture(); await deleteFlupFlapAccount(prisma, later.input, true);
    const merged = await exportDeletionLedger(prisma, key, namespace, exported);
    expect(merged.manifest.payload.entries.some(value => value.customerId === f.customer.id)).toBe(true);
    expect(merged.manifest.payload.entries.some(value => value.customerId === later.customer.id)).toBe(true);
    expect(() => verifyDeletionLedger(exported.manifest, key, namespace, merged.checkpoint)).toThrow('LEDGER_CHECKPOINT_MISMATCH');
  });

  it('suppresses a pre-deletion logical backup without resurrecting auth or recurrence', async () => {
    const f = await fixture();
    const control = await fixture();
    const refreshToken = 'r'.repeat(43); const resetToken = 's'.repeat(43);
    const hash = (value: string) => createHash('sha256').update(value).digest('hex');
    await prisma.flupFlapSession.update({ where: { id: f.session.id }, data: { refreshHash: hash(refreshToken) } });
    await prisma.flupFlapPasswordResetToken.updateMany({ where: { customerId: f.customer.id }, data: { tokenHash: hash(resetToken) } });
    const backupSession = await prisma.flupFlapSession.findUniqueOrThrow({ where: { id: f.session.id } });
    const backupReset = await prisma.flupFlapPasswordResetToken.findFirstOrThrow({ where: { customerId: f.customer.id } });
    const restoredDb = new PGlite();
    const restored = new PrismaClient({ adapter: pglitePrisma(restoredDb) });
    try {
      const root = fileURLToPath(new URL('../../../migrations/', import.meta.url));
      for (const dir of readdirSync(root).sort()) if (dir.includes('_')) {
        await restoredDb.exec(readFileSync(`${root}/${dir}/migration.sql`, 'utf8'));
      }
      // Restore only synthetic fixture rows captured before erasure, in an isolated database.
      await restored.user.create({ data: f.staff });
      await restored.flupFlapCustomer.create({ data: f.customer });
      await restored.flupFlapCustomer.create({ data: control.customer });
      await restored.flupFlapSession.create({ data: backupSession });
      await restored.flupFlapPasswordResetToken.create({ data: backupReset });
      await restored.mobileTopUpRecipient.create({ data: f.recipient });
      await restored.mobileTopUpQuote.create({ data: f.quote });
      await restored.mobileTopUpQuote.create({ data: f.unused });
      await restored.mobileTopUpTransaction.create({ data: f.transaction });
      await restored.flupFlapRecurringRecharge.create({ data: f.schedule });
      const secret = 'isolated-restoration-test-only-access-secret';
      const identity = createFlupFlapIdentity({ config: { enabled: true, accessSecret: secret },
        repository: new FlupFlapIdentityRepository(restored), accessAllowed: () => true,
        guestError: () => undefined, audit: async () => {}, emailService: { sendPasswordReset: async () => {} } });
      const app = express(); app.use(express.json()); app.use('/auth', identity.router);
      const token = jwt.sign({ sub: f.customer.id, type: 'access', domain: 'FLUPFLAP', sid: f.session.id, v: 0 }, secret,
        { algorithm: 'HS256', issuer: 'flupflap-api', audience: 'flupflap-customer', expiresIn: 900 });
      await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
      await deleteFlupFlapAccount(prisma, f.input, true);
      const key = 'independent-restore-test-only-signing-key-32-bytes'; const namespace = randomUUID();
      const exported = await exportDeletionLedger(prisma, key, namespace);
      const input = { staffId: f.staff.id, namespace, expectedCheckpoint: exported.checkpoint, maintenanceConfirmed: true };
      await expect(suppressRestoredFlupFlapAccounts(restored, exported.manifest, key, { ...input, maintenanceConfirmed: false }, true)).rejects.toThrow('MAINTENANCE_REQUIRED');
      await expect(suppressRestoredFlupFlapAccounts(restored, exported.manifest, key, { ...input, staffId: randomUUID() }, true)).rejects.toThrow('ADMIN_REQUIRED');
      expect(await suppressRestoredFlupFlapAccounts(restored, exported.manifest, key, input)).toMatchObject({ mode: 'PREVIEW', suppressed: 1 });
      expect((await restored.flupFlapCustomer.findUniqueOrThrow({ where: { id: f.customer.id } })).status).toBe('ACTIVE');
      expect(await restored.auditLog.count({ where: { action: 'FLUPFLAP_ACCOUNT_DELETED' } })).toBe(0);
      expect(await suppressRestoredFlupFlapAccounts(restored, exported.manifest, key, input, true)).toMatchObject({ mode: 'EXECUTED', suppressed: 1 });
      await request(app).get('/auth/me').set('Authorization', `Bearer ${token}`).expect(401);
      await request(app).post('/auth/refresh').send({ refreshToken }).expect(401);
      await request(app).post('/auth/reset-password').send({ token: resetToken, password: 'safe-test-only-password-987' }).expect(400);
      expect(await restored.flupFlapCustomer.findUnique({ where: { id: f.customer.id } })).toMatchObject({ status: 'DELETED', email: null, passwordHash: null, phone: null, authVersion: 1 });
      expect(await restored.flupFlapRecurringRecharge.count()).toBe(0);
      expect(await restored.mobileTopUpRecipient.count()).toBe(0);
      expect(Number((await restored.mobileTopUpTransaction.findUniqueOrThrow({ where: { id: f.transaction.id } })).totalChargeUsd)).toBe(11);
      expect(await restored.flupFlapCustomer.findUnique({ where: { id: control.customer.id } })).toEqual(control.customer);
      expect(await suppressRestoredFlupFlapAccounts(restored, exported.manifest, key, input, true)).toMatchObject({ suppressed: 0, alreadyDeleted: 1 });
      expect((await restored.flupFlapCustomer.findUniqueOrThrow({ where: { id: f.customer.id } })).authVersion).toBe(1);
      expect(await restored.auditLog.count({ where: { action: 'FLUPFLAP_RESTORE_SUPPRESSED' } })).toBe(1);
      // Carry the external ledger forward even when the restored DB lacks original receipts.
      const carried = await exportDeletionLedger(restored, key, namespace, exported);
      expect(carried.manifest.payload.entries).toEqual(exported.manifest.payload.entries);
    } finally { await restored.$disconnect(); await restoredDb.close(); }
  }, 60000);
});
