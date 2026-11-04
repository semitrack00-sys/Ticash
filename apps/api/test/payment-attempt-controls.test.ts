import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { pglitePrisma } from './helpers/pglite-prisma.js';
import { PrismaMobileTopUpRepository } from '../src/topup/repository.js';
import { paymentAttemptReviewReason, paymentAttemptAccess } from '../src/topup/payment-attempt-controls.js';
import { verifyStripeEvent } from '../src/topup/stripe-webhook.js';
import { createRechargeFraudGate, approveRechargeReview } from '../src/topup/fraud-gate.js';
import { checkRechargeDevice } from '../src/flupflap/device-security.js';
import { MobileTopUpService } from '../src/topup/service.js';
import { StripeSandboxPaymentProvider } from '../src/topup/stripe-provider.js';

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
  const access=await paymentAttemptAccess(prisma,c.id);
  expect(access?.purchaseAccess).toMatchObject({mode:'TEMPORARY_LIMIT',retryAt:expect.any(String),retryAfterSeconds:expect.any(Number)});
  expect(await paymentAttemptReviewReason(prisma,c.id,new Date(access!.purchaseAccess.retryAt))).toBeUndefined();
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

it('admin cancellation updates only the unchanged unpaid reservation and preserves history',async()=>{
  const c=await buyer(),r=(await repo.reserveTransaction(await input(c.id))).record;
  expect(await repo.cancelPendingByAdmin(r,new Date().toISOString())).toBe(true);
  expect(await repo.cancelPendingByAdmin(r,new Date().toISOString())).toBe(false);
  expect(await repo.getTransactionById(r.id)).toMatchObject({status:'FAILED',paymentStatus:'FAILED',failureCode:'CANCELLED_BY_ADMIN'});
});
it('admin cancellation cannot overwrite a concurrent authorization with unchanged payment status',async()=>{
  const c=await buyer(),r=(await repo.reserveTransaction(await input(c.id))).record;
  await prisma.mobileTopUpTransaction.update({where:{id:r.id},data:{paymentAuthorizationId:'pi_racing'}});
  expect(await repo.cancelPendingByAdmin(r,new Date().toISOString())).toBe(false);
  expect(await repo.getTransactionById(r.id)).toMatchObject({status:'PENDING',paymentAuthorizationId:'pi_racing'});
});

async function securityRefundFixture(enabled=true) {
  const c=await buyer(),r=(await repo.reserveTransaction(await input(c.id))).record;
  await repo.updateTransaction(r.id,{paymentStatus:'CAPTURED',paymentProviderTransactionId:'pi_'+r.id.replaceAll('-',''),failureCode:'FRAUD_REVIEW_REQUIRED',paymentRecoveryCode:'PAYMENT_CARD_CHECK_FAILED'});
  const held=(await repo.getTransactionById(r.id))!;
  const stripe={fraudEvidence:vi.fn().mockResolvedValue({...safe,cvcCheck:'fail'}),
    getPayment:vi.fn().mockResolvedValue({id:held.paymentProviderTransactionId,status:'succeeded',livemode:true,currency:'usd',amount:500,amount_received:500,metadata:{transactionId:r.id}}),
    refund:vi.fn().mockResolvedValue('REFUNDED'),getRecoveryStatus:vi.fn().mockResolvedValue('REFUNDED')};
  const submit=vi.fn(),audit=vi.fn();
  const service=new MobileTopUpService({enabled:true,testMode:false} as never,{submitTopUp:submit} as never,{} as never,repo,audit,undefined,stripe as never,undefined,undefined,false,undefined,undefined,undefined,undefined,enabled);
  vi.spyOn(service as never,'assertTransactionEnvironment' as never).mockImplementation(()=>undefined);
  return {r:held,stripe,submit,audit,service};
}
it('automatically refunds one captured failure once under concurrent delivery attempts',async()=>{
  const {r,stripe,submit,service}=await securityRefundFixture();
  await Promise.all([service.fulfillPaidRecharge(r.id),service.fulfillPaidRecharge(r.id)]);
  expect(stripe.refund).toHaveBeenCalledTimes(1);
  expect(stripe.refund).toHaveBeenCalledWith({paymentId:r.paymentProviderTransactionId,transactionId:r.id,amountMinor:500});
  expect(await repo.getTransactionById(r.id)).toMatchObject({status:'FAILED',paymentStatus:'REFUNDED',failureCode:'SECURITY_REFUND_REQUIRED'});
  await service.fulfillPaidRecharge(r.id);
  expect(stripe.refund).toHaveBeenCalledTimes(1);expect(submit).not.toHaveBeenCalled();
});
it('does not refund when the rollout switch is disabled',async()=>{
  const {r,stripe,service}=await securityRefundFixture(false);await service.fulfillPaidRecharge(r.id);
  expect(stripe.refund).not.toHaveBeenCalled();expect(stripe.fraudEvidence).not.toHaveBeenCalled();
});
it.each([
  {cvcCheck:'unavailable'}, {cvcCheck:'unchecked'}, {cvcCheck:undefined},
  {cvcCheck:'pass',risk:'elevated'}, {review:true}, {},
])('refunds rejected undelivered orders instead of retaining a review hold: %j',async patch=>{
  const {r,stripe,service}=await securityRefundFixture();stripe.fraudEvidence.mockResolvedValue({...safe,...patch});
  await service.fulfillPaidRecharge(r.id);expect(stripe.refund).toHaveBeenCalledTimes(1);
  expect((await repo.getTransactionById(r.id))?.paymentStatus).toBe('REFUNDED');
});
it.each([{amount:501},{amount_received:0},{livemode:false},{currency:'eur'},{metadata:{transactionId:'other'}},{status:'processing'}])('does not refund mismatched Stripe payment: %j',async patch=>{
  const {r,stripe,service}=await securityRefundFixture();stripe.getPayment.mockResolvedValue({...await stripe.getPayment(),...patch});
  await service.fulfillPaidRecharge(r.id);expect(stripe.refund).not.toHaveBeenCalled();
});
it('does not refund after delivery wins the atomic race',async()=>{
  const {r,stripe,service}=await securityRefundFixture();
  stripe.getPayment.mockImplementationOnce(async()=>{
    await repo.updateTransaction(r.id,{fulfillmentStartedAt:new Date().toISOString(),status:'PROCESSING'});
    return {id:r.paymentProviderTransactionId,status:'succeeded',livemode:true,currency:'usd',amount:500,amount_received:500,metadata:{transactionId:r.id}};
  });
  await service.fulfillPaidRecharge(r.id);expect(stripe.refund).not.toHaveBeenCalled();
});
it('keeps lost refund responses pending and never reports an unconfirmed refund as complete',async()=>{
  const {r,stripe,service,submit}=await securityRefundFixture();stripe.refund.mockRejectedValue(new Error('timeout'));
  await service.fulfillPaidRecharge(r.id);
  expect(await repo.getTransactionById(r.id)).toMatchObject({status:'FAILED',paymentStatus:'REFUND_PENDING'});
  expect(await repo.claimOperation(r.id,'fulfillment',new Date().toISOString())).toBe(false);
  expect(submit).not.toHaveBeenCalled();
});
it('stops before refunding when audit persistence fails',async()=>{
  const {r,stripe,service,audit}=await securityRefundFixture();audit.mockRejectedValue(new Error('audit unavailable'));
  await expect(service.fulfillPaidRecharge(r.id)).rejects.toThrow('audit unavailable');expect(stripe.refund).not.toHaveBeenCalled();
});
it('customer refresh cannot initiate an automatic refund',async()=>{
  const {r,stripe,service}=await securityRefundFixture();
  await service.getTransaction(r.userId,r.id,true);
  expect(stripe.refund).not.toHaveBeenCalled();expect(stripe.fraudEvidence).not.toHaveBeenCalled();
});
it('confirms a previously pending refund from Stripe without submitting it again',async()=>{
  const {r,stripe,service}=await securityRefundFixture();stripe.refund.mockRejectedValue(new Error('lost response'));
  await service.fulfillPaidRecharge(r.id);
  expect((await service.getTransaction(r.userId,r.id,true)).paymentStatus).toBe('REFUNDED');
  expect(stripe.refund).toHaveBeenCalledTimes(1);
});

it.each(['REFUNDED', 'REFUND_PENDING'] as const)('signed checkout replay preserves %s and never delivers held airtime', async refundStatus => {
  const {r,stripe,service,submit}=await securityRefundFixture();
  stripe.refund.mockResolvedValue(refundStatus);
  vi.spyOn(service as never,'runtimeEnvironment' as never).mockReturnValue('PRODUCTION' as never);
  await repo.updateTransaction(r.id,{paymentStatus:'SESSION_CREATED',failureCode:'PAYMENT_RECOVERED'});
  const t=Math.floor(Date.now()/1000);
  const raw=Buffer.from(JSON.stringify({id:'evt_'+randomUUID(),livemode:true,created:t,type:'checkout.session.completed',data:{object:{
    id:r.paymentSessionId,payment_intent:r.paymentProviderTransactionId,payment_status:'paid',amount_total:500,currency:'usd',metadata:{transactionId:r.id},
  }}}));
  const signature=createHmac('sha256','fixture-secret').update(`${t}.${raw}`).digest('hex');
  const verified=verifyStripeEvent(raw,`t=${t},v1=${signature}`,'fixture-secret');
  await service.acceptVerifiedPaymentEvent(verified);
  await service.acceptVerifiedPaymentEvent(verified);
  expect((await repo.getTransactionById(r.id))?.paymentStatus).toBe(refundStatus);
  expect(stripe.refund).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
  expect((await prisma.mobileTopUpPaymentEvent.findUniqueOrThrow({where:{provider_eventId:{provider:'STRIPE',eventId:verified.eventId}}})).processedAt).not.toBeNull();
});

it.each([false, true])('runs sandbox refund orchestration with real provider parsing and database; lost response=%s',async lostResponse=>{
  const {r}=await securityRefundFixture();
  await prisma.mobileTopUpTransaction.update({where:{id:r.id},data:{testMode:true,paymentEnvironment:'SANDBOX',rechargeEnvironment:'SANDBOX'}});
  let refunded=false; const posts:string[]=[];
  const refund={id:'re_sandbox',status:'succeeded',amount:500,currency:'usd',payment_intent:r.paymentProviderTransactionId,metadata:{transactionId:r.id}};
  const transport:typeof fetch=async(url,init)=>{
    if(init?.method==='POST') {
      expect(String(url)).toBe('https://api.stripe.com/v1/refunds');
      posts.push(new Headers(init.headers).get('Idempotency-Key')!);refunded=true;
      if(lostResponse)throw new Error('response lost');
      return Response.json(refund);
    }
    if(String(url).includes('/v1/refunds?'))return Response.json({data:refunded?[refund]:[]});
    return Response.json({id:r.paymentProviderTransactionId,status:'succeeded',livemode:false,currency:'usd',amount:500,amount_received:500,metadata:{transactionId:r.id},
      latest_charge:{id:'ch_sandbox',paid:true,captured:true,amount_refunded:refunded?500:0,disputed:false,outcome:{risk_level:'normal'},payment_method_details:{type:'card',card:{fingerprint:'sandbox',checks:{cvc_check:'pass',address_postal_code_check:'fail'}}}}});
  };
  const stripe=new StripeSandboxPaymentProvider({enabled:true,environment:'sandbox',testMode:true,secretKey:'sk_test_fixture',publicKey:'pk_test_fixture',webhookSecret:'whsec_fixture',successUrl:'https://flupflap.com/success',failureUrl:'https://flupflap.com/failure'},transport);
  const submit=vi.fn();
  const service=new MobileTopUpService({enabled:true,environment:'sandbox'} as never,{submitTopUp:submit} as never,{} as never,repo,async()=>{},undefined,stripe,undefined,undefined,false,undefined,createRechargeFraudGate(prisma,stripe),undefined,undefined,true);
  await service.fulfillPaidRecharge(r.id);
  expect((await repo.getTransactionById(r.id))?.paymentStatus).toBe(lostResponse?'REFUND_PENDING':'REFUNDED');
  expect((await service.getTransaction(r.userId,r.id,true)).paymentStatus).toBe('REFUNDED');
  expect(posts).toEqual([r.id+':refund']);expect(submit).not.toHaveBeenCalled();
});

it('rejects a live order in the sandbox runtime before any provider action',async()=>{
  const {r,stripe}=await securityRefundFixture();
  const service=new MobileTopUpService({enabled:true,environment:'sandbox'} as never,{} as never,{} as never,repo,async()=>{},undefined,stripe as never,undefined,undefined,false,undefined,undefined,undefined,undefined,true);
  await expect(service.fulfillPaidRecharge(r.id)).rejects.toMatchObject({code:'TOPUP_ENVIRONMENT_MISMATCH'});
  expect(stripe.refund).not.toHaveBeenCalled();expect(stripe.fraudEvidence).not.toHaveBeenCalled();
});

it.each([{disputed:true},{refunded:true}])('never double-refunds reversed/disputed holds: %j',async patch=>{
  const {r,stripe,service,submit}=await securityRefundFixture();
  stripe.fraudEvidence.mockResolvedValue({...safe,...patch});
  await service.fulfillPaidRecharge(r.id);
  expect(stripe.refund).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();
});
it('background reconciliation selects captured holds and refunds without a customer retry',async()=>{
  const {r,stripe,service,submit}=await securityRefundFixture();
  vi.spyOn(service as never,'runtimeEnvironment' as never).mockReturnValue('PRODUCTION' as never);
  await prisma.mobileTopUpTransaction.update({where:{id:r.id},data:{updatedAt:new Date('2020-01-01')}});
  await service.reconcilePendingTransactions(100);
  expect((await repo.getTransactionById(r.id))?.paymentStatus).toBe('REFUNDED');
  expect(stripe.refund).toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();
});
it('provider lookup failure defers a hold without refunding, delivering or starving the next batch',async()=>{
  const {r,stripe,service,submit}=await securityRefundFixture();
  vi.spyOn(service as never,'runtimeEnvironment' as never).mockReturnValue('PRODUCTION' as never);
  stripe.fraudEvidence.mockRejectedValue(new Error('Stripe unavailable'));
  await prisma.mobileTopUpTransaction.update({where:{id:r.id},data:{updatedAt:new Date('2019-01-01')}});
  await service.reconcilePendingTransactions(1);
  const current=(await repo.getTransactionById(r.id))!;
  expect(current.paymentStatus).toBe('CAPTURED');
  expect(Date.parse(current.updatedAt)).toBeGreaterThan(Date.now()-15000);
  expect(stripe.refund).not.toHaveBeenCalled();expect(submit).not.toHaveBeenCalled();
});
