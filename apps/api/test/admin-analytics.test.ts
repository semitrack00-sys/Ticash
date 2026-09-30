import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, beforeEach, describe, it, expect } from 'vitest';
import request from 'supertest';
import { analyticsWindow, readAdminAnalytics, salesPerformance, type AnalyticsDomain } from '../src/admin-analytics.js';
import { createApp, resetStore } from '../src/app.js';

// Embedded PostgreSQL: executes the actual production aggregate SQL, no remote database.
const db = new PGlite();
const now = new Date('2026-09-29T12:00:00Z');
const window = analyticsWindow({ period: '7d' }, now);
const read = (domain: AnalyticsDomain, query: Record<string, string> = { period: '7d' }) =>
  readAdminAnalytics(async sql => (await db.query<{data: Record<string, unknown>}>(sql.text, sql.values)).rows, domain, analyticsWindow(query, now));

beforeAll(async () => {
  await db.exec(`
    CREATE TABLE "User" (id text, "createdAt" timestamp, "guestExpiresAt" timestamp, role text);
    CREATE TABLE "FlupFlapCustomer" (id text, "createdAt" timestamp, "guestExpiresAt" timestamp);
    CREATE TABLE "FxQuote" (id text, "receiveCountry" text, "sourceCurrency" text);
    CREATE TABLE "Transfer" (id text, "senderUserId" text, "createdAt" timestamp, status text, "amountUsd" numeric,
      "ticashFeeUsd" numeric, "quoteId" text, provider text, "testMode" boolean);
    CREATE TABLE "MobileTopUpTransaction" (id text, "userId" text, "flupFlapCustomerId" text, "createdAt" timestamp,
      status text, "paymentStatus" text, "providerAmount" numeric, "feeUsd" numeric, "countryCode" text,
      kind text, "operatorName" text, "testMode" boolean, "paymentEnvironment" text, "rechargeEnvironment" text, "providerCurrency" text);
  `);
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => {
  await db.exec(`TRUNCATE "User", "FlupFlapCustomer", "FxQuote", "Transfer", "MobileTopUpTransaction";
    INSERT INTO "User" VALUES ('u','2026-01-01',null,'CUSTOMER'),('staff','2026-01-01',null,'ADMIN');
    INSERT INTO "FlupFlapCustomer" VALUES ('f','2026-09-24',null),('g','2026-09-25','2026-09-26');
    INSERT INTO "FxQuote" VALUES ('q','HT','USD');
    INSERT INTO "Transfer" VALUES ('t','u','2026-09-25','COMPLETED',100,2,'q','MONCASH',false);
    INSERT INTO "MobileTopUpTransaction" VALUES
      ('r',null,'f','2026-09-25','DELIVERED','CAPTURED',10,1.25,'HT','AIRTIME','Carrier A',false,'PRODUCTION','PRODUCTION','USD');
  `);
});

describe('separate database analytics', () => {
  it('separates TiCash remittance and FlupFlap recharge/customer records', async () => {
    const ti = await read('TICASH'); const fl = await read('FLUPFLAP');
    expect(ti).toMatchObject({domain:'TICASH',volumeCents:'10000',feeRevenueCents:'200',clients:{total:1,new:0,active:1},products:[{name:'REMITTANCE'}]});
    expect(fl).toMatchObject({domain:'FLUPFLAP',volumeCents:'1000',feeRevenueCents:'125',clients:{total:2,new:2,guest:1,registered:1,active:1},products:[{name:'AIRTIME'}]});
    expect(fl).toMatchObject({subscriptions:{available:false},internetPlans:{available:false}});
  });
  it('excludes TiCash-owned recharge and corrupt dual-owner records', async () => {
    await db.exec(`INSERT INTO "MobileTopUpTransaction" SELECT 'other','u',null,"createdAt",status,"paymentStatus",999,1,"countryCode",kind,"operatorName","testMode","paymentEnvironment","rechargeEnvironment","providerCurrency" FROM "MobileTopUpTransaction";
      INSERT INTO "MobileTopUpTransaction" SELECT 'dual','u','f',"createdAt",status,"paymentStatus",999,1,"countryCode",kind,"operatorName","testMode","paymentEnvironment","rechargeEnvironment","providerCurrency" FROM "MobileTopUpTransaction" WHERE id='r';`);
    expect(await read('FLUPFLAP')).toMatchObject({transactions:{total:1},volumeCents:'1000'});
  });
  it('keeps test sales separate from live and excludes mixed environment/non-USD recharge', async () => {
    await db.exec(`INSERT INTO "MobileTopUpTransaction" SELECT 'test',null,'f',"createdAt",status,"paymentStatus",20,1,"countryCode",kind,"operatorName",true,'SANDBOX','SANDBOX','USD' FROM "MobileTopUpTransaction";
      INSERT INTO "MobileTopUpTransaction" SELECT 'mixed',null,'f',"createdAt",status,"paymentStatus",999,1,"countryCode",kind,"operatorName",false,'SANDBOX','PRODUCTION','USD' FROM "MobileTopUpTransaction" WHERE id='r';
      INSERT INTO "MobileTopUpTransaction" SELECT 'eur',null,'f',"createdAt",status,"paymentStatus",999,1,"countryCode",kind,"operatorName",false,'PRODUCTION','PRODUCTION','EUR' FROM "MobileTopUpTransaction" WHERE id='r';`);
    expect(await read('FLUPFLAP')).toMatchObject({volumeCents:'1000'});
    expect(await read('FLUPFLAP',{period:'7d',mode:'test'})).toMatchObject({volumeCents:'2000',transactions:{total:1}});
    await db.exec(`UPDATE "Transfer" SET "testMode"=true`);
    expect(await read('TICASH')).toMatchObject({volumeCents:'0'});
    expect(await read('TICASH',{period:'7d',mode:'test'})).toMatchObject({volumeCents:'10000'});
  });
  it('never counts failed/refunded/pending/recovery transactions as sales', async () => {
    for (const [id,status,payment] of [['p','PENDING','AUTHORIZED'],['f','FAILED','CAPTURED'],['x','REFUNDED','REFUNDED'],['recovery','DELIVERED','REFUND_PENDING']]) {
      await db.query(`INSERT INTO "MobileTopUpTransaction" SELECT $1,null,'f',"createdAt",$2,$3,10,1,"countryCode",kind,"operatorName",false,'PRODUCTION','PRODUCTION','USD' FROM "MobileTopUpTransaction" WHERE id='r'`,[id,status,payment]);
    }
    expect(await read('FLUPFLAP')).toMatchObject({transactions:{total:5,successful:1,pending:2,failed:1,reversed:1},volumeCents:'1000',successRate:20});
  });
  it('aggregates more than one transaction page, with exact decimal cents and bounded recent rows', async () => {
    await db.exec(`INSERT INTO "MobileTopUpTransaction" SELECT 'n'||n,null,'g','2026-09-26','DELIVERED','CAPTURED',12.01,1.25,'JM','DATA','Carrier B',false,'PRODUCTION','PRODUCTION','USD' FROM generate_series(1,150) n`);
    const result = await read('FLUPFLAP');
    expect(result).toMatchObject({transactions:{total:151},volumeCents:'181150',feeRevenueCents:'18875',clients:{active:2},countries:[{name:'JM',count:150},{name:'HT',count:1}],products:[{name:'DATA',count:150},{name:'AIRTIME',count:1}],operators:[{name:'Carrier B',count:150},{name:'Carrier A',count:1}]});
    expect(result.recent).toHaveLength(10);
    expect(JSON.stringify(result)).not.toMatch(/recipientPhone|idempotencyKey|requestHash|password|paymentSessionId/);
  });
  it('updates all totals, recent rows and charts for a custom period; fills zero days', async () => {
    const one = await read('FLUPFLAP',{period:'custom',start:'2026-09-25',end:'2026-09-25'});
    expect(one).toMatchObject({volumeCents:'1000',transactions:{total:1},trend:[{volumeCents:'1000',count:1}]});
    const empty = await read('FLUPFLAP',{period:'custom',start:'2026-09-26',end:'2026-09-26'});
    expect(empty).toMatchObject({volumeCents:'0',feeRevenueCents:'0',averageCents:null,successRate:null,transactions:{total:0},recent:[],countries:[],performance:'LOW',trend:[{volumeCents:'0'}]});
  });
  it('excludes end-boundary/future records and compares previous equal duration', async () => {
    await db.query(`UPDATE "MobileTopUpTransaction" SET "createdAt"=$1`,[window.start.toISOString()]);
    expect(await read('FLUPFLAP')).toMatchObject({volumeCents:'1000',previousVolumeCents:'0'});
    await db.query(`UPDATE "MobileTopUpTransaction" SET "createdAt"=$1`,[window.end.toISOString()]);
    expect(await read('FLUPFLAP')).toMatchObject({transactions:{total:0}});
    await db.query(`UPDATE "MobileTopUpTransaction" SET "createdAt"=$1`,[window.previousStart.toISOString()]);
    expect(await read('FLUPFLAP')).toMatchObject({volumeCents:'0',previousVolumeCents:'1000'});
  });
  it('does not invent historical fee attribution or destination country', async () => {
    await db.exec(`UPDATE "Transfer" SET "ticashFeeUsd"=null,"quoteId"=null`);
    expect(await read('TICASH')).toMatchObject({feeRevenueCents:'0',unattributedFeeCount:1,countries:[{name:'UNKNOWN'}]});
  });
  it('includes non-USD-origin remittances using the stored USD equivalents, without new FX conversion', async () => {
    await db.exec(`UPDATE "FxQuote" SET "sourceCurrency"='CAD'; UPDATE "Transfer" SET "amountUsd"=73.25,"ticashFeeUsd"=1.83`);
    expect(await read('TICASH')).toMatchObject({transactions:{total:1},volumeCents:'7325',feeRevenueCents:'183',countries:[{name:'HT'}]});
  });
});

describe('analytics date and performance contract', () => {
  it.each(['today','7d','30d','year'])('supports %s in UTC', period => {
    const result=analyticsWindow({period},now);
    expect(result.end).toEqual(now);
    expect(result.start.getUTCHours()).toBe(0);
    expect(result.start < result.end).toBe(true);
  });
  it.each([
    {period:'custom'}, {period:'custom',start:'2026-02-30',end:'2026-03-01'},
    {period:'custom',start:'2026-09-27',end:'2026-09-25'},
    {period:'custom',start:'2024-01-01',end:'2026-01-01'},
    {period:'custom',start:'2027-01-01',end:'2027-01-02'},
    {period:'today',start:'2026-01-01'}, {mode:'all'}, {sql:'SELECT *'},
  ])('rejects invalid/unbounded request %j', query => expect(()=>analyticsWindow(query,now)).toThrow());
  it.each([['0','100','LOW'],['1','0','NO_BASELINE'],['79','100','LOW'],['80','100','MEDIUM'],['120','100','MEDIUM'],['121','100','HIGH']])('performance %s/%s = %s', (a,b,value)=>expect(salesPerformance(a,b)).toBe(value));
});

describe('admin analytics authorization', () => {
  beforeEach(resetStore);
  it.each(['/api/admin/analytics','/api/admin/flupflap/analytics'])('requires staff report permissions: %s', async path => {
    const app=createApp();
    await request(app).get(path).expect(401);
    const customer=await request(app).post('/api/auth/register').send({email:'analytics@example.test',password:'correct-horse-42',firstName:'Test',lastName:'Analytics'}).expect(201);
    const auth={Authorization:`Bearer ${customer.body.accessToken}`};
    await request(app).get(path).set(auth).expect(403);
    const staff=await request(app).post('/api/auth/login').send({email:'admin@ticash.local',password:'AdminPass123!'}).expect(200);
    const admin={Authorization:`Bearer ${staff.body.accessToken}`};
    await request(app).patch(`/api/admin/staff/${customer.body.user.id}/role`).set(admin).send({role:'SUPPORT',reason:'Test analytics access restrictions'}).expect(200);
    await request(app).get(path).set(auth).expect(403);
    await request(app).get(path+'?period=invalid').set(admin).expect(400);
    const unavailable=await request(app).get(path).set(admin).expect(503);
    expect(unavailable.body).toEqual({code:'ANALYTICS_UNAVAILABLE'});
    expect(unavailable.headers['cache-control']).toBe('no-store');
  });
});
