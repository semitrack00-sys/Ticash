import express from 'express';
import request from 'supertest';
import { expect, it, vi } from 'vitest';
import { createFlupFlapAdmin } from '../src/flupflap/admin.js';
import { requirePermission } from '../src/admin-access.js';

const id='11111111-1111-4111-8111-111111111111';
function fixture(role:string) {
 const cancel=vi.fn(async()=>({id,userId:'flupflap:'+id,status:'FAILED',paymentStatus:'FAILED'}));
 const app=express();app.use(express.json());
 app.use(createFlupFlapAdmin({authenticate:(req,_res,next)=>{Object.assign(req,{userId:'staff-id'});next();},
  permission:p=>requirePermission(p,async()=>role),service:{cancelPendingPaymentByAdmin:cancel} as never,
  identities:{} as never,recharge:{} as never,audit:async()=>{},auditRows:async()=>[]}));
 app.use((err:unknown,_req:express.Request,res:express.Response,_next:express.NextFunction)=>{void _next;res.status(400).json({error:String(err)});});
 return {app,cancel};
}
it.each(['ADMIN','SUPER_ADMIN'])('%s can cancel with an audited reason',async role=>{
 const f=fixture(role),reason='Customer requested cancellation of this checkout';
 const r=await request(f.app).post(`/transactions/${id}/cancel`).send({reason}).expect(200);
 expect(f.cancel).toHaveBeenCalledWith(id,'staff-id',reason);
 expect(r.body.transaction.status).toBe('FAILED');
 expect(r.headers['cache-control']).toBe('no-store');
});
it.each(['SUPPORT','READ_ONLY','OPERATIONS','COMPLIANCE',''])('%s cannot cancel payments',async role=>{
 const f=fixture(role);await request(f.app).post(`/transactions/${id}/cancel`).send({reason:'Customer requested cancellation'}).expect(403);
 expect(f.cancel).not.toHaveBeenCalled();
});
it.each([{}, {reason:'short'}, {reason:'A valid cancellation reason here',force:true}])('rejects invalid cancellation input %j',async body=>{
 const f=fixture('ADMIN');await request(f.app).post(`/transactions/${id}/cancel`).send(body).expect(400);
 expect(f.cancel).not.toHaveBeenCalled();
});
