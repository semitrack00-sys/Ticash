import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, afterAll, beforeEach, expect, it } from 'vitest';
import request from 'supertest';
import { pglitePrisma } from './helpers/pglite-prisma.js';
import { insightRequest, readInsights } from '../src/flupflap/admin-insights.js';
import { analyticsWindow, readAdminAnalytics } from '../src/admin-analytics.js';
import { createApp, resetStore } from '../src/app.js';
import { backfillCustomerPhoneCountries } from '../src/flupflap/customer-country.js';

const db=new PGlite();const prisma=new PrismaClient({adapter:pglitePrisma(db)});
const now=new Date('2026-10-25T15:00:00Z');
const execute=async(sql:Parameters<typeof prisma.$queryRaw>[0])=>prisma.$queryRaw<{data:Record<string,unknown>}[]>(sql);
const read=(query:Record<string,unknown>={},pii=true)=>readInsights(execute,insightRequest({period:'30d',asOf:now.toISOString(),...query},now),pii);
beforeAll(async()=>{
  const root=fileURLToPath(new URL('../../../migrations/',import.meta.url));
  for(const dir of readdirSync(root).sort())if(dir.includes('_'))await db.exec(readFileSync(root+dir+'/migration.sql','utf8'));
},60000);
afterAll(async()=>{await prisma.$disconnect();await db.close();});
beforeEach(async()=>{await db.exec('TRUNCATE "MobileTopUpTransaction","MobileTopUpQuote","FlupFlapCustomer" CASCADE');});
async function buyer(countryCode:string|null='US',input:Record<string,unknown>={}) {
  return prisma.flupFlapCustomer.create({data:{email:randomUUID()+'@example.test',passwordHash:'never-return-this',
    firstName:'Marie',lastName:'Jean',countryCode,createdAt:new Date('2026-10-10T10:00:00Z'),...input}});
}
async function transaction(customerId:string,status:'DELIVERED'|'FAILED'|'PENDING'|'REFUNDED'='DELIVERED',test=false) {
  const data={flupFlapCustomerId:customerId,countryCode:'HT',recipientPhone:'+50933552535',operatorId:173,operatorName:'Natcom',
    productId:'fixture',productName:'Haiti airtime',kind:'AIRTIME' as const,providerAmount:5,providerCurrency:'USD',deliveredCurrency:'HTG',
    feeUsd:0.75,totalChargeUsd:5.75,testMode:test,createdAt:new Date('2026-10-20T10:00:00Z')};
  const quote=await prisma.mobileTopUpQuote.create({data:{...data,expiresAt:now}});
  return prisma.mobileTopUpTransaction.create({data:{...data,quoteId:quote.id,status,paymentStatus:status==='DELIVERED'?'CAPTURED':status==='FAILED'?'FAILED':status==='REFUNDED'?'REFUNDED':'SESSION_CREATED',
    paymentEnvironment:test?'SANDBOX':'PRODUCTION',rechargeEnvironment:test?'SANDBOX':'PRODUCTION',
    customIdentifier:randomUUID(),idempotencyKey:randomUUID(),requestHash:'never-return-request-hash',paymentSessionId:randomUUID(),
    paymentProvider:'STRIPE',paymentProviderTransactionId:randomUUID()}});
}
it('reconciles all profile country totals including unknowns beyond the old 100-client cap',async()=>{
  await prisma.flupFlapCustomer.createMany({data:Array.from({length:151},(_,i)=>({email:i%2?null:`client${i}@example.test`,passwordHash:i%2?null:'fixture',countryCode:i<100?'US':i<150?'ht':null,
    createdAt:new Date('2026-10-10'),guestExpiresAt:i%2?now:null}))});
  const summary=await readAdminAnalytics(execute,'FLUPFLAP',analyticsWindow({period:'30d'},now));
  expect(summary.clients).toMatchObject({total:151});
  expect(summary.clientCountries).toEqual(expect.arrayContaining([expect.objectContaining({code:'US',total:100}),expect.objectContaining({code:'HT',total:50}),expect.objectContaining({code:'UNKNOWN',total:1})]));
  const first=await read();expect(first).toMatchObject({total:151,overallTotal:151,nextOffset:25});expect(first.rows).toHaveLength(25);
  const last=await read({offset:150});expect(last.rows).toHaveLength(1);expect(last.nextOffset).toBeNull();
  const haiti=await read({country:'HT'});expect(haiti.total).toBe(50);
  expect((first.countries as {total:number}[]).reduce((n,c)=>n+c.total,0)).toBe(151);
});
it('searches partial names, case-insensitive emails and formatted phone numbers across every page',async()=>{
  await buyer('US',{firstName:'Dukens',lastName:'Bal',email:'owner@example.test',phone:'+17755287791'});
  await buyer('HT',{firstName:'Other',email:'unrelated@example.test'});
  for(const q of ['dukens bal','DUKENS','OWNER@EXAMPLE','775 528-7791'])expect((await read({q})).total).toBe(1);
  expect((await read({q:"' OR true --"})).total).toBe(0);
  expect((await read({q:'%'})).total).toBe(0);
});
it('groups unrecognized saved codes with missing countries without rewriting the profile',async()=>{
  const invalid=await buyer('UC');await buyer(null);await buyer(' ca ');
  const directory=await read();
  expect(directory.countries).toEqual(expect.arrayContaining([expect.objectContaining({code:'UNKNOWN',total:2}),expect.objectContaining({code:'CA',total:1})]));
  const summary=await readAdminAnalytics(execute,'FLUPFLAP',analyticsWindow({period:'30d'},now));
  expect(summary.clientCountries).toEqual(expect.arrayContaining([expect.objectContaining({code:'UNKNOWN',total:2})]));
  expect((await prisma.flupFlapCustomer.findUniqueOrThrow({where:{id:invalid.id}})).countryCode).toBe('UC');
});
it('backfills phone countries and reconciles registered and guest country categories without changing billing or destinations',async()=>{
  const dominican=await buyer('HT',{phone:'+18298691951'});
  const guest=await buyer('HT',{email:null,passwordHash:null,phone:'+14165551234',guestExpiresAt:now});
  await buyer('EG',{email:null,passwordHash:null,guestExpiresAt:now});
  await buyer(null,{email:null,passwordHash:null,guestExpiresAt:now});
  await transaction(dominican.id);
  expect(await backfillCustomerPhoneCountries(prisma)).toEqual({updated:2});
  expect(await backfillCustomerPhoneCountries(prisma)).toEqual({updated:0});
  const directory=await read({country:'DO'});
  expect(directory.total).toBe(1);
  expect(directory.rows).toEqual([expect.objectContaining({id:dominican.id,countryCode:'DO',countryName:'Dominican Republic',
    countrySource:'PHONE_NUMBER',profileCountryCode:'HT',phoneCountryCode:'DO'})]);
  expect((await read({country:'CA',metric:'clients.guest'})).rows).toEqual([expect.objectContaining({id:guest.id,guest:true})]);
  const summary=await readAdminAnalytics(execute,'FLUPFLAP',analyticsWindow({period:'30d'},now));
  expect(summary.clients).toMatchObject({total:4,registered:1,guest:3});
  expect(summary.clientCountries).toEqual(expect.arrayContaining([
    expect.objectContaining({code:'DO',total:1,registered:1,guests:0}),
    expect.objectContaining({code:'CA',total:1,registered:0,guests:1}),
    expect.objectContaining({code:'EG',total:1,registered:0,guests:1}),
    expect.objectContaining({code:'UNKNOWN',total:1,registered:0,guests:1}),
  ]));
  expect((summary.clientCountries as {total:number}[]).reduce((n,c)=>n+c.total,0)).toBe(4);
  expect((await prisma.flupFlapCustomer.findUniqueOrThrow({where:{id:dominican.id}})).countryCode).toBe('HT');
  const tx=await read({metric:'transactions.total'});
  expect(tx.rows).toEqual([expect.objectContaining({countryCode:'HT',customer:expect.objectContaining({countryCode:'DO'})})]);
});
it('matches status and financial card contributions, excludes mixed/test records, and retains hidden history',async()=>{
  const c=await buyer();const delivered=await transaction(c.id);await transaction(c.id,'FAILED');await transaction(c.id,'PENDING');await transaction(c.id,'REFUNDED');await transaction(c.id,'DELIVERED',true);
  await prisma.mobileTopUpTransaction.update({where:{id:delivered.id},data:{customerHiddenAt:now}});
  for(const [metric,total] of [['transactions.total',4],['transactions.successful',1],['transactions.failed',1],['transactions.pending',1],['transactions.reversed',1],['volume',1],['fees',1],['average',1],['successRate',4]] as const)expect((await read({metric})).total).toBe(total);
  const detail=await read({metric:'volume'});expect(detail.rows).toEqual([expect.objectContaining({amountCents:'500',feeCents:'75',totalCents:'575',customer:expect.objectContaining({id:c.id})})]);
  expect((await read({metric:'transactions.total',mode:'test'})).total).toBe(1);
  const active=await read({metric:'clients.active'});expect(active.total).toBe(1);
  const client=(active.rows as Record<string,unknown>[])[0]!;expect(client).toMatchObject({createdAt:expect.stringContaining('2026-10-10'),transactionCount:4,successfulCount:1,spentCents:'575'});
});
it('redacts contact details without customer-view permission and never returns credentials or payment tokens',async()=>{
  const c=await buyer('US',{email:'private@example.test',phone:'+17755287791'});await transaction(c.id);
  const result=await read({metric:'transactions.total'},false);
  expect((result.rows as Record<string,unknown>[])[0]).toMatchObject({customer:null,recipientPhone:null});
  expect((await read({metric:'transactions.total',q:'private@example.test'},false)).total).toBe(0);
  for(const data of [result,await read()])expect(JSON.stringify(data)).not.toMatch(/passwordHash|never-return|paymentSessionId|paymentProviderTransactionId|authVersion/);
});
it('uses UTC signup periods and excludes accounts after the displayed snapshot',async()=>{
  await buyer(null,{createdAt:new Date('2026-10-25T02:00:00Z')});await buyer('US',{createdAt:new Date('2026-10-25T16:00:00Z')});
  for(const metric of ['clients.total','clients.today','clients.week','clients.month','clients.year','clients.new','clients.registered'])expect((await read({metric})).total).toBe(1);
  expect((await read({metric:'clients.guest'})).total).toBe(0);
  expect(()=>insightRequest({asOf:'2099-01-01T00:00:00Z'},now)).toThrow();
  expect(()=>insightRequest({metric:'bad'},now)).toThrow();expect(()=>insightRequest({offset:-1},now)).toThrow();
});
it('protects detail and directory endpoints with staff permissions and never fabricates database records',async()=>{
  resetStore();const app=createApp();const login=await request(app).post('/api/auth/login').send({email:'admin@ticash.local',password:'AdminPass123!'}).expect(200);
  const admin={Authorization:`Bearer ${login.body.accessToken}`};
  for(const path of ['/api/admin/flupflap/analytics/details','/api/admin/flupflap/customer-directory']) {
    await request(app).get(path).expect(401);
    const response=await request(app).get(path).set(admin).expect(503);expect(response.body.code).toBe('INSIGHTS_UNAVAILABLE');expect(response.headers['cache-control']).toBe('no-store');
  }
  const user=await request(app).post('/api/auth/register').send({email:'viewer@example.test',password:'correct-horse-42',firstName:'Viewer',lastName:'Test'}).expect(201);
  const auth={Authorization:`Bearer ${user.body.accessToken}`};
  await request(app).get('/api/admin/flupflap/customer-directory').set(auth).expect(403);
  await request(app).patch(`/api/admin/staff/${user.body.user.id}/role`).set(admin).send({role:'SUPPORT',reason:'Verify drill-down permission boundaries'}).expect(200);
  await request(app).get('/api/admin/flupflap/analytics/details?metric=clients.total').set(auth).expect(403);
  await request(app).get('/api/admin/flupflap/customer-directory').set(auth).expect(503);
});
