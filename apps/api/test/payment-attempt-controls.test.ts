import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { pglitePrisma } from './helpers/pglite-prisma.js';
import { PrismaMobileTopUpRepository } from '../src/topup/repository.js';
import { paymentAttemptReviewReason } from '../src/topup/payment-attempt-controls.js';
import { verifyStripeEvent } from '../src/topup/stripe-webhook.js';
import { createRechargeFraudGate, approveRechargeReview } from '../src/topup/fraud-gate.js';
import { checkRechargeDevice } from '../src/flupflap/device-security.js';
import { MobileTopUpService } from '../src/topup/service.js';

const db = new PGlite(); const prisma = new PrismaClient({adapter:pglitePrisma(db)});
const repo = new PrismaMobileTopUpRepository(prisma);
beforeAll(async () => {
  const root=fileURLToPath(new URL('../../../migrations/',import.meta.url));
  for(const dir of readdirSync(root).sort()) if(dir.includes('_')) await db.exec(readFileSync(root+dir+'/migration.sql','utf8'));
  await db.exec('CREATE OR REPLACE FUNCTION pg_advisory_xact_lock(bigint) RETURNS integer AS $$ SELECT 1 $$ LANGUAGE SQL');
},60000);
afterAll(async()=>{await prisma.$disconnect();await db.close();});
async function buyer() {return prisma.flupFlapCustomer.create({data:{email:randomUUID()+'@example.test',passwordHash:'fixture'}});}
async function input(customerId:string, phone='+509'+randomUUID().replace(/\D/g,'').slice(0,8).padEnd(8,'1')) {
  const quote=await repo.createQuote({userId:'flupflap:'+customerId,countryCode:'HT',recipientPhone:phone,operatorId:173,
    operatorName:'Fixture',productId:'fixture',productName:'Fixture',kind:'AIRTIME',providerAmount:5,providerCurrency:'USD',
    deliveredCurrency:'HTG',feeUsd:0,totalChargeUsd:5,testMode:false,expiresAt:new Date(Date.now()+300000).toISOString()});
  const {expiresAt,consumedAt,...snapshot}=quote; void expiresAt;void consumedAt;
  return {...snapshot,id:randomUUID(),quoteId:quote.id,idempotencyKey:randomUUID(),requestHash:'fixture',
    paymentEnvironment:'PRODUCTION' as const,rechargeEnvironment:'PRODUCTION' as const,customIdentifier:randomUUID(),
    paymentProvider:'STRIPE' as const,paymentSessionId:'cs_live_'+randomUUID().replaceAll('-',''),status:'PENDING' as const,paymentStatus:'SESSION_CREATED' as const,updatedAt:new Date().toISOString()};
}
function event(transactionId:string, charge=randomUUID(), card='fixture-card', created=Math.floor(Date.now()/1000)) {
  const raw=Buffer.from(JSON.stringify({id:'evt_'+randomUUID(),livemode:true,created,type:'payment_intent.payment_failed',data:{object:{
    id:'pi_fixture',amount:500,currency:'usd',metadata:{transactionId},last_payment_error:{charge,decline_code:'generic_decline',payment_method:{card:{fingerprint:card}}},
  }}}));
  const t=Math.floor(Date.now()/1000); const signature=createHmac('sha256','fixture-secret').update(`${t}.${raw}`).digest('hex');
  return verifyStripeEvent(raw,`t=${t},v1=${signature}`,'fixture-secret');
}
async function save(e:ReturnType<typeof event>) {return repo.registerPaymentEvent(e.eventId,e.payloadHash,e.transactionId,e.attempt);}
const safe={chargeId:'ch_safe',fingerprint:'safe-card',risk:'normal',authentication:'authenticated',postalCodeCheck:'pass',cvcCheck:'pass',paymentType:'card',review:false,disputed:false,refunded:false};
it('deduplicates charge attempts, blocks new reservations without consuming quotes, and expires the cooldown',async()=>{
  const c=await buyer(),r=(await repo.reserveTransaction(await input(c.id))).record;
  const first=event(r.id,'ch_first');await save(first);await save(first);await save(event(r.id,'ch_first'));
  await save(event(r.id,'ch_second'));
  expect(await paymentAttemptReviewReason(prisma,c.id)).toBeUndefined();
  await save(event(r.id,'ch_third'));
  expect(await paymentAttemptReviewReason(prisma,c.id)).toBe('PAYMENT_ATTEMPT_LIMIT');
  const next=await input(c.id);
  await expect(repo.reserveTransaction(next)).rejects.toMatchObject({code:'PAYMENT_ATTEMPT_LIMIT'});
  expect((await prisma.mobileTopUpQuote.findUniqueOrThrow({where:{id:next.quoteId}})).consumedAt).toBeNull();
  expect(await paymentAttemptReviewReason(prisma,c.id,new Date(Date.now()+16*60000))).toBeUndefined();
  const stored=await prisma.auditLog.findMany({where:{entityId:r.id,action:'FLUPFLAP_PAYMENT_ATTEMPT_FAILED'}});
  expect(stored).toHaveLength(3);
  const fingerprint=(stored[0].metadata as {fingerprint:string}).fingerprint;
  expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);expect(fingerprint).not.toBe('fixture-card');
});
it('shares failed-card limits across an installation and holds a third paid card before delivery',async()=>{
  const a=await buyer(),b=await buyer(), device=randomUUID().replaceAll('-','').repeat(2);
  await checkRechargeDevice(prisma,a.id,device);await checkRechargeDevice(prisma,b.id,device);
  const r=(await repo.reserveTransaction(await input(a.id))).record;
  await save(event(r.id,'ch_a','card-a'));await save(event(r.id,'ch_b','card-b'));
  const pending=(await repo.reserveTransaction(await input(b.id))).record;
  const stripe={fraudEvidence:async()=>safe};
  expect(await createRechargeFraudGate(prisma,stripe as never)(pending)).toBe('PAYMENT_CARD_LIMIT');
  await expect(approveRechargeReview(prisma,stripe as never,pending,'staff','Review must not bypass card limits')).rejects.toMatchObject({code:'FRAUD_REVIEW_NOT_CLEAR'});
  await save(event(r.id,'ch_c','card-c',Math.floor(Date.now()/1000)-1200));
  await expect(checkRechargeDevice(prisma,b.id,device)).rejects.toMatchObject({code:'PAYMENT_CARD_LIMIT'});
});
it('holds a recipient funded by three accounts within one hour',async()=>{
  const phone='+509'+randomUUID().replace(/\D/g,'').slice(0,8).padEnd(8,'2');
  const rows=[];
  for(let i=0;i<3;i++){const c=await buyer();rows.push((await repo.reserveTransaction(await input(c.id,phone))).record);}
  expect(await createRechargeFraudGate(prisma,{fraudEvidence:async()=>safe} as never)(rows[2]!)).toBe('SHARED_RECIPIENT_REVIEW');
});
it('expires the hosted checkout on the third signed failure, including webhook retries',async()=>{
  const c=await buyer(),r=(await repo.reserveTransaction(await input(c.id))).record;
  await save(event(r.id,'ch_1'));await save(event(r.id,'ch_2'));
  const expire=vi.fn().mockRejectedValueOnce(new Error('temporary Stripe failure')).mockResolvedValue(undefined);
  const stripe={getHostedCheckoutPaymentState:vi.fn().mockResolvedValue({status:'open'}),expireHostedCheckoutSession:expire};
  const service=new MobileTopUpService({enabled:true,testMode:false} as never,{} as never,{} as never,repo,async()=>{},undefined,stripe as never);
  vi.spyOn(service as never,'runtimeEnvironment' as never).mockReturnValue('PRODUCTION' as never);
  const third=event(r.id,'ch_3');
  await expect(service.acceptVerifiedPaymentEvent(third)).rejects.toThrow('temporary Stripe failure');
  expect((await prisma.mobileTopUpPaymentEvent.findUniqueOrThrow({where:{provider_eventId:{provider:'STRIPE',eventId:third.eventId}}})).processedAt).toBeNull();
  await service.acceptVerifiedPaymentEvent(third);await service.acceptVerifiedPaymentEvent(third);
  expect(expire).toHaveBeenCalledTimes(2);expect(expire).toHaveBeenLastCalledWith(r.paymentSessionId,r.id);
  expect((await repo.getTransactionById(r.id))?.paymentStatus).toBe('FAILED');
});
it('excludes old signed failures from a current cooldown',async()=>{
  const c=await buyer(),r=(await repo.reserveTransaction(await input(c.id))).record;
  for(let i=0;i<3;i++)await save(event(r.id,'ch_old'+i,'one-card',Math.floor(Date.now()/1000)-3600));
  expect(await paymentAttemptReviewReason(prisma,c.id)).toBeUndefined();
});
