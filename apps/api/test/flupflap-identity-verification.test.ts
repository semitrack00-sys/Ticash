import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { pglitePrisma } from './helpers/pglite-prisma.js';
import { FlupFlapIdentity, safeIdentityUrl } from '../src/flupflap/identity.js';
import { identityRequired } from '../src/flupflap/identity-policy.js';
import { DiditRestProvider } from '../src/kyc/didit-provider.js';
import { createRechargeFraudGate, approveRechargeReview } from '../src/topup/fraud-gate.js';
import { PrismaMobileTopUpRepository } from '../src/topup/repository.js';

const db=new PGlite(); const prisma=new PrismaClient({adapter:pglitePrisma(db)});
const workflowId=randomUUID();
beforeAll(async()=>{
  const root=fileURLToPath(new URL('../../../migrations/',import.meta.url));
  for(const dir of readdirSync(root).sort())if(dir.includes('_'))await db.exec(readFileSync(root+dir+'/migration.sql','utf8'));
},60000);
afterAll(async()=>{await prisma.$disconnect();await db.close();});
async function fixture(){
  const customer=await prisma.flupFlapCustomer.create({data:{passwordHash:'fixture',email:randomUUID()+'@example.test',
    emailVerifiedAt:new Date(),phoneVerifiedAt:new Date(),createdAt:new Date(Date.now()-10*86400000)}});
  const sessionId=randomUUID();
  const provider={createSession:vi.fn().mockResolvedValue({sessionId,sessionToken:'fixture',hostedUrl:'https://verify.didit.me/en/session/fixture',status:'Approved'}),
    getDecision:vi.fn().mockResolvedValue({sessionId,workflowId,vendorData:'flupflap:'+customer.id,status:'Approved',identityChecksPassed:true})};
  return {customer,sessionId,provider,service:new FlupFlapIdentity(prisma,provider,workflowId,true)};
}
it('requires contact proof and explicit consent before creating a provider session',async()=>{
  const {customer,provider,service}=await fixture();
  await expect(service.start(customer.id,false)).rejects.toMatchObject({code:'IDENTITY_CONSENT_REQUIRED'});
  await prisma.flupFlapCustomer.update({where:{id:customer.id},data:{phoneVerifiedAt:null}});
  await expect(service.start(customer.id,true)).rejects.toMatchObject({code:'CONTACT_VERIFICATION_REQUIRED'});
  expect(provider.createSession).not.toHaveBeenCalled();
});
it('reuses pending sessions and ignores approval returned by session creation',async()=>{
  const {customer,provider,service}=await fixture();
  await service.start(customer.id,true);await service.start(customer.id,true);
  expect(provider.createSession).toHaveBeenCalledOnce();
  expect((await prisma.flupFlapIdentity.findUniqueOrThrow({where:{customerId:customer.id}})).status).toBe('PENDING');
  expect(await service.check(prisma as never,customer.id,26)).toBe('IDENTITY_VERIFICATION_REQUIRED');
  expect(await service.refresh(customer.id)).toEqual({status:'APPROVED'});
  expect(await service.check(prisma as never,customer.id,26)).toBeUndefined();
  expect((await prisma.flupFlapIdentity.findUniqueOrThrow({where:{customerId:customer.id}})).hostedUrl).toBeNull();
});
it.each(['vendorData','workflowId','sessionId'])('rejects mismatched %s',async field=>{
  const {customer,provider,service}=await fixture();await service.start(customer.id,true);
  provider.getDecision.mockResolvedValueOnce({...await provider.getDecision(),[field]:randomUUID()});
  await expect(service.refresh(customer.id)).rejects.toMatchObject({code:'IDENTITY_PROVIDER_MISMATCH'});
  expect(await service.check(prisma as never,customer.id,26)).toBe('IDENTITY_VERIFICATION_REQUIRED');
});
it('requires every identity check and observes revocation and stale evidence',async()=>{
  const {customer,provider,service}=await fixture();await service.start(customer.id,true);
  provider.getDecision.mockResolvedValueOnce({...await provider.getDecision(),identityChecksPassed:false});
  expect(await service.refresh(customer.id)).toEqual({status:'IN_REVIEW'});
  expect(await service.check(prisma as never,customer.id,5)).toBe('IDENTITY_VERIFICATION_REQUIRED');
  await service.refresh(customer.id);
  await prisma.flupFlapIdentity.update({where:{customerId:customer.id},data:{checkedAt:new Date(Date.now()-121000)}});
  expect(await service.check(prisma as never,customer.id,26)).toBe('IDENTITY_VERIFICATION_REQUIRED');
  provider.getDecision.mockResolvedValueOnce({...await provider.getDecision(),status:'Declined'});
  await service.refresh(customer.id);
  expect(await service.check(prisma as never,customer.id,5)).toBe('IDENTITY_VERIFICATION_REQUIRED');
});
it('checks spend boundaries and fraud flags without raising limits',()=>{
  expect(identityRequired(25,25,false)).toBe(false);
  expect(identityRequired(25.01,0,false)).toBe(true);
  expect(identityRequired(10,40.01,false)).toBe(true);
  expect(identityRequired(1,0,true)).toBe(true);
});
it('accepts only the hosted provider origin',()=>{
  for(const url of ['https://verify.didit.me.evil.test/session/x','https://user@verify.didit.me/session/x','http://verify.didit.me/session/x','https://verify.didit.me:444/session/x'])expect(safeIdentityUrl(url)).toBe(false);
  expect(safeIdentityUrl('https://verify.didit.me/en/session/x')).toBe(true);
});
it.each(['id_verifications','liveness_checks','face_matches'])('does not trust an overall approval without %s',async missing=>{
  const body={session_id:randomUUID(),status:'Approved',id_verifications:[{status:'Approved'}],liveness_checks:[{status:'Approved'}],face_matches:[{status:'Approved'}]};
  const provider=new DiditRestProvider({enabled:true,apiKey:'fixture',baseUrl:'https://verification.didit.me'},async()=>new Response(JSON.stringify({...body,[missing]:null})));
  expect((await provider.getDecision(body.session_id)).identityChecksPassed).toBe(false);
});
it('cannot override failed card checks with identity approval',async()=>{
  const {customer,service}=await fixture();await service.start(customer.id,true);await service.refresh(customer.id);
  const stripe={fraudEvidence:async()=>({chargeId:'ch_fixture',fingerprint:'card',risk:'normal',authentication:'authenticated',paymentType:'card',review:false,disputed:false,refunded:false,postalCodeCheck:'fail'})};
  const record={id:randomUUID(),userId:'flupflap:'+customer.id,totalChargeUsd:5,paymentProvider:'STRIPE',paymentProviderTransactionId:'pi_fixture'};
  expect(await createRechargeFraudGate(prisma,stripe as never,service,true)(record as never)).toBe('PAYMENT_CARD_CHECK_FAILED');
  await expect(approveRechargeReview(prisma,stripe as never,record as never,'staff','Reviewed',service,true)).rejects.toMatchObject({code:'FRAUD_REVIEW_NOT_CLEAR'});
});
it('blocks checkout before consuming a quote until fresh identity proof is available',async()=>{
  const {customer,service}=await fixture();const repo=new PrismaMobileTopUpRepository(prisma,true,service);
  const quote=await repo.createQuote({userId:'flupflap:'+customer.id,countryCode:'HT',recipientPhone:'+50912345678',operatorId:173,operatorName:'Fixture',productId:'fixture',productName:'Fixture',kind:'AIRTIME',providerAmount:30,providerCurrency:'USD',deliveredCurrency:'HTG',feeUsd:0,totalChargeUsd:30,testMode:false,expiresAt:new Date(Date.now()+300000).toISOString()});
  const {expiresAt,consumedAt,...snapshot}=quote;void expiresAt;void consumedAt;
  const input={...snapshot,id:randomUUID(),quoteId:quote.id,idempotencyKey:randomUUID(),requestHash:'fixture',paymentEnvironment:'PRODUCTION' as const,rechargeEnvironment:'PRODUCTION' as const,customIdentifier:randomUUID(),status:'PENDING' as const,paymentStatus:'PENDING' as const,updatedAt:new Date().toISOString()};
  await expect(repo.reserveTransaction(input)).rejects.toMatchObject({code:'IDENTITY_VERIFICATION_REQUIRED'});
  expect((await prisma.mobileTopUpQuote.findUniqueOrThrow({where:{id:quote.id}})).consumedAt).toBeNull();
  await service.start(customer.id,true);
  expect((await repo.reserveTransaction(input)).created).toBe(true);
});
