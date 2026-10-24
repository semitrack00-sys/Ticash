import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { PrismaMobileTopUpRepository } from '../src/topup/repository.js';
import { FlupFlapVerification } from '../src/flupflap/verification.js';

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
  async function input(customerId:string){
    const repo=new PrismaMobileTopUpRepository(clients[0]!);
    const quote=await repo.createQuote({userId:'flupflap:'+customerId,countryCode:'HT',recipientPhone:'+50937123456',
      operatorId:173,operatorName:'Fixture',productId:'fixture',productName:'Fixture',kind:'AIRTIME',providerAmount:5,
      providerCurrency:'USD',feeUsd:0,totalChargeUsd:5,testMode:false,expiresAt:new Date(Date.now()+300000).toISOString()});
    return {...quote,id:randomUUID(),quoteId:quote.id,idempotencyKey:randomUUID(),requestHash:'fixture',
      customIdentifier:randomUUID(),status:'PENDING' as const,paymentStatus:'PENDING' as const,updatedAt:new Date().toISOString()};
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
  it('does not consume a quote before contact verification',async()=>{
    const c=await customer();const record=await input(c.id);const repo=new PrismaMobileTopUpRepository(clients[0]!,true);
    await expect(repo.reserveTransaction(record)).rejects.toMatchObject({code:'CONTACT_VERIFICATION_REQUIRED'});
    expect((await clients[0]!.mobileTopUpQuote.findUniqueOrThrow({where:{id:record.quoteId}})).consumedAt).toBeNull();
    await clients[0]!.flupFlapCustomer.update({where:{id:c.id},data:{emailVerifiedAt:new Date(),phoneVerifiedAt:new Date()}});
    expect((await repo.reserveTransaction(record)).created).toBe(true);
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
