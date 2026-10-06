import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pglitePrisma } from './helpers/pglite-prisma.js';
import { PrismaMobileTopUpRepository } from '../src/topup/repository.js';

const db = new PGlite();
const prisma = new PrismaClient({ adapter: pglitePrisma(db) });
const repository = new PrismaMobileTopUpRepository(prisma);
beforeAll(async () => {
  const root = fileURLToPath(new URL('../../../migrations/', import.meta.url));
  for (const dir of readdirSync(root).sort()) {
    if (dir.includes('_')) await db.exec(readFileSync(`${root}/${dir}/migration.sql`, 'utf8'));
  }
}, 60000);
afterAll(async () => { await prisma.$disconnect(); await db.close(); });

describe('reconciliation selection in migrated PostgreSQL', () => {
  it('isolates both environments before the batch limit and excludes inconsistent metadata', async () => {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.invalid`, passwordHash: 'fixture-only' } });
    const old = new Date('2026-01-01T00:00:00Z');
    const recent = new Date('2026-01-02T00:00:00Z');
    async function seed(environment: 'SANDBOX' | 'PRODUCTION', updatedAt: Date, overrides = {}) {
      const testMode = environment === 'SANDBOX';
      const data = { userId: user.id, countryCode: 'JM', recipientPhone: '+18765551234', operatorId: 77,
        operatorName: 'Fixture operator', productId: 'fixture', productName: 'Fixture airtime', kind: 'AIRTIME' as const,
        providerAmount: 5, providerCurrency: 'USD', deliveredCurrency: 'JMD', feeUsd: 0.99, totalChargeUsd: 5.99, testMode };
      const quote = await prisma.mobileTopUpQuote.create({ data: { ...data, expiresAt: new Date('2099-01-01') } });
      return prisma.mobileTopUpTransaction.create({ data: { ...data, quoteId: quote.id,
        customIdentifier: randomUUID(), idempotencyKey: randomUUID(), requestHash: 'fixture-only',
        status: 'PENDING', paymentStatus: 'SESSION_CREATED', paymentProvider: 'STRIPE',
        paymentEnvironment: environment, rechargeEnvironment: environment, updatedAt, ...overrides } });
    }
    const sandbox = [];
    for (let i = 0; i < 30; i++) sandbox.push(await seed('SANDBOX', old));
    const production = await seed('PRODUCTION', recent);
    for (const [environment, overrides] of [
      ['PRODUCTION', { testMode: true }], ['SANDBOX', { testMode: false }],
      ['PRODUCTION', { rechargeEnvironment: 'SANDBOX' }], ['SANDBOX', { paymentEnvironment: 'PRODUCTION' }],
    ] as const) {
      await expect(seed(environment, old, overrides)).rejects.toThrow(/check constraint/);
    }
    await seed('PRODUCTION', new Date('2099-01-01'));
    await seed('PRODUCTION', old, { status: 'DELIVERED', paymentStatus: 'CAPTURED' });
    const cutoff = '2026-01-03T00:00:00Z';

    expect((await repository.listReconciliationCandidates(1, cutoff, 'PRODUCTION')).map(r => r.id)).toEqual([production.id]);
    expect((await repository.listReconciliationCandidates(100, cutoff, 'SANDBOX')).map(r => r.id).sort())
      .toEqual(sandbox.map(r => r.id).sort());
    for (const row of [...sandbox, production]) {
      expect(await prisma.mobileTopUpTransaction.findUnique({ where: { id: row.id } })).toEqual(row);
    }
  });
});
