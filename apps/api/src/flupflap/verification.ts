import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import express, { type RequestHandler } from 'express';
import { z } from 'zod';
import { MobileTopUpError } from '../topup/types.js';
import { flupFlapCustomerId } from './owner.js';
import type { ReceiverSmsProvider } from '../topup/receiver-notification.js';

type Channel = 'email' | 'phone';
export interface VerificationDelivery {
  available(channel: Channel): boolean;
  send(channel: Channel, destination: string, code: string, id: string): Promise<void>;
}
const fail = (code: string, message: string, status = 409) => new MobileTopUpError(code, message, status);
export class FlupFlapVerification {
  constructor(private db: PrismaClient, private secret: string, private delivery: VerificationDelivery) {
    if (secret.length < 32) throw new Error('Verification requires a strong signing secret');
  }
  availability() { return {enabled:true,email:this.delivery.available('email'),phone:this.delivery.available('phone')}; }
  private digest(id: string, code: string) {
    return createHmac('sha256', this.secret).update('flupflap-verification:' + id + ':' + code).digest('hex');
  }
  async send(customerId: string, channel: Channel) {
    if (!this.delivery.available(channel)) throw fail('VERIFICATION_UNAVAILABLE', 'Verification delivery is unavailable.', 503);
    const id = randomUUID(); const code = randomInt(0, 1000000).toString().padStart(6, '0');
    const now = new Date();
    const destination = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "FlupFlapCustomer" WHERE id = ${customerId} FOR UPDATE`;
      const customer = await tx.flupFlapCustomer.findUnique({where:{id:customerId}});
      if (!customer || customer.status !== 'ACTIVE' || customer.guestExpiresAt) throw fail('VERIFICATION_NOT_ALLOWED','Sign in to a registered account.',403);
      const destination = customer[channel];
      if (!destination) throw fail('VERIFICATION_DESTINATION_MISSING','Add a contact method before verifying.');
      const recent = await tx.flupFlapVerificationChallenge.findMany({where:{customerId,channel,createdAt:{gte:new Date(now.getTime()-3600000)}}});
      if (recent.length >= 3 || recent.some(r=>r.createdAt.getTime()>now.getTime()-60000) || recent.reduce((sum,r)=>sum+r.attempts,0)>=10) {
        throw fail('VERIFICATION_RATE_LIMITED','Too many attempts. Try again later.',429);
      }
      await tx.flupFlapVerificationChallenge.updateMany({where:{customerId,channel,consumedAt:null},data:{consumedAt:now}});
      await tx.flupFlapVerificationChallenge.create({data:{id,customerId,channel,destination,codeHash:this.digest(id,code),expiresAt:new Date(now.getTime()+600000)}});
      return destination;
    });
    try {
      await this.delivery.send(channel,destination,code,id);
      await this.db.flupFlapVerificationChallenge.update({where:{id},data:{sentAt:new Date()}});
    } catch {
      await this.db.flupFlapVerificationChallenge.update({where:{id},data:{consumedAt:new Date()}});
      throw fail('VERIFICATION_DELIVERY_FAILED','The code could not be sent. Please try again later.',503);
    }
    return {challengeId:id,expiresInSeconds:600};
  }
  async confirm(customerId:string,channel:Channel,id:string,code:string) {
    // Return an error value inside the transaction so failed-attempt counters commit.
    const error = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "FlupFlapCustomer" WHERE id = ${customerId} FOR UPDATE`;
      const customer=await tx.flupFlapCustomer.findUnique({where:{id:customerId}});
      const challenge=await tx.flupFlapVerificationChallenge.findUnique({where:{id}});
      const now=new Date();
      if (!customer || customer.status!=='ACTIVE' || customer.guestExpiresAt || !challenge || challenge.customerId!==customerId ||
          challenge.channel!==channel || !challenge.sentAt || challenge.consumedAt || challenge.expiresAt<=now ||
          challenge.attempts>=5 || customer[channel]!==challenge.destination) return true;
      const valid=timingSafeEqual(Buffer.from(challenge.codeHash,'hex'),Buffer.from(this.digest(id,code),'hex'));
      await tx.flupFlapVerificationChallenge.update({where:{id},data:{attempts:{increment:1},...(valid?{consumedAt:now}:{})}});
      if (!valid) return true;
      await tx.flupFlapCustomer.update({where:{id:customerId},data:channel==='email'?{emailVerifiedAt:now}:{phoneVerifiedAt:now}});
      await tx.auditLog.create({data:{flupFlapCustomerId:customerId,action:'FLUPFLAP_CONTACT_VERIFIED',entity:'FlupFlapCustomer',entityId:customerId,metadata:{channel}}});
      return false;
    });
    if(error)throw fail('VERIFICATION_CODE_INVALID','This code is invalid or expired.',400);
    return {verified:true};
  }
}
export function verificationDelivery(sms?:ReceiverSmsProvider,env:NodeJS.ProcessEnv=process.env):VerificationDelivery {
  const key=env.RESEND_API_KEY?.trim(); const from=env.FLUPFLAP_VERIFICATION_EMAIL_FROM?.trim();
  return {
    available:channel=>channel==='email'?Boolean(key&&from):Boolean(sms),
    async send(channel,destination,code,id){
      const message='Your FlupFlap verification code is '+code+'. It expires in 10 minutes. Do not share this code.';
      if(channel==='phone'){
        const result=await sms!.send({to:destination,message,idempotencyKey:id});
        if(result.status==='NOT_SENT')throw new Error('Delivery failed');
      }else{
        const response=await fetch('https://api.resend.com/emails',{method:'POST',signal:AbortSignal.timeout(15000),
          headers:{Authorization:'Bearer '+key,'Content-Type':'application/json','Idempotency-Key':id},
          body:JSON.stringify({from,to:destination,subject:'Verify your FlupFlap email',text:message})});
        if(!response.ok)throw new Error('Delivery failed');
      }
    },
  };
}
export function createVerificationRouter(authenticate:RequestHandler,service?:FlupFlapVerification){
  const router=express.Router();router.use(authenticate);
  router.get('/',(_req,res)=>res.json(service?.availability() ?? {enabled:false,email:false,phone:false}));
  const channel=z.enum(['email','phone']);
  router.post('/send',async(req,res)=>{
    if(!service)throw fail('VERIFICATION_UNAVAILABLE','Verification is not available yet.',503);
    const input=z.object({channel}).strict().parse(req.body);
    const id=flupFlapCustomerId((req as express.Request & {userId?:string}).userId ?? '');
    if(!id)throw fail('AUTH_REQUIRED','Sign in first.',401);
    res.json(await service.send(id,input.channel));
  });
  router.post('/confirm',async(req,res)=>{
    if(!service)throw fail('VERIFICATION_UNAVAILABLE','Verification is not available yet.',503);
    const input=z.object({channel,challengeId:z.uuid(),code:z.string().regex(/^\d{6}$/)}).strict().parse(req.body);
    const id=flupFlapCustomerId((req as express.Request & {userId?:string}).userId ?? '');
    if(!id)throw fail('AUTH_REQUIRED','Sign in first.',401);
    res.json(await service.confirm(id,input.channel,input.challengeId,input.code));
  });
  return router;
}
