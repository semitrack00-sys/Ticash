import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync,readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { TOTP } from 'otpauth';
import { beforeAll,afterAll,it,expect,vi } from 'vitest';
import { pglitePrisma } from './helpers/pglite-prisma.js';
import { SecurityChallenges } from '../src/security-challenges.js';
import { FlupFlapAccountSecurity } from '../src/flupflap/account-security.js';
import { FlupFlapIdentityRepository } from '../src/flupflap/repository.js';
import { AdminMfaService } from '../src/admin-mfa.js';

const db=new PGlite(),prisma=new PrismaClient({adapter:pglitePrisma(db)});
beforeAll(async()=>{
  const root=fileURLToPath(new URL('../../../migrations/',import.meta.url));
  for(const dir of readdirSync(root).sort())if(dir.includes('_'))await db.exec(readFileSync(root+dir+'/migration.sql','utf8'));
},60000);
afterAll(async()=>{await prisma.$disconnect();await db.close();});
async function fixture(){
  const password='correct-horse-security';
  const customer=await prisma.flupFlapCustomer.create({data:{email:randomUUID()+'@example.test',passwordHash:await bcrypt.hash(password,4),emailVerifiedAt:new Date()}});
  const send=vi.fn<(to:string,text:string,id:string)=>Promise<void>>().mockResolvedValue(undefined);
  const challenges=new SecurityChallenges(prisma,'fixture-strong-security-secret-at-least-32',{available:true,send});
  const service=new FlupFlapAccountSecurity(prisma,challenges);
  const code=(index=0)=>send.mock.calls[index][1].match(/code is (\d{6})/)![1];
  return {customer,password,send,challenges,service,code};
}
it('stores only digests, commits guesses, and rejects a code after five failures',async()=>{
  const f=await fixture(),r=await f.challenges.issue(f.customer.id,'test',f.customer.email!,'bound');
  expect(JSON.stringify(r)).not.toContain(f.code());
  const wrong=f.code()==='000000'?'111111':'000000';
  for(let i=0;i<5;i++)await expect(f.challenges.consume(r.challengeId,f.customer.id,'test',wrong,'bound')).rejects.toMatchObject({code:'SECURITY_CODE_INVALID'});
  const row=await prisma.securityChallenge.findUniqueOrThrow({where:{id:r.challengeId}});
  expect(row.attempts).toBe(5);expect(row.codeHash).not.toContain(f.code());
  await expect(f.challenges.consume(r.challengeId,f.customer.id,'test',f.code(),'bound')).rejects.toThrow();
});
it('rejects wrong purpose, changed binding, expiry, cross-account use and replay',async()=>{
  const f=await fixture(),r=await f.challenges.issue(f.customer.id,'test',f.customer.email!,'bound');
  for(const [owner,purpose,binding] of [['other','test','bound'],[f.customer.id,'other','bound'],[f.customer.id,'test','changed']]) {
    await expect(f.challenges.consume(r.challengeId,owner,purpose,f.code(),binding)).rejects.toThrow();
  }
  await f.challenges.consume(r.challengeId,f.customer.id,'test',f.code(),'bound');
  await expect(f.challenges.consume(r.challengeId,f.customer.id,'test',f.code(),'bound')).rejects.toThrow();
  const g=await fixture(),expired=await g.challenges.issue(g.customer.id,'test',g.customer.email!,'bound');
  await prisma.securityChallenge.update({where:{id:expired.challengeId},data:{expiresAt:new Date(0)}});
  await expect(g.challenges.consume(expired.challengeId,g.customer.id,'test',g.code(),'bound')).rejects.toThrow();
});
it('invalidates challenges after delivery failure and throttles resends',async()=>{
  const f=await fixture();f.send.mockRejectedValue(new Error('delivery failed'));
  await expect(f.challenges.issue(f.customer.id,'test',f.customer.email!,'bound')).rejects.toMatchObject({code:'SECURITY_EMAIL_UNAVAILABLE'});
  const row=await prisma.securityChallenge.findFirstOrThrow({where:{ownerId:f.customer.id}});
  expect(row.consumedAt).not.toBeNull();
  await expect(f.challenges.issue(f.customer.id,'test',f.customer.email!,'bound')).rejects.toMatchObject({code:'SECURITY_RATE_LIMITED'});
});
it('challenges unfamiliar sign-ins and binds trusted device tokens to one account and credential version',async()=>{
  const f=await fixture(),r=(await f.service.loginChallenge(f.customer))!;
  const token=await f.service.confirmLogin(f.customer,r.challengeId,f.code());
  expect(await f.service.loginChallenge(f.customer,token)).toBeUndefined();
  const other=await fixture();expect(await other.service.loginChallenge(other.customer,token)).toHaveProperty('challengeId');
  const repo=new FlupFlapIdentityRepository(prisma);await repo.revokeAll(f.customer.id);
  expect(await prisma.flupFlapTrustedDevice.count({where:{customerId:f.customer.id}})).toBe(0);
  const updated=await prisma.flupFlapCustomer.findUniqueOrThrow({where:{id:f.customer.id}});
  await expect(f.service.confirmLogin(updated,r.challengeId,f.code())).rejects.toThrow();
});
it('requires current password and inbox proof before password changes, then revokes all sessions',async()=>{
  const f=await fixture();
  await expect(f.service.startPassword(f.customer,'wrong')).rejects.toMatchObject({code:'REAUTHENTICATION_REQUIRED'});
  expect(f.send).not.toHaveBeenCalled();
  await prisma.flupFlapSession.create({data:{customerId:f.customer.id,authVersion:0,refreshHash:randomUUID(),expiresAt:new Date(Date.now()+60000)}});
  const r=await f.service.startPassword(f.customer,f.password);
  await f.service.changePassword(f.customer,f.password,'new-secure-password',r.challengeId,f.code());
  const updated=await prisma.flupFlapCustomer.findUniqueOrThrow({where:{id:f.customer.id}});
  expect(await bcrypt.compare('new-secure-password',updated.passwordHash!)).toBe(true);
  expect(updated.authVersion).toBe(1);expect(await prisma.flupFlapSession.count({where:{customerId:f.customer.id}})).toBe(0);
});
it('requires proof from both old and new inboxes and never applies an unverified email',async()=>{
  const f=await fixture(),email=randomUUID()+'@example.test';
  const old=await f.service.startEmail(f.customer,f.password,email);
  expect(f.send.mock.calls[0][0]).toBe(f.customer.email);
  await expect(f.service.changeEmail(f.customer,f.password,email,old.challengeId,f.code())).rejects.toThrow();
  const next=await f.service.confirmCurrentEmail(f.customer,f.password,email,old.challengeId,f.code());
  expect(f.send.mock.calls[1][0]).toBe(email);
  expect((await prisma.flupFlapCustomer.findUniqueOrThrow({where:{id:f.customer.id}})).email).toBe(f.customer.email);
  await expect(f.service.changeEmail(f.customer,f.password,'different@example.test',next.challengeId,f.code(1))).rejects.toThrow();
  await f.service.changeEmail(f.customer,f.password,email,next.challengeId,f.code(1));
  const updated=await prisma.flupFlapCustomer.findUniqueOrThrow({where:{id:f.customer.id}});
  expect(updated.email).toBe(email);expect(updated.emailVerifiedAt).not.toBeNull();expect(updated.authVersion).toBe(1);
  expect(f.send.mock.calls.slice(2).map(c=>c[0])).toEqual([f.customer.email,email]);
});
async function admin(){
  const f=await fixture();const user=await prisma.user.create({data:{email:randomUUID()+'@example.test',role:'ADMIN',passwordHash:await bcrypt.hash(f.password,4)}});
  const mfa=new AdminMfaService(prisma,f.challenges,'fixture-encryption-secret-with-32-characters');
  const access='Bearer fixture-primary-access';
  const start=await mfa.start(user.id,f.password,access);
  const setup=await mfa.setup(user.id,f.password,access,start.challengeId,f.code());
  const token=new TOTP({secret:setup.secret,algorithm:'SHA1',digits:6,period:30}).generate();
  return {...f,user,mfa,access,setup,token};
}
it('encrypts authenticator secrets and requires MFA proof bound to the staff account and access token',async()=>{
  const f=await admin();const result=await f.mfa.verify(f.user.id,f.password,f.access,f.token,true);
  const row=await prisma.adminMfa.findUniqueOrThrow({where:{userId:f.user.id}});
  expect(row.secretEncrypted).not.toContain(f.setup.secret);expect(row.pendingEncrypted).toBeNull();
  expect(await f.mfa.authorized(f.user.id,f.access,result.proof)).toBe(true);
  expect(await f.mfa.authorized(f.user.id,'different access',result.proof)).toBe(false);
  expect(await f.mfa.authorized(f.user.id,f.access)).toBe(false);
  expect(result.recoveryCodes).toHaveLength(10);expect(JSON.stringify(row.recoveryHashes)).not.toContain(result.recoveryCodes![0]);
  await prisma.user.update({where:{id:f.user.id},data:{passwordHash:await bcrypt.hash('changed-password',4)}});
  expect(await f.mfa.authorized(f.user.id,f.access,result.proof)).toBe(false);
});
it('refuses TOTP replay, makes recovery codes single use, and locks repeated guesses',async()=>{
  const f=await admin(),enabled=await f.mfa.verify(f.user.id,f.password,f.access,f.token,true);
  await expect(f.mfa.verify(f.user.id,f.password,f.access,f.token)).rejects.toThrow();
  const recovery=enabled.recoveryCodes![0];await f.mfa.verify(f.user.id,f.password,f.access,recovery);
  await expect(f.mfa.verify(f.user.id,f.password,f.access,recovery)).rejects.toThrow();
  for(let i=0;i<4;i++)await expect(f.mfa.verify(f.user.id,f.password,f.access,'wrong-code')).rejects.toThrow();
  await expect(f.mfa.verify(f.user.id,f.password,f.access,enabled.recoveryCodes![1])).rejects.toThrow();
  expect((await prisma.adminMfa.findUniqueOrThrow({where:{userId:f.user.id}})).lockedUntil).not.toBeNull();
});
