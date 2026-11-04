import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { pglitePrisma } from './helpers/pglite-prisma.js';
import { FlupFlapIdentityRepository } from '../src/flupflap/repository.js';
import { checkRechargeDevice } from '../src/flupflap/device-security.js';
const db=new PGlite();
const prisma=new PrismaClient({adapter:pglitePrisma(db)});
const repo=new FlupFlapIdentityRepository(prisma);
beforeAll(async()=>{
 const root=fileURLToPath(new URL('../../../migrations/',import.meta.url));
 for(const dir of readdirSync(root).sort()) if(dir.includes('_')) await db.exec(readFileSync(root+dir+'/migration.sql','utf8'));
 await db.exec('CREATE OR REPLACE FUNCTION pg_advisory_xact_lock(bigint) RETURNS integer AS $$ SELECT 1 $$ LANGUAGE SQL');
},60000);
afterAll(async()=>{await prisma.$disconnect();await db.close();});
it('commits audit and revocation together without deleting the identity',async()=>{
 const staff=await prisma.user.create({data:{email:randomUUID()+'@example.test',passwordHash:'fixture'}});
 const c=await repo.create({email:randomUUID()+'@example.test',passwordHash:'fixture'});
 const session=await repo.createSession(c.id,randomUUID(),new Date(Date.now()+60000),0);
 await repo.resetToken(c.id,randomUUID(),new Date(Date.now()+60000));
 expect(await repo.deactivate(c.id,staff.id,'Customer requested closure')).toBe(true);
 expect(await repo.customer(c.id)).toMatchObject({status:'CLOSED',email:c.email,authVersion:1,rechargeRestricted:true});
 expect(await repo.session(session.id)).toBeNull();
 expect(await prisma.flupFlapPasswordResetToken.count({where:{customerId:c.id}})).toBe(0);
 expect(await prisma.auditLog.findFirst({where:{entityId:c.id}})).toMatchObject({userId:staff.id,action:'FLUPFLAP_CUSTOMER_DEACTIVATED',metadata:{reason:'Customer requested closure'}});
 expect(await repo.deactivate(c.id,staff.id,'Repeated closure request')).toBe(false);
 expect(await prisma.auditLog.count({where:{entityId:c.id}})).toBe(1);
});
it('rolls back deactivation and credential revocation when audit insertion fails',async()=>{
 const c=await repo.create({email:randomUUID()+'@example.test',passwordHash:'fixture'});
 const session=await repo.createSession(c.id,randomUUID(),new Date(Date.now()+60000),0);
 await expect(repo.deactivate(c.id,randomUUID(),'Invalid staff audit must fail')).rejects.toThrow();
 expect(await repo.customer(c.id)).toMatchObject({status:'ACTIVE',authVersion:0,rechargeRestricted:false});
 expect(await repo.session(session.id)).not.toBeNull();
});

it('reviews exactly one closed association, retaining history and all other restrictions',async()=>{
 const staff=await prisma.user.create({data:{email:randomUUID()+'@example.test',passwordHash:'fixture'}});
 const closed=await repo.create({email:randomUUID()+'@example.test',passwordHash:'fixture'});
 const buyer=await repo.create({email:randomUUID()+'@example.test',passwordHash:'fixture'});
 const device='b'.repeat(64),deviceHash=createHash('sha256').update('flupflap-device:'+device).digest('hex');
 await prisma.flupFlapDevice.create({data:{deviceHash,customerId:closed.id}});
 expect(await repo.reviewClosedDevice(closed.id,deviceHash,staff.id,'Reviewed incorrect association')).toBe(false);
 await repo.deactivate(closed.id,staff.id,'Customer requested closure');
 await expect(checkRechargeDevice(prisma,buyer.id,device)).rejects.toMatchObject({code:'DEVICE_RESTRICTED_LINK'});
 await expect(repo.reviewClosedDevice(closed.id,deviceHash,randomUUID(),'Audit failure must rollback')).rejects.toThrow();
 expect((await repo.devices(closed.id))[0]?.associationReviewedAt).toBeNull();
 expect(await repo.reviewClosedDevice(closed.id,deviceHash,staff.id,'Verified closed account association')).toBe(true);
 await expect(checkRechargeDevice(prisma,buyer.id,device)).resolves.toBeUndefined();
 expect(await prisma.flupFlapDevice.count({where:{deviceHash,customerId:closed.id}})).toBe(1);
 expect(await prisma.auditLog.count({where:{entityId:closed.id,action:'FLUPFLAP_DEVICE_ASSOCIATION_REVIEWED'}})).toBe(1);
 await repo.update(closed.id,{status:'ACTIVE'});
 await expect(checkRechargeDevice(prisma,buyer.id,device)).rejects.toMatchObject({code:'DEVICE_RESTRICTED_LINK'});
});
