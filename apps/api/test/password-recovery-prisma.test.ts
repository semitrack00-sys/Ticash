import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { beforeEach, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  passwordResetToken: { findUnique: vi.fn(), updateMany: vi.fn() },
  session: { deleteMany: vi.fn() }, auditLog: { create: vi.fn() }, $transaction: vi.fn(),
}));
vi.mock('../src/database.js', () => ({ databaseEnabled: true, prisma: db }));
import { createApp } from '../src/app.js';

let token: string;
let reset: { tokenHash: string; userId: string; expiresAt: Date; consumedAt: Date | null };
let user: { id: string; passwordHash: string };
beforeEach(async () => {
  vi.clearAllMocks();
  token = randomBytes(32).toString('base64url');
  reset = { tokenHash: createHash('sha256').update(token).digest('hex'), userId: 'customer', expiresAt: new Date(Date.now()+1800000), consumedAt: null };
  user = { id: 'customer', passwordHash: await bcrypt.hash('current-password', 4) };
  db.user.findUnique.mockImplementation(async () => ({...user}));
  db.user.update.mockImplementation(async ({data}) => { user.passwordHash=data.passwordHash; return user; });
  db.passwordResetToken.findUnique.mockImplementation(async () => ({...reset}));
  db.passwordResetToken.updateMany.mockImplementation(async ({where,data}) => {
    if (where.tokenHash) {
      expect(where).toMatchObject({tokenHash:reset.tokenHash,consumedAt:null,expiresAt:{gt:expect.any(Date)}});
      if (reset.consumedAt || reset.expiresAt <= where.expiresAt.gt) return {count:0};
      reset.consumedAt=data.consumedAt;
    }
    return {count:1};
  });
  db.$transaction.mockImplementation(async callback => callback(db));
});

it('database path keeps the token after same-password rejection, then resets once and revokes sessions', async () => {
  const app=createApp();
  const rejected=await request(app).post('/api/auth/reset-password').send({token,newPassword:'current-password'}).expect(400);
  expect(rejected.body.code).toBe('INVALID_PASSWORD');
  expect(reset.consumedAt).toBeNull(); expect(db.passwordResetToken.updateMany).not.toHaveBeenCalled();
  await request(app).post('/api/auth/reset-password').send({token,newPassword:'different-password'}).expect(204);
  expect(await bcrypt.compare('different-password',user.passwordHash)).toBe(true);
  expect(db.session.deleteMany).toHaveBeenCalledWith({where:{userId:user.id}});
  await request(app).post('/api/auth/reset-password').send({token,newPassword:'third-password'}).expect(400);
});

it('database conditional claim allows only one competing reset to update the password', async () => {
  const app=createApp();
  const responses=await Promise.all(['different-one','different-two'].map(newPassword=>request(app).post('/api/auth/reset-password').send({token,newPassword})));
  expect(responses.map(r=>r.status).sort()).toEqual([204,400]);
  expect(db.user.update).toHaveBeenCalledTimes(1);
  expect(db.session.deleteMany).toHaveBeenCalledTimes(1);
});

it('database path rejects expired tokens without changing the password', async () => {
  reset.expiresAt=new Date(Date.now()-1);
  await request(createApp()).post('/api/auth/reset-password').send({token,newPassword:'different-password'}).expect(400);
  expect(db.user.update).not.toHaveBeenCalled();
});
