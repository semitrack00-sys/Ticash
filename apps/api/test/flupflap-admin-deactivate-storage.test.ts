import { PGlite } from '@electric-sql/pglite';
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { pglitePrisma } from './helpers/pglite-prisma.js';
import { FlupFlapIdentityRepository } from '../src/flupflap/repository.js';
const db=new PGlite();
const prisma=new PrismaClient({adapter:pglitePrisma(db)});
const repo=new FlupFlapIdentityRepository(prisma);
beforeAll(async()=>{
 const root=fileURLToPath(new URL('../../../migrations/',import.meta.url));
 for(const dir of readdirSync(root).sort()) if(dir.includes('_')) await db.exec(readFileSync(root+dir+'/migration.sql','utf8'));
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
