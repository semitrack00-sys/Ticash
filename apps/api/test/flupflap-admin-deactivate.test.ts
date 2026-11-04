import express from 'express';
import request from 'supertest';
import { expect, it } from 'vitest';
import { createFlupFlapAdmin } from '../src/flupflap/admin.js';
import { FlupFlapIdentityRepository } from '../src/flupflap/repository.js';
import { requirePermission } from '../src/admin-access.js';

async function fixture(role = 'ADMIN') {
 const identities=new FlupFlapIdentityRepository();
 const customer=await identities.create({email:'customer@example.com',passwordHash:'retained'});
 const session=await identities.createSession(customer.id,'refresh',new Date(Date.now()+60000),0);
 await identities.resetToken(customer.id,'reset',new Date(Date.now()+60000));
 const app=express();app.use(express.json());
 app.use(createFlupFlapAdmin({authenticate:(req,_res,next)=>{Object.assign(req,{userId:'staff'});next();},
 permission:p=>requirePermission(p,async()=>role),identities,service:{} as never,recharge:{} as never,audit:async()=>{},auditRows:async()=>[]}));
 app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{void _next;res.status(400).json({error:String(err)});});
 return {app,identities,customer,session};
}
const body={reason:'Customer requested account deactivation',confirm:'DEACTIVATE_ACCOUNT'};
it('deactivates, revokes credentials, retains identity and prevents repeat mutation',async()=>{
 const f=await fixture();
 await request(f.app).post(`/customers/${f.customer.id}/deactivate`).send(body).expect(204);
 expect(await f.identities.customer(f.customer.id)).toMatchObject({status:'CLOSED',rechargeRestricted:true,email:f.customer.email,authVersion:1,passwordHash:'retained'});
 expect(await f.identities.session(f.session.id)).toBeNull();
 expect(await f.identities.resetPassword('reset','new',new Date())).toBe(false);
 await expect(f.identities.create({email:f.customer.email!})).rejects.toMatchObject({code:'P2002'});
 await request(f.app).post(`/customers/${f.customer.id}/deactivate`).send(body).expect(204);
 expect((await f.identities.customer(f.customer.id))?.authVersion).toBe(1);
});
it.each(['SUPPORT','READ_ONLY','OPERATIONS','COMPLIANCE',''])('denies %s without altering access',async role=>{
 const f=await fixture(role);
 await request(f.app).post(`/customers/${f.customer.id}/deactivate`).send(body).expect(403);
 expect((await f.identities.customer(f.customer.id))?.status).toBe('ACTIVE');
 expect(await f.identities.session(f.session.id)).not.toBeNull();
});
it.each([{reason:'short',confirm:'DEACTIVATE_ACCOUNT'},{reason:body.reason},{...body,force:true}])('requires valid explicit confirmation %j',async invalid=>{
 const f=await fixture();await request(f.app).post(`/customers/${f.customer.id}/deactivate`).send(invalid).expect(400);
 expect((await f.identities.customer(f.customer.id))?.status).toBe('ACTIVE');
});
it('does not overwrite another lifecycle state',async()=>{
 const f=await fixture();await f.identities.update(f.customer.id,{status:'DELETION_PENDING'});
 await request(f.app).post(`/customers/${f.customer.id}/deactivate`).send(body).expect(409);
});
