import { randomUUID } from 'node:crypto';
import type { PrismaClient, FlupFlapCustomer, FlupFlapSession, FlupFlapPasswordResetToken } from '@prisma/client';

export class FlupFlapIdentityRepository {
  private customers = new Map<string, FlupFlapCustomer>();
  private sessions = new Map<string, FlupFlapSession>();
  private resets = new Map<string, FlupFlapPasswordResetToken>();
  constructor(private readonly db?: PrismaClient) {}
  async customer(id: string) { return this.db ? this.db.flupFlapCustomer.findUnique({ where: { id } }) : this.customers.get(id) ?? null; }
  async byGoogleSubject(subject: string) { return this.db ? this.db.flupFlapCustomer.findUnique({ where: { googleSubject: subject } }) : [...this.customers.values()].find(c => c.googleSubject === subject) ?? null; }
  async byEmail(email: string) { return this.db ? this.db.flupFlapCustomer.findUnique({ where: { email } }) : [...this.customers.values()].find(c => c.email === email) ?? null; }
  async create(input: { email?: string; passwordHash?: string; googleSubject?: string; firstName?: string; lastName?: string; phone?: string; countryCode?: string; guestExpiresAt?: Date }) {
    if (this.db) return this.db.flupFlapCustomer.create({ data: input });
    if (input.email && [...this.customers.values()].some(c => c.email === input.email)) throw Object.assign(new Error('Duplicate identity'), { code: 'P2002' });
    const customer: FlupFlapCustomer = { id: randomUUID(), email: input.email ?? null, passwordHash: input.passwordHash ?? null, googleSubject: input.googleSubject ?? null,
      firstName: input.firstName ?? null, lastName: input.lastName ?? null, countryCode: input.countryCode ?? null,
      guestExpiresAt: input.guestExpiresAt ?? null, emailVerifiedAt: null, phone: input.phone ?? null,
      phoneVerifiedAt: null, status: 'ACTIVE', rechargeRestricted: false, authVersion: 0, failedLoginAttempts: 0, loginLockedUntil: null,
      createdAt: new Date(), updatedAt: new Date(), lastLoginAt: null };
    this.customers.set(customer.id, customer); return customer;
  }
  async update(id: string, input: Partial<Pick<FlupFlapCustomer, 'countryCode' | 'lastLoginAt' | 'failedLoginAttempts' | 'loginLockedUntil' | 'status' | 'rechargeRestricted'>>) {
    if (this.db) return this.db.flupFlapCustomer.update({ where: { id }, data: input });
    const customer = await this.customer(id); if (!customer) throw new Error('Customer unavailable');
    const updated = { ...customer, ...input, updatedAt: new Date() }; this.customers.set(id, updated); return updated;
  }
  async completeLogin(id:string, passwordHash:string, authVersion:number) {
    const now=new Date();
    if(this.db) return this.db.$transaction(async tx=>{
      const changed=await tx.flupFlapCustomer.updateMany({where:{id,passwordHash,authVersion,status:'ACTIVE',guestExpiresAt:null,OR:[{loginLockedUntil:null},{loginLockedUntil:{lte:now}}]},data:{failedLoginAttempts:0,loginLockedUntil:null,lastLoginAt:now}});
      return changed.count===1 ? tx.flupFlapCustomer.findUnique({where:{id}}) : null;
    });
    const c=this.customers.get(id);
    if(!c || c.passwordHash!==passwordHash || c.authVersion!==authVersion || c.status!=='ACTIVE' || c.guestExpiresAt || (c.loginLockedUntil && c.loginLockedUntil>now)) return null;
    const updated={...c,failedLoginAttempts:0,loginLockedUntil:null,lastLoginAt:now};this.customers.set(id,updated);return updated;
  }
  async recordLoginFailure(id: string) {
    if (this.db) return this.db.$transaction(async tx => {
      const c = await tx.flupFlapCustomer.update({where:{id},data:{failedLoginAttempts:{increment:1}}});
      if(c.failedLoginAttempts >= 5) await tx.flupFlapCustomer.update({where:{id},data:{loginLockedUntil:new Date(Date.now()+15*60_000)}});
    });
    const c = this.customers.get(id);
    if(c) this.customers.set(id,{...c,failedLoginAttempts:c.failedLoginAttempts+1,loginLockedUntil:c.failedLoginAttempts>=4?new Date(Date.now()+15*60_000):c.loginLockedUntil});
  }
  async session(id: string) { return this.db ? this.db.flupFlapSession.findUnique({ where: { id } }) : this.sessions.get(id) ?? null; }
  async createSession(customerId: string, refreshHash: string, expiresAt: Date, authVersion: number) {
    if (this.db) return this.db.flupFlapSession.create({ data: { customerId, refreshHash, expiresAt, authVersion } });
    const session = { id: randomUUID(), customerId, refreshHash, expiresAt, authVersion, createdAt: new Date() }; this.sessions.set(session.id, session); return session;
  }
  async consumeSession(hash: string) {
    if (this.db) return this.db.$transaction(async tx => {
      const session = await tx.flupFlapSession.findUnique({ where: { refreshHash: hash } });
      if (!session) return null;
      const consumed = await tx.flupFlapSession.deleteMany({ where: { id: session.id, refreshHash: hash } });
      return consumed.count === 1 ? session : null;
    });
    const session = [...this.sessions.values()].find(s => s.refreshHash === hash);
    if (session) this.sessions.delete(session.id); return session ?? null;
  }
  async revoke(id: string) {
    if (this.db) { await this.db.flupFlapSession.deleteMany({ where: { id } }); return; }
    this.sessions.delete(id);
  }
  async resetToken(customerId: string, tokenHash: string, expiresAt: Date) {
    if (this.db) return this.db.$transaction(async tx => {
      await tx.flupFlapPasswordResetToken.deleteMany({ where: { customerId } });
      return tx.flupFlapPasswordResetToken.create({ data: { customerId, tokenHash, expiresAt } });
    });
    for (const [id, row] of this.resets) if (row.customerId === customerId) this.resets.delete(id);
    const row = { id: randomUUID(), customerId, tokenHash, expiresAt, createdAt: new Date() }; this.resets.set(row.id, row); return row;
  }
  async resetPassword(tokenHash: string, passwordHash: string, now: Date) {
    if (this.db) return this.db.$transaction(async tx => {
      const row = await tx.flupFlapPasswordResetToken.findUnique({ where: { tokenHash } });
      if (!row || row.expiresAt <= now) return false;
      const customer = await tx.flupFlapCustomer.findUnique({ where: { id: row.customerId } });
      if (!customer || customer.status !== 'ACTIVE' || customer.guestExpiresAt) return false;
      if ((await tx.flupFlapPasswordResetToken.deleteMany({ where: { id: row.id, tokenHash } })).count !== 1) return false;
      await tx.flupFlapCustomer.update({ where: { id: row.customerId }, data: { passwordHash, authVersion: { increment: 1 }, failedLoginAttempts: 0, loginLockedUntil: null } });
      await tx.flupFlapSession.deleteMany({ where: { customerId: row.customerId } }); return true;
    });
    const row = [...this.resets.values()].find(r => r.tokenHash === tokenHash);
    const customer = row ? this.customers.get(row.customerId) : undefined;
    if (!row || row.expiresAt <= now || !customer || customer.status !== 'ACTIVE' || customer.guestExpiresAt) return false;
    this.resets.delete(row.id); this.customers.set(customer.id, { ...customer, passwordHash, authVersion: customer.authVersion + 1, failedLoginAttempts: 0, loginLockedUntil: null });
    for (const [id,s] of this.sessions) if (s.customerId === customer.id) this.sessions.delete(id);
    return true;
  }
  async listCustomers() {
    return this.db ? this.db.flupFlapCustomer.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }) : [...this.customers.values()].slice(0,100);
  }
}
