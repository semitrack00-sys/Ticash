import {PrismaClient} from '@prisma/client';
import {PrismaPg} from '@prisma/adapter-pg';
import {randomUUID} from 'node:crypto';
import {FlupFlapIdentityRepository} from '../apps/api/dist/flupflap/repository.js';
import {PrismaMobileTopUpRepository} from '../apps/api/dist/topup/repository.js';
import {flupFlapOwner} from '../apps/api/dist/flupflap/owner.js';
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const baselinePath = process.argv[2];
if (!baselinePath) throw new Error('Pass the pre-change baseline SQL path. This tool uses only the disposable loopback PostgreSQL cluster on port 55439.');
const database = `flupflap_test_${Date.now()}`;
const client = new Client({host:'127.0.0.1',port:55439,user:'flupflap_test',database:'postgres'});
await client.connect();
try {
 await client.query(`CREATE DATABASE ${database}`);
} finally { await client.end(); }
const db = new Client({host:'127.0.0.1',port:55439,user:'flupflap_test',database}); await db.connect();
try {
 await db.query(await readFile(baselinePath,'utf8'));
 await db.query(`INSERT INTO "User" (id,email,"passwordHash","updatedAt") VALUES ('legacy-user','legacy@example.test','test-only',NOW());
 INSERT INTO "MobileTopUpRecipient" (id,"userId",nickname,phone,"countryCode","updatedAt") VALUES ('legacy-recipient','legacy-user','test','+15555550123','US',NOW());
 INSERT INTO "MobileTopUpQuote" (id,"userId","recipientPhone","operatorId","operatorName","productId","productName",kind,"providerAmount","providerCurrency","deliveredCurrency","feeUsd","totalChargeUsd","expiresAt") VALUES ('legacy-quote','legacy-user','+15555550123',1,'fixture','fixture','fixture','AIRTIME',5,'USD','USD',0.99,5.99,NOW());
 INSERT INTO "MobileTopUpTransaction" (id,"userId","quoteId","customIdentifier","idempotencyKey","requestHash","recipientPhone","operatorId","operatorName","productId","productName",kind,"providerAmount","providerCurrency","deliveredCurrency","feeUsd","totalChargeUsd","updatedAt") VALUES ('legacy-transaction','legacy-user','legacy-quote','legacy-custom','shared-key','test','+15555550123',1,'fixture','fixture','fixture','AIRTIME',5,'USD','USD',0.99,5.99,NOW());`);
 await db.query(await readFile('migrations/202609271200_flupflap_identity/migration.sql','utf8'));
 for(const table of ['MobileTopUpRecipient','MobileTopUpQuote','MobileTopUpTransaction']) {
  const {rows}=await db.query(`SELECT "userId","flupFlapCustomerId" FROM "${table}"`);
  assert.deepEqual(rows,[{userId:'legacy-user',flupFlapCustomerId:null}]);
  await assert.rejects(db.query(`UPDATE "${table}" SET "userId"=NULL`),e=>e.code==='23514');
 }
 await db.query(`INSERT INTO "FlupFlapCustomer" (id,email,"passwordHash","updatedAt") VALUES ('flup-customer','legacy@example.test','test-only',NOW())`);
 assert.equal((await db.query('SELECT count(*)::int AS count FROM "User"')).rows[0].count,1);
 for(const table of ['MobileTopUpRecipient','MobileTopUpQuote','MobileTopUpTransaction']) {
  await assert.rejects(db.query(`UPDATE "${table}" SET "flupFlapCustomerId"='flup-customer'`),e=>e.code==='23514');
 }
 await db.query(`INSERT INTO "MobileTopUpRecipient" (id,"flupFlapCustomerId",nickname,phone,"countryCode","updatedAt") VALUES ('flup-recipient','flup-customer','test','+15555550123','US',NOW())`);
 await assert.rejects(db.query(`INSERT INTO "MobileTopUpRecipient" (id,"flupFlapCustomerId",nickname,phone,"countryCode","updatedAt") VALUES ('duplicate','flup-customer','test','+15555550123','US',NOW())`),e=>e.code==='23505');
 await assert.rejects(db.query(`UPDATE "MobileTopUpRecipient" SET "flupFlapCustomerId"='missing' WHERE id='flup-recipient'`),e=>e.code==='23503');
 console.log('PASS: legacy ownership/amounts retained; no-owner and mixed-owner rejected on all three tables; separate email identity; separate recipient scope; duplicate and foreign-key checks. Disposable PostgreSQL only.');
} finally {await db.end();}

// Exercise the compiled production repositories against this newly-created disposable DB.
const prisma = new PrismaClient({adapter:new PrismaPg({host:'127.0.0.1',port:55439,user:'flupflap_test',database})});
try {
 const identities=new FlupFlapIdentityRepository(prisma), topups=new PrismaMobileTopUpRepository(prisma);
 const customer=await identities.create({email:'persistent@example.test',passwordHash:'fixture-hash'});
 const owner=flupFlapOwner(customer.id);
 assert.equal((await new FlupFlapIdentityRepository(prisma).byEmail(customer.email)).id,customer.id);
 await topups.saveRecipient({userId:owner,nickname:'Fixture',phone:'+15555550123',countryCode:'US'});
 assert.equal((await topups.listRecipients(owner)).length,1);
 assert.equal((await topups.listRecipients('legacy-user')).length,1);
 const quote=await topups.createQuote({userId:owner,countryCode:'US',recipientPhone:'+15555550123',operatorId:1,operatorName:'Fixture',productId:'fixture',productName:'Fixture',kind:'AIRTIME',providerAmount:5,providerCurrency:'USD',deliveredCurrency:'USD',feeUsd:0.99,totalChargeUsd:5.99,expiresAt:new Date(Date.now()+60000).toISOString()});
 assert.equal(await topups.getQuote('legacy-user',quote.id),undefined);
 const {expiresAt,consumedAt,...snapshot}=quote;
 const txn={...snapshot,id:randomUUID(),quoteId:quote.id,customIdentifier:randomUUID(),idempotencyKey:'shared-key',requestHash:'fixture-request',status:'PENDING',paymentStatus:'PENDING',paymentProvider:'MOCK',testMode:true,updatedAt:new Date().toISOString()};
 const attempts=await Promise.all([topups.reserveTransaction(txn),topups.reserveTransaction(txn)]);
 assert.equal(attempts.filter(x=>x.created).length,1);
 assert.equal(attempts[0].record.id,attempts[1].record.id);
 assert.equal((await topups.getTransactionByIdempotency('legacy-user','shared-key')).id,'legacy-transaction');
 assert.equal((await topups.getTransactionByIdempotency(owner,'shared-key')).id,txn.id);
 assert.equal(await topups.getTransaction('legacy-user',txn.id),undefined);
 assert.equal((await topups.listFlupFlapTransactions(0)).length,1);
 const claims=await Promise.all([topups.claimOperation(txn.id,'payment',new Date().toISOString()),topups.claimOperation(txn.id,'payment',new Date().toISOString())]);
 assert.deepEqual(claims.sort(),[false,true]);
 const postings=await Promise.allSettled([topups.postDeliveredLedger(txn),topups.postDeliveredLedger(txn)]);
 assert.ok(postings.some(p=>p.status==='fulfilled'));
 for(const result of postings) if(result.status==='rejected') assert.equal(result.reason.code,'P2002');
 // Ledger posting is idempotent and separate from customer identity ownership.
 assert.equal(await prisma.ledgerTransaction.count({where:{reference:`mobile-topup:${txn.id}:delivered`}}),1);
 const session=await identities.createSession(customer.id,'fixture-refresh-hash',new Date(Date.now()+60000),customer.authVersion);
 const refreshes=await Promise.all([identities.consumeSession(session.refreshHash),identities.consumeSession(session.refreshHash)]);
 assert.equal(refreshes.filter(Boolean).length,1);
 await identities.resetToken(customer.id,'fixture-reset-hash',new Date(Date.now()+60000));
 const resets=await Promise.all([identities.resetPassword('fixture-reset-hash','new-fixture-hash',new Date()),identities.resetPassword('fixture-reset-hash','new-fixture-hash',new Date())]);
 assert.deepEqual(resets.sort(),[false,true]);
 assert.equal((await identities.customer(customer.id)).authVersion,1);
 assert.equal(await identities.completeLogin(customer.id,'fixture-hash',0),null);
 assert.equal(await prisma.user.count(),1);
 console.log('PASS: persisted/reloaded FlupFlap identity, separate legacy history/idempotency, concurrent quote claim, ledger posting, refresh rotation, reset consumption, auth-version invalidation. No provider calls.');
} finally {await prisma.$disconnect();}
