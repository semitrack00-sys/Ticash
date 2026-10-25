import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { MobileTopUpError } from './topup/types.js';

export const securityError = (code: string, message: string, status = 403) => new MobileTopUpError(code, message, status);
export interface SecurityMail {
  available: boolean;
  send(to: string, text: string, id: string): Promise<void>;
}
export function securityMail(env: NodeJS.ProcessEnv = process.env): SecurityMail {
  const key = env.RESEND_API_KEY?.trim();
  const from = env.FLUPFLAP_VERIFICATION_EMAIL_FROM?.trim() || env.PASSWORD_RESET_EMAIL_FROM?.trim();
  return { available: Boolean(key && from), async send(to, text, id) {
    if (!key || !from) throw securityError('SECURITY_EMAIL_UNAVAILABLE', 'Security email is unavailable.', 503);
    const response = await fetch('https://api.resend.com/emails', { method: 'POST', signal: AbortSignal.timeout(15000),
      headers: {Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'Idempotency-Key': id},
      body: JSON.stringify({from, to, subject: 'Account security — TiCash / FlupFlap', text}) });
    if (!response.ok) throw securityError('SECURITY_EMAIL_UNAVAILABLE', 'Security email is unavailable.', 503);
  } };
}

export class SecurityChallenges {
  constructor(private db: PrismaClient, private secret: string, readonly mail: SecurityMail) {
    if (secret.length < 32) throw new Error('Security challenges require a strong secret');
  }
  digest(value: string) { return createHmac('sha256', this.secret).update('security-challenge:v1:' + value).digest('hex'); }
  async issue(ownerId: string, purpose: string, destination: string, binding: string) {
    if (!this.mail.available) throw securityError('SECURITY_EMAIL_UNAVAILABLE', 'Security email is unavailable.', 503);
    const id = randomUUID(), code = randomInt(1000000).toString().padStart(6, '0'), now = new Date();
    await this.db.$transaction(async tx => {
      const lock = 'security-challenge:' + ownerId;
      await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
      const recent = await tx.securityChallenge.findMany({where:{ownerId,purpose,createdAt:{gte:new Date(now.getTime()-3600000)}}});
      if (recent.length >= 3 || recent.some(r=>r.createdAt.getTime()>now.getTime()-60000) || recent.reduce((n,r)=>n+r.attempts,0)>=10) {
        throw securityError('SECURITY_RATE_LIMITED','Too many security requests. Try again later.',429);
      }
      await tx.securityChallenge.updateMany({where:{ownerId,purpose,consumedAt:null},data:{consumedAt:now}});
      await tx.securityChallenge.deleteMany({where:{expiresAt:{lt:new Date(now.getTime()-86400000)}}});
      await tx.securityChallenge.create({data:{id,ownerId,purpose,destination,binding:this.digest(binding),
        codeHash:this.digest(id+':'+code),expiresAt:new Date(now.getTime()+600000)}});
    });
    try {
      await this.mail.send(destination, 'Your account security code is '+code+'. It expires in 10 minutes. Do not share it.\n\nRequested action: '+purpose+'. If you did not request this, do not approve it.', id);
      await this.db.securityChallenge.update({where:{id},data:{sentAt:new Date()}});
    } catch {
      await this.db.securityChallenge.update({where:{id},data:{consumedAt:new Date()}});
      throw securityError('SECURITY_EMAIL_UNAVAILABLE','Security email could not be sent.',503);
    }
    return {challengeId:id,expiresInSeconds:600};
  }
  async consume(id: string, ownerId: string, purpose: string, code: string, binding: string) {
    const result = await this.db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "SecurityChallenge" WHERE id = ${id} FOR UPDATE`;
      const row = await tx.securityChallenge.findUnique({where:{id}}), now = new Date();
      if (!row || row.ownerId!==ownerId || row.purpose!==purpose || row.binding!==this.digest(binding) ||
          !row.sentAt || row.consumedAt || row.expiresAt<=now || row.attempts>=5) return null;
      const valid = /^\d{6}$/.test(code) && timingSafeEqual(Buffer.from(row.codeHash,'hex'),Buffer.from(this.digest(id+':'+code),'hex'));
      await tx.securityChallenge.update({where:{id},data:{attempts:{increment:1},...(valid?{consumedAt:now}:{})}});
      return valid ? row.destination : null;
    });
    if (!result) throw securityError('SECURITY_CODE_INVALID','The security code is invalid or expired.',400);
    return result;
  }
}
