import type { PrismaClient, Prisma } from '@prisma/client';
import express, { type RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import type { DiditProvider } from '../kyc/types.js';
import { mapDiditStatus } from '../kyc/types.js';
import { MobileTopUpError } from '../topup/types.js';
import { flupFlapCustomerId } from './owner.js';
import { identityRequired, type IdentityGate } from './identity-policy.js';

const fail = (code: string, message: string, status = 409) => new MobileTopUpError(code, message, status);
export function safeIdentityUrl(value: string | undefined): value is string {
  if (!value) return false;
  try { const u = new URL(value); return u.origin === 'https://verify.didit.me' && !u.username && !u.password && u.pathname.includes('/session/'); }
  catch { return false; }
}

/** FlupFlap identities never reuse TiCash user IDs or accept client-reported decisions. */
export class FlupFlapIdentity implements IdentityGate {
  constructor(private db: PrismaClient, private provider: DiditProvider, private workflowId: string,
    private requireContacts: boolean) {}

  async start(customerId: string, consent: boolean) {
    if (!consent) throw fail('IDENTITY_CONSENT_REQUIRED', 'Please review and accept the identity verification notice.', 400);
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "FlupFlapCustomer" WHERE id = ${customerId} FOR UPDATE`;
      const c = await tx.flupFlapCustomer.findUnique({where:{id:customerId}});
      if (!c || c.status !== 'ACTIVE' || c.guestExpiresAt || c.rechargeRestricted) throw fail('IDENTITY_NOT_ALLOWED','Sign in to an active registered account.',403);
      if (!c.emailVerifiedAt || !c.phoneVerifiedAt) throw fail('CONTACT_VERIFICATION_REQUIRED','Verify your email and phone first.',403);
      const previous = await tx.flupFlapIdentity.findUnique({where:{customerId}});
      if (previous && ['PENDING','IN_REVIEW'].includes(previous.status) && safeIdentityUrl(previous.hostedUrl ?? undefined)) {
        return {url:previous.hostedUrl,status:previous.status};
      }
      if (previous?.status === 'APPROVED') return {status:'APPROVED'};
      if (previous && previous.createdAt.getTime() > Date.now()-86400000) throw fail('IDENTITY_RETRY_LIMIT','Contact support or try again tomorrow.',429);
      const session = await this.provider.createSession({workflowId:this.workflowId,vendorData:'flupflap:'+customerId});
      if (!safeIdentityUrl(session.hostedUrl)) throw fail('IDENTITY_PROVIDER_ERROR','Verification could not be started.',502);
      // Session creation is never sufficient evidence for approval.
      const data = {sessionId:session.sessionId,hostedUrl:session.hostedUrl,status:'PENDING',checkedAt:null,createdAt:new Date()};
      await tx.flupFlapIdentity.upsert({where:{customerId},create:{customerId,...data},update:data});
      await tx.auditLog.create({data:{flupFlapCustomerId:customerId,action:'FLUPFLAP_IDENTITY_CONSENT',entity:'FlupFlapCustomer',entityId:customerId,
        metadata:{version:'identity-2026-10-24',provider:'didit',purpose:'recharge_fraud_prevention'}}});
      return {url:session.hostedUrl,status:'PENDING'};
    },{timeout:30000});
  }

  async refresh(customerId: string) {
    const identity = await this.db.flupFlapIdentity.findUnique({where:{customerId}});
    if (!identity) return {status:'NOT_STARTED'};
    // Serialize refreshes so an older slow response cannot overwrite a later decision.
    return this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "FlupFlapCustomer" WHERE id = ${customerId} FOR UPDATE`;
      const current = await tx.flupFlapIdentity.findUnique({where:{customerId}});
      if (!current || current.sessionId !== identity.sessionId) return {status:'NOT_STARTED'};
      const decision = await this.provider.getDecision(current.sessionId);
      if (decision.sessionId !== current.sessionId || decision.vendorData !== 'flupflap:'+customerId || decision.workflowId !== this.workflowId) {
        throw fail('IDENTITY_PROVIDER_MISMATCH','Verification evidence does not match this account.',502);
      }
      let status = mapDiditStatus(decision.status);
      if (status === 'APPROVED' && !decision.identityChecksPassed) status = 'IN_REVIEW';
      await tx.flupFlapIdentity.update({where:{customerId},data:{status,checkedAt:new Date(),
        ...(['APPROVED','DECLINED','EXPIRED'].includes(status)?{hostedUrl:null}:{})}});
      if (status !== current.status) await tx.auditLog.create({data:{flupFlapCustomerId:customerId,action:'FLUPFLAP_IDENTITY_STATUS',
        entity:'FlupFlapCustomer',entityId:customerId,metadata:{status}}});
      return {status};
    },{timeout:30000});
  }

  async check(tx: Prisma.TransactionClient, customerId: string, amount: number, transactionId?: string) {
    const c = await tx.flupFlapCustomer.findUnique({where:{id:customerId}});
    if (!c || c.status !== 'ACTIVE' || c.guestExpiresAt || c.rechargeRestricted) return 'ACCOUNT_REVIEW_REQUIRED';
    if (this.requireContacts && (!c.emailVerifiedAt || !c.phoneVerifiedAt)) return 'CONTACT_VERIFICATION_REQUIRED';
    const since = new Date(Date.now()-86400000);
    const [history, flagged, identity] = await Promise.all([
      tx.mobileTopUpTransaction.findMany({where:{flupFlapCustomerId:customerId,testMode:false,createdAt:{gte:since},
        ...(transactionId?{id:{not:transactionId}}:{})},select:{totalChargeUsd:true}}),
      tx.rechargeFraudAssessment.findFirst({where:{customerId,reason:{not:null},createdAt:{gte:new Date(Date.now()-30*86400000)}}}),
      tx.flupFlapIdentity.findUnique({where:{customerId}}),
    ]);
    if (!identityRequired(amount,history.reduce((sum,r)=>sum+Number(r.totalChargeUsd),0),Boolean(flagged) || ['DECLINED','IN_REVIEW'].includes(identity?.status ?? ''))) return undefined;
    if (identity?.status !== 'APPROVED' || !identity.checkedAt || identity.checkedAt.getTime() < Date.now()-120000) return 'IDENTITY_VERIFICATION_REQUIRED';
    return undefined;
  }
}

export function createFlupFlapIdentityRouter(authenticate:RequestHandler, service?:FlupFlapIdentity) {
  const router=express.Router(); router.use(authenticate);
  router.use((_req,res,next)=>{res.set('Cache-Control','no-store');next();});
  router.use(rateLimit({windowMs:15*60000,limit:30,standardHeaders:'draft-8',legacyHeaders:false}));
  function customer(req:express.Request) {
    const id=flupFlapCustomerId((req as express.Request & {userId?:string}).userId??'');
    if (!id) throw fail('AUTH_REQUIRED','Sign in first.',401);
    return id;
  }
  router.get('/',async(req,res)=>{
    if(!service){res.json({enabled:false,status:'UNAVAILABLE'});return;}
    res.json({enabled:true,...await service.refresh(customer(req))});
  });
  router.post('/session',async(req,res)=>{
    if(!service)throw fail('IDENTITY_UNAVAILABLE','Identity verification is not available yet.',503);
    const input=z.object({consent:z.literal(true)}).strict().parse(req.body);
    res.json(await service.start(customer(req),input.consent));
  });
  return router;
}
