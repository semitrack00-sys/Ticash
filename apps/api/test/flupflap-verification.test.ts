import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { pglitePrisma } from './helpers/pglite-prisma.js';
import { FlupFlapVerification } from '../src/flupflap/verification.js';

const db=new PGlite(); const prisma=new PrismaClient({adapter:pglitePrisma(db)});
beforeAll(async()=>{
  const root=fileURLToPath(new URL('../../../migrations/',import.meta.url));
  for(const dir of readdirSync(root).sort())if(dir.includes('_'))await db.exec(readFileSync(root+dir+'/migration.sql','utf8'));
},60000);
afterAll(async()=>{await prisma.$disconnect();await db.close();});
async function fixture(){
  const customer=await prisma.flupFlapCustomer.create({data:{passwordHash:'fixture',email:randomUUID()+'@example.test',phone:'+1'+String(Math.floor(Math.random()*9000000000+1000000000))}});
  const send=vi.fn<(channel:string,destination:string,code:string,id:string)=>Promise<void>>().mockResolvedValue(undefined);
  const service=new FlupFlapVerification(prisma,'test-secret-with-at-least-32-characters',{available:()=>true,send});
  return {customer,send,service};
}
it('verifies saved email once without returning or storing the code',async()=>{
  const {customer,send,service}=await fixture();
  const result=await service.send(customer.id,'email');
  const code=send.mock.calls[0][2];
  expect(send.mock.calls[0][1]).toBe(customer.email);
  expect(JSON.stringify(result)).not.toContain(code);
  const row=await prisma.flupFlapVerificationChallenge.findUniqueOrThrow({where:{id:result.challengeId}});
  expect(row.codeHash).not.toBe(code);
  expect((await prisma.flupFlapCustomer.findUniqueOrThrow({where:{id:customer.id}})).emailVerifiedAt).toBeNull();
  await service.confirm(customer.id,'email',result.challengeId,code);
  expect((await prisma.flupFlapCustomer.findUniqueOrThrow({where:{id:customer.id}})).emailVerifiedAt).not.toBeNull();
  await expect(service.confirm(customer.id,'email',result.challengeId,code)).rejects.toMatchObject({code:'VERIFICATION_CODE_INVALID'});
});
it('commits failed attempts and blocks even the right code after five guesses',async()=>{
  const {customer,send,service}=await fixture();const {challengeId}=await service.send(customer.id,'phone',true);
  const code=send.mock.calls[0][2];const wrong=code==='000000'?'111111':'000000';
  for(let i=0;i<5;i++)await expect(service.confirm(customer.id,'phone',challengeId,wrong)).rejects.toThrow();
  expect((await prisma.flupFlapVerificationChallenge.findUniqueOrThrow({where:{id:challengeId}})).attempts).toBe(5);
  await expect(service.confirm(customer.id,'phone',challengeId,code)).rejects.toThrow();
});
it('rejects expired, cross-account, cross-channel and changed-destination codes',async()=>{
  const {customer,send,service}=await fixture();const {challengeId}=await service.send(customer.id,'email');const code=send.mock.calls[0][2];
  const other=await fixture();
  await expect(service.confirm(other.customer.id,'email',challengeId,code)).rejects.toThrow();
  await expect(service.confirm(customer.id,'phone',challengeId,code)).rejects.toThrow();
  await prisma.flupFlapCustomer.update({where:{id:customer.id},data:{email:randomUUID()+'@example.test'}});
  await expect(service.confirm(customer.id,'email',challengeId,code)).rejects.toThrow();
  await prisma.flupFlapCustomer.update({where:{id:customer.id},data:{email:customer.email}});
  await prisma.flupFlapVerificationChallenge.update({where:{id:challengeId},data:{expiresAt:new Date(0)}});
  await expect(service.confirm(customer.id,'email',challengeId,code)).rejects.toThrow();
});
it('limits resends and invalidates older codes',async()=>{
  const {customer,send,service}=await fixture();const first=await service.send(customer.id,'email');
  await expect(service.send(customer.id,'email')).rejects.toMatchObject({code:'VERIFICATION_RATE_LIMITED'});
  await prisma.flupFlapVerificationChallenge.update({where:{id:first.challengeId},data:{createdAt:new Date(Date.now()-61000)}});
  await service.send(customer.id,'email');
  await expect(service.confirm(customer.id,'email',first.challengeId,send.mock.calls[0][2])).rejects.toThrow();
});
it('does not accept codes when delivery fails',async()=>{
  const {customer,send,service}=await fixture();send.mockRejectedValue(new Error('delivery unavailable'));
  await expect(service.send(customer.id,'phone',true)).rejects.toMatchObject({code:'VERIFICATION_DELIVERY_FAILED'});
  const call=send.mock.calls[0];
  await expect(service.confirm(customer.id,'phone',call[3],call[2])).rejects.toThrow();
});

it('requires explicit SMS consent before storing or sending a code',async()=>{
  const {customer,send,service}=await fixture();
  await expect(service.send(customer.id,'phone')).rejects.toMatchObject({code:'SMS_CONSENT_REQUIRED'});
  expect(send).not.toHaveBeenCalled();
  expect(await prisma.flupFlapVerificationChallenge.count({where:{customerId:customer.id}})).toBe(0);
});
