import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { pglitePrisma } from './helpers/pglite-prisma.js';
import { storeDownloadReport } from '../src/flupflap/app-downloads-repository.js';
const db = new PGlite();
const prisma = new PrismaClient({ adapter: pglitePrisma(db) });
beforeAll(async () => {
  await db.exec(readFileSync(new URL('../../../migrations/20261019050000_flupflap_app_downloads/migration.sql', import.meta.url), 'utf8'));
  await db.exec(`CREATE TABLE "AuditLog" (id text PRIMARY KEY, "userId" text, action text, entity text,
    "entityId" text, metadata jsonb, "createdAt" timestamp DEFAULT CURRENT_TIMESTAMP, "flupFlapCustomerId" text);`);
}, 30000);
afterAll(async () => { await prisma.$disconnect(); await db.close(); });
describe('persisted download imports', () => {
  it('replaces repeated/corrected days and isolates apps/platforms', async () => {
    const report = { hash: 'a'.repeat(64), days: [{ date: '2026-10-17', downloads: 5 }, { date: '2026-10-18', downloads: 0 }] };
    await storeDownloadReport(prisma, 'ANDROID', 'com.ticash.flupflap', report, 'staff');
    await storeDownloadReport(prisma, 'ANDROID', 'com.ticash.flupflap', report, 'staff');
    expect(await prisma.flupFlapAppDownloadDaily.count()).toBe(2);
    await storeDownloadReport(prisma, 'ANDROID', 'com.ticash.flupflap', { ...report, days: [{ date: '2026-10-17', downloads: 7 }] }, 'staff');
    await storeDownloadReport(prisma, 'IOS', '12345', report, 'staff');
    await storeDownloadReport(prisma, 'ANDROID', 'other.app', report, 'staff');
    const rows = await prisma.flupFlapAppDownloadDaily.findMany({ where: { platform: 'ANDROID', appId: 'com.ticash.flupflap' }, orderBy: { reportDate: 'asc' } });
    expect(rows.map(r => r.downloads)).toEqual([7, 0]);
    expect(await prisma.auditLog.count()).toBe(5);
    const audit = await prisma.auditLog.findFirst();
    expect(audit?.userId).toBe('staff');
    expect(JSON.stringify(audit?.metadata)).not.toMatch(/phone|email|report contents/);
  });
  it('rolls back the whole import on a database constraint failure', async () => {
    const before = await prisma.flupFlapAppDownloadDaily.count();
    await expect(storeDownloadReport(prisma, 'ANDROID', 'rollback.app', { hash: 'b'.repeat(64), days: [
      { date: '2026-10-16', downloads: 10 }, { date: '2026-10-17', downloads: -1 },
    ] }, 'staff')).rejects.toThrow();
    expect(await prisma.flupFlapAppDownloadDaily.count()).toBe(before);
    expect(await prisma.auditLog.count()).toBe(5);
  });
});
