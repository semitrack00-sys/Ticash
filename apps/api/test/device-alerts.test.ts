import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { pglitePrisma } from './helpers/pglite-prisma.js';
import { checkRechargeDevice } from '../src/flupflap/device-security.js';
import { FlupFlapFraudAlerts } from '../src/flupflap/fraud-alerts.js';
const db=new PGlite(); const prisma=new PrismaClient({adapter:pglitePrisma(db)});
beforeAll(async()=>{
 const root=fileURLToPath(new URL('../../../migrations/',import.meta.url));
 for(const dir of readdirSync(root).sort())if(dir.includes('_'))await db.exec(readFileSync(root+dir+'/migration.sql','utf8'));
 // PGlite has one connection; real locking is covered by PostgreSQL CI.
 await db.exec('CREATE OR REPLACE FUNCTION pg_advisory_xact_lock(bigint) RETURNS integer AS $$ SELECT 1 $$ LANGUAGE SQL');
},60000);
afterAll(async()=>{await prisma.$disconnect();await db.close();});
const customer=()=>prisma.flupFlapCustomer.create({data:{passwordHash:'fixture',email:randomUUID()+'@example.test'}});
it('limits account switching and never stores the raw installation identifier',async()=>{
 const device=randomBytes(32).toString('hex'); const a=await customer(),b=await customer(),c=await customer();
 await checkRechargeDevice(prisma,a.id,device);await checkRechargeDevice(prisma,b.id,device);
 await checkRechargeDevice(prisma,a.id,device);
 await expect(checkRechargeDevice(prisma,c.id,device)).rejects.toMatchObject({code:'DEVICE_ACCOUNT_LIMIT'});
 const rows=await prisma.flupFlapDevice.findMany({where:{customerId:{in:[a.id,b.id,c.id]}}});
 expect(rows).toHaveLength(2);expect(rows[0].deviceHash).not.toBe(device);
 await prisma.flupFlapCustomer.update({where:{id:a.id},data:{rechargeRestricted:true}});
 await expect(checkRechargeDevice(prisma,b.id,device)).rejects.toMatchObject({code:'DEVICE_RESTRICTED_LINK'});
});
it('ignores expired device associations',async()=>{
 const device=randomBytes(32).toString('hex'); const a=await customer(),b=await customer();
 await checkRechargeDevice(prisma,a.id,device);
 await prisma.flupFlapCustomer.update({where:{id:a.id},data:{rechargeRestricted:true}});
 await prisma.flupFlapDevice.updateMany({where:{customerId:a.id},data:{lastSeenAt:new Date(0)}});
 await checkRechargeDevice(prisma,b.id,device);
});
it('retries alerts with a stable provider key and never sends twice after success',async()=>{
 const transactionId=randomUUID();await prisma.flupFlapFraudAlert.create({data:{transactionId}});
 const transport=vi.fn().mockResolvedValueOnce(new Response('',{status:500})).mockResolvedValue(new Response('{}',{status:200}));
 const alerts=new FlupFlapFraudAlerts(prisma,{key:'fixture',from:'test@example.test',to:'owner@example.test'},transport);
 await alerts.run();expect(transport).toHaveBeenCalledTimes(1);
 await alerts.run();expect(transport).toHaveBeenCalledTimes(1);
 await prisma.flupFlapFraudAlert.update({where:{transactionId},data:{claimedAt:new Date(0)}});
 await alerts.run();await alerts.run();expect(transport).toHaveBeenCalledTimes(2);
 expect(transport.mock.calls[0][1].headers['Idempotency-Key']).toBe(transport.mock.calls[1][1].headers['Idempotency-Key']);
 const body=JSON.parse(transport.mock.calls[1][1].body);expect(body.to).toBe('owner@example.test');expect(body.text).toContain(transactionId);
 expect((await prisma.flupFlapFraudAlert.findUniqueOrThrow({where:{transactionId}})).sentAt).not.toBeNull();
});
