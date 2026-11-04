// Manual sandbox integration harness. A connector driver services JSON requests
// in an isolated directory; no API secrets or production database are used.
import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { pglitePrisma } from './helpers/pglite-prisma.js';
import { PrismaMobileTopUpRepository } from '../src/topup/repository.js';
import { MobileTopUpService } from '../src/topup/service.js';
import { StripeSandboxPaymentProvider } from '../src/topup/stripe-provider.js';
import { createRechargeFraudGate } from '../src/topup/fraud-gate.js';

const directory=process.env.SANDBOX_REFUND_BRIDGE_DIR;
assert(directory,'SANDBOX_REFUND_BRIDGE_DIR is required');
const fixture=JSON.parse(readFileSync(directory+'/fixture.json','utf8'));
assert.equal(fixture.livemode,false);
assert.match(fixture.checkoutSessionId,/^cs_test_/);
assert.match(fixture.paymentId,/^pi_/);
const db=new PGlite();const prisma=new PrismaClient({adapter:pglitePrisma(db)});
try {
  const root=fileURLToPath(new URL('../../../migrations/',import.meta.url));
  for(const dir of readdirSync(root).sort())if(dir.includes('_'))await db.exec(readFileSync(root+dir+'/migration.sql','utf8'));
  await db.exec('CREATE OR REPLACE FUNCTION pg_advisory_xact_lock(bigint) RETURNS integer AS $$ SELECT 1 $$ LANGUAGE SQL');
  const repo=new PrismaMobileTopUpRepository(prisma);
  const customer=await prisma.flupFlapCustomer.create({data:{email:randomUUID()+'@example.test',passwordHash:'fixture'}});
  const quote=await repo.createQuote({userId:'flupflap:'+customer.id,countryCode:'HT',recipientPhone:'+50937000000',operatorId:173,
    operatorName:'Sandbox fixture',productId:'fixture',productName:'No delivery',kind:'AIRTIME',providerAmount:5,providerCurrency:'USD',
    deliveredCurrency:'HTG',feeUsd:0,totalChargeUsd:5,testMode:true,expiresAt:new Date(Date.now()+300000).toISOString()});
  const {expiresAt,consumedAt,...snapshot}=quote;void expiresAt;void consumedAt;
  const {record}=await repo.reserveTransaction({...snapshot,id:fixture.transactionId,quoteId:quote.id,idempotencyKey:randomUUID(),requestHash:'fixture',
    paymentEnvironment:'SANDBOX',rechargeEnvironment:'SANDBOX',customIdentifier:randomUUID(),paymentProvider:'STRIPE',
    paymentSessionId:fixture.checkoutSessionId,status:'PENDING',paymentStatus:'CAPTURED',updatedAt:new Date().toISOString()});
  await repo.updateTransaction(record.id,{paymentProviderTransactionId:fixture.paymentId});
  let sequence=0,posts=0,deliveryCalls=0;
  const transport:typeof fetch=async(url,init)=>{
    const parsed=new URL(String(url));
    assert.equal(parsed.origin,'https://api.stripe.com');
    assert(['/v1/refunds','/v1/payment_intents/'+fixture.paymentId].includes(parsed.pathname));
    const method=init?.method??'GET';
    if(method==='POST'){posts++;assert.equal(parsed.pathname,'/v1/refunds');assert.equal(posts,1);}
    const n=++sequence;
    writeFileSync(directory+`/request-${n}.json`,JSON.stringify({path:parsed.pathname,query:parsed.search,method,body:init?.body,key:new Headers(init?.headers).get('Idempotency-Key')}));
    const deadline=Date.now()+180000;
    while(!existsSync(directory+`/response-${n}.json`)){
      assert(Date.now()<deadline,'Connector response deadline exceeded');
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    const response=JSON.parse(readFileSync(directory+`/response-${n}.json`,'utf8'));
    // Simulate losing the response only after the real sandbox refund succeeded.
    if(method==='POST'&&fixture.loseRefundResponse)throw new Error('Injected lost response');
    return Response.json(response);
  };
  const stripe=new StripeSandboxPaymentProvider({enabled:true,environment:'sandbox',testMode:true,secretKey:'sk_test_connector_transport',publicKey:'pk_test_fixture',webhookSecret:'whsec_fixture',successUrl:'https://flupflap.com/success',failureUrl:'https://flupflap.com/failure'},transport);
  const audit:string[]=[];
  const service=new MobileTopUpService({enabled:true,environment:'sandbox'} as never,{submitTopUp:async()=>{deliveryCalls++;throw new Error('Supplier delivery forbidden');}} as never,{} as never,repo,async(_u,action)=>{audit.push(action);},undefined,stripe,undefined,undefined,false,undefined,createRechargeFraudGate(prisma,stripe),undefined,undefined,true);
  await service.fulfillPaidRecharge(record.id);
  const initial=(await repo.getTransactionById(record.id))!;
  assert.equal(initial.paymentStatus,fixture.loseRefundResponse?'REFUND_PENDING':'REFUNDED');
  const result=await service.getTransaction(record.userId,record.id,true);
  assert.equal(result.paymentStatus,'REFUNDED');assert.equal(posts,1);assert.equal(deliveryCalls,0);
  await service.fulfillPaidRecharge(record.id);
  assert.equal(posts,1);
  console.log(JSON.stringify({paymentStatus:result.paymentStatus,initialPaymentStatus:initial.paymentStatus,posts,deliveryCalls,audit,requests:sequence}));
}finally{await prisma.$disconnect();await db.close();}
