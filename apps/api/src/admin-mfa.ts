import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';
import express, { type RequestHandler } from 'express';
import type { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { Secret, TOTP } from 'otpauth';
import { z } from 'zod';
import { rateLimit } from 'express-rate-limit';
import { SecurityChallenges, securityError } from './security-challenges.js';
import { hasPermission, type AdminRequest } from './admin-access.js';

const accessHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export class AdminMfaService {
  private key:Buffer;
  constructor(private db:PrismaClient,private challenges:SecurityChallenges,encryptionSecret:string) {
    if(encryptionSecret.length<32)throw new Error('Admin MFA encryption requires a strong secret');
    this.key=Buffer.from(hkdfSync('sha256',encryptionSecret,'ticash-admin-mfa','totp-encryption-v1',32));
  }
  private encrypt(value:string,id:string) {
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);
    cipher.setAAD(Buffer.from('admin-mfa:'+id));
    const encrypted=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
    return [iv,cipher.getAuthTag(),encrypted].map(b=>b.toString('base64url')).join('.');
  }
  private decrypt(value:string,id:string) {
    const [iv,tag,data]=value.split('.').map(v=>Buffer.from(v,'base64url'));
    if(!iv||!tag||!data)throw securityError('MFA_UNAVAILABLE','Authenticator state is unavailable.',503);
    const cipher=createDecipheriv('aes-256-gcm',this.key,iv);cipher.setAuthTag(tag);
    cipher.setAAD(Buffer.from('admin-mfa:'+id));
    return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8');
  }
  private totp(secret:string,email:string) { return new TOTP({issuer:'TiCash Admin',label:email,secret,algorithm:'SHA1',digits:6,period:30}); }
  private async user(id:string,password?:string) {
    const u=await this.db.user.findUnique({where:{id}});
    if(!u||u.accountLocked||u.guestExpiresAt||!hasPermission(u.role,'admin.view'))throw securityError('ADMIN_PERMISSION_REQUIRED','Staff access is required.');
    if(password!==undefined&&!await bcrypt.compare(password,u.passwordHash))throw securityError('REAUTHENTICATION_REQUIRED','Your current password is required.');
    return u;
  }
  private binding(hash:string,access:string) {return this.challenges.digest('mfa:'+hash+':'+accessHash(access));}
  async status(id:string,access:string,proof?:string) {
    const state=await this.db.adminMfa.findUnique({where:{userId:id}});
    return {enabled:Boolean(state?.enabledAt),verified:await this.authorized(id,access,proof)};
  }
  async authorized(id:string,access:string,proof?:string) {
    if(!proof||!/^[A-Za-z0-9_-]{43}$/.test(proof))return false;
    const user=await this.user(id),grant=await this.db.adminMfaGrant.findUnique({where:{tokenHash:this.challenges.digest('grant:'+proof)}});
    const factor=await this.db.adminMfa.findUnique({where:{userId:id}});
    return Boolean(grant&&grant.userId===id&&grant.accessHash===accessHash(access)&&grant.expiresAt>new Date()&&
      factor?.enabledAt&&grant.passwordBinding===this.challenges.digest('password:'+user.passwordHash+':'+factor.secretEncrypted));
  }
  async start(id:string,password:string,access:string) {
    const user=await this.user(id,password);
    if((await this.db.adminMfa.findUnique({where:{userId:id}}))?.enabledAt)throw securityError('MFA_ALREADY_ENABLED','Use your authenticator or recovery code.');
    return this.challenges.issue(id,'Enroll admin authenticator',user.email,this.binding(user.passwordHash,access));
  }
  async setup(id:string,password:string,access:string,challengeId:string,code:string) {
    const user=await this.user(id,password);
    await this.challenges.consume(challengeId,id,'Enroll admin authenticator',code,this.binding(user.passwordHash,access));
    const secret=new Secret({size:20}).base32;
    await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
      const current=await tx.user.findUnique({where:{id}});
      if(!current||current.passwordHash!==user.passwordHash||current.accountLocked||!hasPermission(current.role,'admin.view'))throw securityError('SESSION_CHANGED','Sign in again.');
      if((await tx.adminMfa.findUnique({where:{userId:id}}))?.enabledAt)throw securityError('MFA_ALREADY_ENABLED','An authenticator is already enabled.');
      const data={pendingEncrypted:this.encrypt(secret,id),pendingUntil:new Date(Date.now()+600000),failures:0,lockedUntil:null};
      await tx.adminMfa.upsert({where:{userId:id},create:{userId:id,...data},update:data});
    });
    return {secret,uri:this.totp(secret,user.email).toString(),expiresInSeconds:600};
  }
  async verify(id:string,password:string,access:string,code:string,enrolling=false) {
    const user=await this.user(id,password),now=new Date();
    const recoveryCodes=enrolling?Array.from({length:10},()=>randomBytes(12).toString('hex')):[];
    const result=await this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${id} FOR UPDATE`;
      const current=await tx.user.findUnique({where:{id}});
      if(!current||current.passwordHash!==user.passwordHash||current.accountLocked||!hasPermission(current.role,'admin.view'))return false;
      await tx.$queryRaw`SELECT "userId" FROM "AdminMfa" WHERE "userId" = ${id} FOR UPDATE`;
      const row=await tx.adminMfa.findUnique({where:{userId:id}});
      if(!row||(row.lockedUntil&&row.lockedUntil>now))return false;
      const encrypted=enrolling&&!row.enabledAt&&row.pendingUntil&&row.pendingUntil>now?row.pendingEncrypted:!enrolling&&row.enabledAt?row.secretEncrypted:null;
      if(!encrypted)return false;
      const totp=this.totp(this.decrypt(encrypted,id),user.email);
      const delta=/^\d{6}$/.test(code)?totp.validate({token:code,window:1,timestamp:now.getTime()}):null;
      const counter=Math.floor(now.getTime()/30000)+(delta??0);
      const hashes=Array.isArray(row.recoveryHashes)?row.recoveryHashes.filter((v):v is string=>typeof v==='string'):[];
      const recoveryHash=this.challenges.digest('recovery:'+id+':'+code);
      const recovery=!enrolling&&hashes.includes(recoveryHash);
      if(!recovery&&(delta===null||counter<=row.lastCounter)){
        const failures=row.failures+1;
        await tx.adminMfa.update({where:{userId:id},data:{failures,lockedUntil:failures>=5?new Date(now.getTime()+900000):null}});
        return false;
      }
      await tx.adminMfa.update({where:{userId:id},data:{failures:0,lockedUntil:null,...(!recovery?{lastCounter:counter}:{}),
        ...(enrolling?{secretEncrypted:encrypted,pendingEncrypted:null,pendingUntil:null,enabledAt:now,
          recoveryHashes:recoveryCodes.map(c=>this.challenges.digest('recovery:'+id+':'+c))}:
          recovery?{recoveryHashes:hashes.filter(h=>h!==recoveryHash)}:{})}});
      await tx.auditLog.create({data:{userId:id,action:enrolling?'ADMIN_MFA_ENABLED':recovery?'ADMIN_MFA_RECOVERY_USED':'ADMIN_MFA_VERIFIED',entity:'Security',entityId:id}});
      return encrypted;
    });
    if(!result)throw securityError('MFA_CODE_INVALID','Authenticator or recovery code is invalid, expired, reused, or temporarily locked.');
    const proof=randomBytes(32).toString('base64url');
    await this.db.adminMfaGrant.create({data:{tokenHash:this.challenges.digest('grant:'+proof),userId:id,accessHash:accessHash(access),
      passwordBinding:this.challenges.digest('password:'+user.passwordHash+':'+result),expiresAt:new Date(now.getTime()+900000)}});
    return {proof,expiresInSeconds:900,...(enrolling?{recoveryCodes}:{})};
  }
}

export function createAdminMfaRouter(options:{authenticate:RequestHandler;resolveRole:(id:string)=>Promise<string|undefined>;
  service?:AdminMfaService;required:boolean}) {
  const router=express.Router();
  router.use(options.authenticate,async(req:AdminRequest,res,next)=>{
    res.set('Cache-Control','no-store');
    if(!hasPermission(await options.resolveRole(req.userId??''),'admin.view')){res.status(403).json({code:'ADMIN_PERMISSION_REQUIRED'});return;}
    next();
  });
  router.get('/',async(req:AdminRequest,res)=>{
    if(!options.service){res.json({enabled:false,required:options.required,available:false});return;}
    res.json({...await options.service.status(req.userId!,req.header('authorization')??'',req.header('X-Admin-MFA')),required:options.required,available:true});
  });
  router.use(rateLimit({windowMs:900000,limit:20,standardHeaders:'draft-8',legacyHeaders:false,
    keyGenerator:(req:AdminRequest)=>req.userId!,message:{code:'RATE_LIMITED',error:'Too many staff security requests.'}}));
  router.post('/:action',async(req:AdminRequest,res)=>{
    if(!options.service){res.status(503).json({code:'ADMIN_MFA_UNAVAILABLE'});return;}
    const input=z.object({password:z.string().min(8).max(128),code:z.string().max(64).optional(),challengeId:z.uuid().optional()}).strict().parse(req.body);
    const id=req.userId!,access=req.header('authorization')??'';
    if(req.params.action==='start'){res.json(await options.service.start(id,input.password,access));return;}
    if(req.params.action==='setup'&&input.challengeId&&input.code){res.json(await options.service.setup(id,input.password,access,input.challengeId,input.code));return;}
    if(z.enum(['confirm','verify']).safeParse(req.params.action).success&&input.code){res.json(await options.service.verify(id,input.password,access,input.code,req.params.action==='confirm'));return;}
    res.status(400).json({code:'SECURITY_INPUT_INVALID'});
  });
  return router;
}
