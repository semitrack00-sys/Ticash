import { paymentAttemptReviewReason } from '../src/topup/payment-attempt-controls.js';
import { resetPurchaseAttempts, resetPurchaseAttemptIds } from '../src/topup/purchase-attempt-reset.js';
import { checkRechargeDevice } from '../src/flupflap/device-security.js';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaMobileTopUpRepository } from '../src/topup/repository.js';
import { FlupFlapVerification } from '../src/flupflap/verification.js';
import { createRechargeFraudGate } from '../src/topup/fraud-gate.js';

// CI supplies a disposable, fully migrated database; never use DATABASE_URL here.
const url=process.env.FRAUD_TEST_DATABASE_URL;
describe.skipIf(!url)('fraud controls across independent PostgreSQL connections',()=>{
  const clients:PrismaClient[]=[];
  beforeAll(()=>{
    for(let i=0;i<6;i++)clients.push(new PrismaClient({adapter:new PrismaPg({connectionString:url!})}));
  });
  afterAll(async()=>{await Promise.all(clients.map(c=>c.$disconnect()));});
  async function customer(){
    return clients[0]!.flupFlapCustomer.create({data:{email:randomUUID()+'@example.test',passwordHash:'fixture'}});
  }
  async function input(customerId:string, recipientPhone='+509'+randomUUID().replace(/\D/g,'').slice(0,8).padEnd(8,'1')){
    const repo=new PrismaMobileTopUpRepository(clients[0]!);
    const quote=await repo.createQuote({userId:'flupflap:'+customerId,countryCode:'HT',recipientPhone,
      operatorId:173,operatorName:'Fixture',productId:'fixture',productName:'Fixture',kind:'AIRTIME',providerAmount:5,
      providerCurrency:'USD',deliveredCurrency:'HTG',feeUsd:0,totalChargeUsd:5,testMode:false,expiresAt:new Date(Date.now()+300000).toISOString()});
    const {expiresAt,consumedAt,...snapshot}=quote;
    void expiresAt; void consumedAt;
    return {...snapshot,id:randomUUID(),quoteId:quote.id,idempotencyKey:randomUUID(),requestHash:'fixture',
      paymentEnvironment:'PRODUCTION' as const,rechargeEnvironment:'PRODUCTION' as const,customIdentifier:randomUUID(),status:'PENDING' as const,paymentStatus:'PENDING' as const,updatedAt:new Date().toISOString()};
  }
  it('allows only three concurrent reservations for one buyer',async()=>{
    const c=await customer();const inputs=await Promise.all(clients.map(()=>input(c.id)));
    const results=await Promise.allSettled(inputs.map((r,i)=>new PrismaMobileTopUpRepository(clients[i]!).reserveTransaction(r)));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(3);
    for(const result of results)if(result.status==='rejected')expect(result.reason).toMatchObject({code:'RECHARGE_LIMIT_REACHED'});
    expect(await clients[0]!.mobileTopUpTransaction.count({where:{flupFlapCustomerId:c.id}})).toBe(3);
  });
  it('reuses a single reservation for concurrent idempotent requests',async()=>{
    const c=await customer();const record=await input(c.id);
    const results=await Promise.all(clients.map(db=>new PrismaMobileTopUpRepository(db).reserveTransaction(record)));
    expect(new Set(results.map(r=>r.record.id)).size).toBe(1);
    expect(await clients[0]!.mobileTopUpTransaction.count({where:{flupFlapCustomerId:c.id}})).toBe(1);
  });
  async function resetFixture() {
    const c = await customer();
    const staff = await clients[0]!.user.create({data:{email:randomUUID()+'@example.test',passwordHash:'fixture',firstName:'Staff',lastName:'Fixture',role:'ADMIN'}});
    const records = await Promise.all(Array.from({length:3},()=>input(c.id)));
    const repo = new PrismaMobileTopUpRepository(clients[0]!);
    for (const record of records) {
      await repo.reserveTransaction(record);
      await clients[0]!.mobileTopUpTransaction.update({where:{id:record.id},data:{status:'FAILED',paymentStatus:'FAILED',failureCode:'CANCELLED_BY_CUSTOMER'}});
    }
    return {c, staff, records, repo};
  }
  it('audits reset IDs without deleting history and keeps fresh concurrent attempts limited',async()=>{
    const {c,staff,records,repo}=await resetFixture();
    await expect(repo.reserveTransaction(await input(c.id))).rejects.toMatchObject({code:'RECHARGE_LIMIT_REACHED'});
    const requestId=randomUUID().replaceAll('-','');
    expect(await resetPurchaseAttempts(clients[0]!,c.id,staff.id,'Reviewed cancelled checkout reservations',requestId)).toEqual({resetCount:3});
    expect(await clients[0]!.mobileTopUpTransaction.count({where:{flupFlapCustomerId:c.id,status:'FAILED'}})).toBe(3);
    expect((await repo.reserveTransaction(records[0]!)).created).toBe(false);
    const audit=await clients[0]!.auditLog.findUniqueOrThrow({where:{id:'purchase-reset:'+requestId}});
    expect(audit).toMatchObject({flupFlapCustomerId:c.id,action:'FLUPFLAP_PURCHASE_ATTEMPTS_RESET',metadata:expect.objectContaining({staffActorId:staff.id})});
    const inputs=await Promise.all(clients.map(()=>input(c.id)));
    const results=await Promise.allSettled(inputs.map((r,i)=>new PrismaMobileTopUpRepository(clients[i]!).reserveTransaction(r)));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(3);
    // Replaying the same admin request cannot include later reservations.
    expect(await resetPurchaseAttempts(clients[0]!,c.id,staff.id,'Reviewed cancelled checkout reservations',requestId)).toEqual({resetCount:3});
    expect(await resetPurchaseAttemptIds(clients[0]!,c.id,new Date())).toEqual(new Set(records.map(r=>r.id)));
  });
  it('refuses unresolved payments, restrictions and missing staff actors',async()=>{
    const {c,staff,records}=await resetFixture();
    await clients[0]!.mobileTopUpTransaction.update({where:{id:records[0]!.id},data:{status:'PENDING',paymentStatus:'SESSION_CREATED'}});
    await expect(resetPurchaseAttempts(clients[0]!,c.id,staff.id,'Reviewed cancelled checkout reservations',randomUUID().replaceAll('-',''))).rejects.toMatchObject({code:'PURCHASE_RESET_PAYMENT_UNRESOLVED'});
    await clients[0]!.mobileTopUpTransaction.update({where:{id:records[0]!.id},data:{status:'FAILED',paymentStatus:'FAILED'}});
    await clients[0]!.flupFlapCustomer.update({where:{id:c.id},data:{rechargeRestricted:true}});
    await expect(resetPurchaseAttempts(clients[0]!,c.id,staff.id,'Reviewed cancelled checkout reservations',randomUUID().replaceAll('-',''))).rejects.toMatchObject({code:'PURCHASE_RESET_RESTRICTED'});
    await clients[0]!.flupFlapCustomer.update({where:{id:c.id},data:{rechargeRestricted:false}});
    await expect(resetPurchaseAttempts(clients[0]!,c.id,randomUUID(),'Reviewed cancelled checkout reservations',randomUUID().replaceAll('-',''))).rejects.toMatchObject({code:'ADMIN_PERMISSION_REQUIRED'});
    expect(await resetPurchaseAttemptIds(clients[0]!,c.id,new Date())).toEqual(new Set());
  });
  it('keeps monetary budgets and other buyers recipient reservations after reset',async()=>{
    const {c,staff,records,repo}=await resetFixture();
    await resetPurchaseAttempts(clients[0]!,c.id,staff.id,'Reviewed cancelled checkout reservations',randomUUID().replaceAll('-',''));
    await clients[0]!.mobileTopUpTransaction.updateMany({where:{flupFlapCustomerId:c.id},data:{totalChargeUsd:70}});
    await expect(repo.reserveTransaction(await input(c.id))).rejects.toMatchObject({code:'RECHARGE_LIMIT_REACHED'});
    await clients[0]!.mobileTopUpTransaction.updateMany({where:{flupFlapCustomerId:c.id},data:{totalChargeUsd:5}});
    const other=await customer();
    // The first buyer's reset is never an exemption for another buyer.
    const phone=records[0]!.recipientPhone;
    for(let i=0;i<2;i++)await repo.reserveTransaction(await input(other.id,phone));
    expect((await repo.reserveTransaction(await input(c.id,phone))).created).toBe(true);
    await expect(repo.reserveTransaction(await input(c.id,phone))).rejects.toMatchObject({code:'RECHARGE_LIMIT_REACHED'});
  });
  it('shares recipient limits across concurrent new accounts before consuming quotes',async()=>{
    const phone='+509'+randomUUID().replace(/\D/g,'').slice(0,8).padEnd(8,'2');
    const buyers=await Promise.all(clients.map(()=>customer()));
    const inputs=await Promise.all(buyers.map(c=>input(c.id,phone)));
    const results=await Promise.allSettled(inputs.map((r,i)=>new PrismaMobileTopUpRepository(clients[i]!).reserveTransaction(r)));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(3);
    for(let i=0;i<results.length;i++)if(results[i]!.status==='rejected'){
      expect((results[i] as PromiseRejectedResult).reason).toMatchObject({code:'RECHARGE_LIMIT_REACHED'});
      expect((await clients[0]!.mobileTopUpQuote.findUniqueOrThrow({where:{id:inputs[i]!.quoteId}})).consumedAt).toBeNull();
    }
  });
  it('holds all but the first concurrent account using the same card',async()=>{
    const buyers=await Promise.all(clients.map(()=>customer()));
    const fingerprint=randomUUID();
    const stripe={fraudEvidence:async()=>({chargeId:'ch_fixture',fingerprint,postalCodeCheck:'pass',cvcCheck:'pass',risk:'normal',authentication:'authenticated',paymentType:'card',review:false,disputed:false,refunded:false})};
    const results=await Promise.all(buyers.map((c,i)=>createRechargeFraudGate(clients[i]!,stripe as never)({
      id:randomUUID(),userId:'flupflap:'+c.id,paymentProvider:'STRIPE',paymentProviderTransactionId:'pi_fixture',
    } as never)));
    expect(results.filter(r=>r===undefined)).toHaveLength(1);
    expect(results.filter(r=>r==='SHARED_CARD_REVIEW')).toHaveLength(5);
  });
  it('serializes distinct paid cards across two accounts sharing an installation',async()=>{
    const buyers=await Promise.all([customer(),customer()]);const device=randomUUID().replaceAll('-','').repeat(2);
    for(const c of buyers)await checkRechargeDevice(clients[0]!,c.id,device);
    const stripe=(fingerprint:string)=>({fraudEvidence:async()=>({chargeId:'ch_'+fingerprint,fingerprint,postalCodeCheck:'pass',cvcCheck:'pass',risk:'normal',authentication:'authenticated',paymentType:'card',review:false,disputed:false,refunded:false})});
    const record=(id:string)=>({id:randomUUID(),userId:'flupflap:'+id,paymentProvider:'STRIPE',paymentProviderTransactionId:'pi_fixture'});
    expect(await createRechargeFraudGate(clients[0]!,stripe(randomUUID()) as never)(record(buyers[0]!.id) as never)).toBeUndefined();
    const results=await Promise.all(buyers.map((c,i)=>createRechargeFraudGate(clients[i]!,stripe(randomUUID()) as never)(record(c.id) as never)));
    expect(results.filter(r=>r===undefined)).toHaveLength(1);
    expect(results.filter(r=>r==='PAYMENT_CARD_LIMIT')).toHaveLength(1);
  });
  it('deduplicates concurrent signed-attempt records and blocks concurrent checkout reservations',async()=>{
    const c=await customer();const reserved=await new PrismaMobileTopUpRepository(clients[0]!).reserveTransaction(await input(c.id));
    const attempt={eventType:'payment_intent.payment_failed',attemptId:'ch_'+randomUUID(),fingerprint:'hashed-fixture',occurredAt:new Date()};
    await Promise.all(clients.map((db,i)=>new PrismaMobileTopUpRepository(db).registerPaymentEvent('evt_'+randomUUID(),'hash'+i,reserved.record.id,attempt)));
    const duplicateEvent='evt_'+randomUUID();
    await Promise.all(clients.map(db=>new PrismaMobileTopUpRepository(db).registerPaymentEvent(duplicateEvent,'same-hash',reserved.record.id,attempt)));
    expect(await clients[0]!.auditLog.count({where:{flupFlapCustomerId:c.id,action:'FLUPFLAP_PAYMENT_ATTEMPT_FAILED'}})).toBe(1);
    expect(await paymentAttemptReviewReason(clients[0]!,c.id)).toBeUndefined();
    for(let i=0;i<2;i++)await new PrismaMobileTopUpRepository(clients[0]!).registerPaymentEvent('evt_'+randomUUID(),'hash',reserved.record.id,{...attempt,attemptId:'ch_'+randomUUID()});
    const inputs=await Promise.all(clients.map(()=>input(c.id)));
    const results=await Promise.allSettled(inputs.map((r,i)=>new PrismaMobileTopUpRepository(clients[i]!).reserveTransaction(r)));
    expect(results.every(r=>r.status==='rejected' && r.reason.code==='PAYMENT_ATTEMPT_LIMIT')).toBe(true);
  });
  it('keeps staged phone verification while email remains optional',async()=>{
    const c=await customer();const record=await input(c.id);const repo=new PrismaMobileTopUpRepository(clients[0]!,true);
    await expect(repo.reserveTransaction(record)).rejects.toMatchObject({code:'CONTACT_VERIFICATION_REQUIRED'});
    expect((await clients[0]!.mobileTopUpQuote.findUniqueOrThrow({where:{id:record.quoteId}})).consumedAt).toBeNull();
    await clients[0]!.flupFlapCustomer.update({where:{id:c.id},data:{phoneVerifiedAt:new Date()}});
    expect((await repo.reserveTransaction(record)).created).toBe(true);
  });
  it('limits concurrent accounts sharing one installation',async()=>{
    const buyers=await Promise.all(clients.map(()=>customer()));
    const device=randomUUID().replaceAll('-','').repeat(2);
    const results=await Promise.allSettled(buyers.map((c,i)=>checkRechargeDevice(clients[i]!,c.id,device)));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(2);
    for(const r of results)if(r.status==='rejected')expect(r.reason).toMatchObject({code:'DEVICE_ACCOUNT_LIMIT'});
  });
  it('accepts a verification code once across workers',async()=>{
    const c=await customer();
    const send=vi.fn<(channel:string,destination:string,code:string,id:string)=>Promise<void>>().mockResolvedValue(undefined);
    const services=clients.map(db=>new FlupFlapVerification(db,'postgres-test-secret-at-least-32-characters',{available:()=>true,send}));
    const {challengeId}=await services[0]!.send(c.id,'email');const code=send.mock.calls[0]![2];
    const results=await Promise.allSettled(services.map(s=>s.confirm(c.id,'email',challengeId,code)));
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
    expect(await clients[0]!.auditLog.count({where:{flupFlapCustomerId:c.id,action:'FLUPFLAP_CONTACT_VERIFIED'}})).toBe(1);
  });
});
