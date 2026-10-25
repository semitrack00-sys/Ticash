import { randomBytes } from 'node:crypto';
import type { PrismaClient, FlupFlapCustomer } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { SecurityChallenges, securityError } from '../security-challenges.js';

export class FlupFlapAccountSecurity {
  constructor(private db: PrismaClient, readonly challenges: SecurityChallenges) {}
  private binding(c: FlupFlapCustomer, target='') { return `${c.authVersion}:${c.passwordHash}:${c.email}:${target}`; }
  async password(c: FlupFlapCustomer, value:string) {
    if (!c.passwordHash || !await bcrypt.compare(value,c.passwordHash)) throw securityError('REAUTHENTICATION_REQUIRED','Your current password is required.');
  }
  async loginChallenge(c: FlupFlapCustomer, trusted?:string) {
    if (!c.emailVerifiedAt || !c.email) return;
    if (trusted && /^[A-Za-z0-9_-]{43}$/.test(trusted)) {
      const row=await this.db.flupFlapTrustedDevice.findUnique({where:{tokenHash:this.challenges.digest('device:'+trusted)}});
      if(row?.customerId===c.id && row.authVersion===c.authVersion && row.expiresAt>new Date()) return;
    }
    return this.challenges.issue(c.id,'Verify unfamiliar sign-in',c.email,this.binding(c));
  }
  async confirmLogin(c: FlupFlapCustomer, id:string, code:string) {
    await this.challenges.consume(id,c.id,'Verify unfamiliar sign-in',code,this.binding(c));
    const token=randomBytes(32).toString('base64url');
    await this.db.flupFlapTrustedDevice.create({data:{tokenHash:this.challenges.digest('device:'+token),customerId:c.id,
      authVersion:c.authVersion,expiresAt:new Date(Date.now()+30*86400000)}});
    return token;
  }
  private verified(c:FlupFlapCustomer) {
    if(!c.email || !c.emailVerifiedAt)throw securityError('EMAIL_VERIFICATION_REQUIRED','Verify your current email in Account first.');
    return c.email;
  }
  async startPassword(c:FlupFlapCustomer,password:string) {
    await this.password(c,password);
    return this.challenges.issue(c.id,'Change account password',this.verified(c),this.binding(c));
  }
  async changePassword(c:FlupFlapCustomer,password:string,newPassword:string,id:string,code:string) {
    await this.password(c,password);this.verified(c);
    await this.challenges.consume(id,c.id,'Change account password',code,this.binding(c));
    await this.replace(c,{passwordHash:await bcrypt.hash(newPassword,12)},'FLUPFLAP_PASSWORD_CHANGED');
    await this.notify(c.email!,'Your FlupFlap password changed. All existing sessions and trusted devices were signed out. If you did not authorize this, use password recovery and contact support.');
  }
  async startEmail(c:FlupFlapCustomer,password:string,email:string) {
    await this.password(c,password);
    if(email===c.email)throw securityError('EMAIL_UNCHANGED','Enter a different email.',400);
    // Prove control of the existing inbox before sending proof to the new inbox.
    return this.challenges.issue(c.id,'Confirm email change',this.verified(c),this.binding(c,email));
  }
  async confirmCurrentEmail(c:FlupFlapCustomer,password:string,email:string,id:string,code:string) {
    await this.password(c,password);this.verified(c);
    await this.challenges.consume(id,c.id,'Confirm email change',code,this.binding(c,email));
    return this.challenges.issue(c.id,'Verify new email',email,this.binding(c,email));
  }
  async changeEmail(c:FlupFlapCustomer,password:string,email:string,id:string,code:string) {
    await this.password(c,password);this.verified(c);
    const destination=await this.challenges.consume(id,c.id,'Verify new email',code,this.binding(c,email));
    if(destination!==email)throw securityError('SECURITY_CODE_INVALID','The code does not match this email.',400);
    await this.replace(c,{email,emailVerifiedAt:new Date()},'FLUPFLAP_EMAIL_CHANGED');
    await this.notify(c.email!,'Your FlupFlap email address changed. All existing sessions and trusted devices were signed out. If you did not authorize this, contact contact@ticash-app.com immediately.');
    await this.notify(email,'Your new FlupFlap email address is verified. Sign in again with your account password.');
  }
  private async replace(c:FlupFlapCustomer,data:{passwordHash?:string;email?:string;emailVerifiedAt?:Date},action:string) {
    try {
      await this.db.$transaction(async tx=>{
        const changed=await tx.flupFlapCustomer.updateMany({where:{id:c.id,status:'ACTIVE',guestExpiresAt:null,
          authVersion:c.authVersion,passwordHash:c.passwordHash,email:c.email},data:{...data,authVersion:{increment:1},failedLoginAttempts:0,loginLockedUntil:null}});
        if(changed.count!==1)throw securityError('SESSION_CHANGED','Sign in again before changing account security.',409);
        await tx.flupFlapSession.deleteMany({where:{customerId:c.id}});
        await tx.flupFlapTrustedDevice.deleteMany({where:{customerId:c.id}});
        await tx.securityChallenge.deleteMany({where:{ownerId:c.id}});
        await tx.auditLog.create({data:{flupFlapCustomerId:c.id,action,entity:'FlupFlapCustomer',entityId:c.id}});
      });
    }catch(error){
      if(typeof error==='object'&&error&&'code'in error&&error.code==='P2002')throw securityError('ACCOUNT_CHANGE_UNAVAILABLE','Unable to use this email address.',409);
      throw error;
    }
  }
  private async notify(to:string,text:string) {
    try{await this.challenges.mail.send(to,text,randomBytes(24).toString('hex'));}
    catch { await this.db.auditLog.create({data:{action:'SECURITY_NOTIFICATION_DELIVERY_FAILED',entity:'Security'}}); }
  }
}
