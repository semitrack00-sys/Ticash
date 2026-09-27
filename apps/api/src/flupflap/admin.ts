import express, { type RequestHandler } from 'express';
import { z } from 'zod';
import type { AdminPermission, AdminRequest } from '../admin-access.js';
import type { MobileTopUpRepository, MobileTopUpTransactionRecord } from '../topup/repository.js';
import type { MobileTopUpService } from '../topup/service.js';
import { FlupFlapIdentityRepository } from './repository.js';
import { flupFlapCustomerId } from './owner.js';
import { publicFlupFlapCustomer } from './auth.js';

// This module uses TiCash staff authentication, never FlupFlap customer tokens.
export function createFlupFlapAdmin(options:{authenticate:RequestHandler; permission:(p:AdminPermission)=>RequestHandler;
 identities:FlupFlapIdentityRepository; recharge:MobileTopUpRepository; service:MobileTopUpService;
 audit:(actor:string|undefined,action:string,entity:string,id?:string,metadata?:Record<string,unknown>)=>Promise<void>;
 auditRows:()=>Promise<unknown[]>;
}) {
 const router=express.Router();router.use(options.authenticate,options.permission('recharge.view'));
 const protect=(p:AdminPermission)=>options.permission(p);
 const publicTransaction=(t:MobileTopUpTransactionRecord)=>({id:t.id,customerId:flupFlapCustomerId(t.userId),countryCode:t.countryCode,operatorName:t.operatorName,productName:t.productName,provider:t.provider,status:t.status,paymentStatus:t.paymentStatus,amountUsd:t.providerAmount,feeUsd:t.feeUsd,totalUsd:t.totalChargeUsd,createdAt:t.createdAt});
 const page=z.coerce.number().int().min(0).max(100000).default(0);
 router.get('/dashboard',async(_req,res)=>res.json({domain:'FLUPFLAP',...options.service.availability()}));
 router.get('/customers',protect('recharge.customers.view'),async(_req,res)=>res.json({customers:(await options.identities.listCustomers()).map(c=>({...publicFlupFlapCustomer(c),rechargeRestricted:c.rechargeRestricted})),limit:100}));
 router.patch('/customers/:id/restrictions',protect('recharge.operations'),async(req:AdminRequest,res)=>{
  const id=z.uuid().parse(req.params.id);const input=z.object({rechargeRestricted:z.boolean(),reason:z.string().trim().min(5).max(300)}).strict().parse(req.body);
  if(!await options.identities.customer(id)){res.status(404).json({code:'CUSTOMER_NOT_FOUND'});return;}
  await options.identities.update(id,{rechargeRestricted:input.rechargeRestricted});
  await options.audit(req.userId,'FLUPFLAP_RESTRICTION_UPDATED','FlupFlapCustomer',id,{restricted:input.rechargeRestricted,reason:input.reason});res.status(204).end();
 });
 for(const [path,permission] of [['transactions','recharge.transactions.view'],['pending-failures','recharge.transactions.view'],['refunds','recharge.refunds'],['financials','recharge.reports'],['reports','recharge.reports']] as const){
  router.get('/'+path,protect(permission),async(req,res)=>{
   const offset=page.parse(req.query.offset);const all=await options.recharge.listFlupFlapTransactions(offset);
   const rows=all.filter(t=>path==='pending-failures'?['PENDING','PROCESSING','FAILED'].includes(t.status):path==='refunds'?/REFUND|VOID|RECOVERY/.test(t.paymentStatus)||t.status==='REFUNDED':true);
   res.json({transactions:rows.map(publicTransaction),offset,limit:100,nextOffset:all.length===100?offset+100:null,scope:'PAGE',authoritativeState:'PAYMENT_AND_RECHARGE_PROVIDERS'});
  });
 }
 router.post('/transactions/:id/reconcile',protect('recharge.reconciliation'),async(req:AdminRequest,res)=>{
  const id=z.uuid().parse(req.params.id);z.object({}).strict().parse(req.body??{});
  const t=await options.recharge.getTransactionById(id);
  if(!t || !flupFlapCustomerId(t.userId)){res.status(404).json({code:'TOPUP_NOT_FOUND'});return;}
  const result=await options.service.getTransaction(t.userId,id,true);
  await options.audit(req.userId,'FLUPFLAP_RECONCILED','MobileTopUpTransaction',id);
  res.json({transaction:result});
 });
 router.get('/countries',protect('recharge.providers.view'),async(_req,res)=>res.json({countries:await options.service.listCountries()}));
 router.get('/operators',protect('recharge.providers.view'),async(req,res)=>res.json({operators:await options.service.listOperators(z.string().regex(/^[A-Z]{2}$/).parse(req.query.country))}));
 router.get('/products',protect('recharge.providers.view'),async(req,res)=>res.json(await options.service.products(z.string().regex(/^[A-Z]{2}$/).parse(req.query.country),z.coerce.number().int().positive().parse(req.query.operator))));
 router.get('/providers',protect('recharge.providers.view'),async(_req,res)=>res.json(await options.service.coverage()));
 router.get('/settings',protect('recharge.configuration.view'),(_req,res)=>res.json({...options.service.availability(),configurationChanges:'REQUIRE_REVIEWED_SERVER_CONFIGURATION'}));
 // Never invent provider controls, refunds or payment-state overrides absent in the shared engine.
 router.patch('/providers',protect('recharge.providers.manage'),(_req,res)=>res.status(409).json({code:'REVIEWED_CONFIGURATION_REQUIRED'}));
 router.patch('/settings',protect('recharge.configuration.manage'),(_req,res)=>res.status(409).json({code:'REVIEWED_CONFIGURATION_REQUIRED'}));
 router.post('/refunds',protect('recharge.refunds'),(_req,res)=>res.status(409).json({code:'PROVIDER_CONFIRMED_REFUND_WORKFLOW_REQUIRED'}));
 router.get('/audit',protect('audit.view'),async(_req,res)=>res.json({events:await options.auditRows(),limit:100}));
 return router;
}
