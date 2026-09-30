import express, { type Request, type RequestHandler } from 'express';
import { randomBytes, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { FlupFlapCustomer } from '@prisma/client';
import { FlupFlapIdentityRepository } from './repository.js';
import { flupFlapOwner, flupFlapCustomerId } from './owner.js';
import type { PasswordResetEmailService } from '../password-reset-email.js';
import { passwordResetUrl } from '../password-reset-email.js';

export type FlupFlapConfig = { enabled: boolean; accessSecret?: string; resetUrl?: string };
export function loadFlupFlapConfig(env: NodeJS.ProcessEnv = process.env): FlupFlapConfig {
  const enabled = z.enum(['true','false']).parse(env.FLUPFLAP_ENABLED ?? 'false') === 'true';
  if (enabled && (!env.FLUPFLAP_ACCESS_SECRET || env.FLUPFLAP_ACCESS_SECRET.length < 32)) throw new Error('FLUPFLAP_ACCESS_SECRET must contain at least 32 characters');
  if (enabled && env.FLUPFLAP_ACCESS_SECRET === env.JWT_ACCESS_SECRET) throw new Error('FlupFlap requires a separate signing secret');
  if (enabled && env.NODE_ENV === 'production' && !env.DATABASE_URL) throw new Error('FlupFlap requires persistent database configuration');
  return { enabled, accessSecret: env.FLUPFLAP_ACCESS_SECRET, resetUrl: env.FLUPFLAP_PASSWORD_RESET_URL_BASE };
}
export function publicFlupFlapCustomer(c: FlupFlapCustomer) {
  return { id: c.id, domain: 'FLUPFLAP', email: c.email, countryCode: c.countryCode, guest: Boolean(c.guestExpiresAt),
    status: c.status, emailVerified: Boolean(c.emailVerifiedAt), createdAt: c.createdAt.toISOString() };
}
type AuthRequest = Request & { userId?: string; flupFlapCustomer?: FlupFlapCustomer; flupFlapSessionId?: string };
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const email = z.email().max(254).transform(value => value.trim().toLowerCase());
const password = z.string().min(8).max(128).refine(value => Buffer.byteLength(value, 'utf8') <= 72);
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const webRefreshCookie = 'flupflap_refresh';
function cookies(header?: string) { return Object.fromEntries((header ?? '').split(';').map(v=>v.trim()).filter(Boolean).map(v=>{const i=v.indexOf('=');return i<0?[v,'']:[v.slice(0,i),decodeURIComponent(v.slice(i+1))];})); }
function setWebRefreshCookie(res: express.Response, value: string, expiresAt: Date) {
  res.cookie(webRefreshCookie, value, { httpOnly:true, secure:process.env.NODE_ENV==='production', sameSite:process.env.NODE_ENV==='production'?'none':'lax', path:'/api/flupflap/auth', expires:expiresAt });
}
function clearWebRefreshCookie(res: express.Response) { res.clearCookie(webRefreshCookie, { httpOnly:true, secure:process.env.NODE_ENV==='production', sameSite:process.env.NODE_ENV==='production'?'none':'lax', path:'/api/flupflap/auth' }); }

export function createFlupFlapIdentity(options: {
  config: FlupFlapConfig; repository: FlupFlapIdentityRepository;
  guestError: () => { error: string; code: string } | undefined;
  accessAllowed: () => boolean;
  emailService: PasswordResetEmailService;
  audit: (owner:string|undefined, action:string, entity:string, id?:string) => Promise<void>;
}) {
  const { config, repository: repo } = options;
  const router = express.Router();
  const available: RequestHandler = (_req,res,next) => {
    if (!config.enabled || !config.accessSecret || !options.accessAllowed()) { res.status(503).json({ code:'FLUPFLAP_UNAVAILABLE', error:'FlupFlap is not configured for safe access' }); return; }
    next();
  };
  const active = (c: FlupFlapCustomer | null) => Boolean(c && c.status === 'ACTIVE' && (!c.guestExpiresAt || c.guestExpiresAt > new Date()));
  async function issue(c: FlupFlapCustomer) {
    const expiry = c.guestExpiresAt ?? new Date(Date.now() + 30 * 86400_000);
    const refreshToken = randomBytes(32).toString('base64url');
    const s = await repo.createSession(c.id, hash(refreshToken), expiry, c.authVersion);
    const accessToken = jwt.sign({ sub:c.id, type:'access', domain:'FLUPFLAP', sid:s.id, v:c.authVersion }, config.accessSecret!, {
      algorithm:'HS256', issuer:'flupflap-api', audience:'flupflap-customer', expiresIn:Math.max(1,Math.min(900,Math.floor((expiry.getTime()-Date.now())/1000))) });
    await options.audit(flupFlapOwner(c.id),'FLUPFLAP_SESSION_CREATED','FlupFlapCustomer',c.id);
    return { accessToken, refreshToken, user:publicFlupFlapCustomer(c), guest:Boolean(c.guestExpiresAt), refreshExpiresAt:expiry };
  }
  const authenticate: RequestHandler = async (request,res,next) => {
    const req = request as AuthRequest;
    if (!config.enabled || !config.accessSecret || !options.accessAllowed()) { res.status(503).json({code:'FLUPFLAP_UNAVAILABLE'}); return; }
    try {
      const match = /^Bearer ([^\s]+)$/.exec(req.header('authorization') ?? '');
      if (!match) throw new Error('Invalid credentials');
      const claims = jwt.verify(match[1]!, config.accessSecret, { algorithms:['HS256'], issuer:'flupflap-api', audience:'flupflap-customer' });
      if (typeof claims === 'string' || claims.type !== 'access' || claims.domain !== 'FLUPFLAP' || typeof claims.sub !== 'string' || typeof claims.sid !== 'string') throw new Error('Invalid credentials');
      const session = await repo.session(claims.sid); const customer = await repo.customer(claims.sub);
      if (!session || session.customerId !== claims.sub || session.expiresAt <= new Date() || !active(customer) || session.authVersion !== customer!.authVersion || claims.v !== customer!.authVersion) throw new Error('Invalid credentials');
      if (customer!.guestExpiresAt && options.guestError()) { res.status(403).json(options.guestError()); return; }
      req.userId = flupFlapOwner(customer!.id); req.flupFlapCustomer = customer!; req.flupFlapSessionId = session.id; next();
    } catch { res.status(401).json({code:'INVALID_TOKEN',error:'Invalid or expired FlupFlap session'}); }
  };
  const requireRechargeAllowed: RequestHandler = (request,res,next) => {
    if ((request as AuthRequest).flupFlapCustomer?.rechargeRestricted) { res.status(403).json({code:'RECHARGE_RESTRICTED',error:'Recharge access is restricted'}); return; }
    next();
  };
  router.use(available);
  const limited = rateLimit({ windowMs:15*60_000, limit:20, standardHeaders:'draft-8', legacyHeaders:false, message:{code:'RATE_LIMITED',error:'Too many requests. Try again later.'} });
  const refreshLimited = rateLimit({ windowMs:15*60_000, limit:120, standardHeaders:'draft-8', legacyHeaders:false, message:{code:'RATE_LIMITED',error:'Too many session refresh requests. Try again later.'} });
  const guestLimited = rateLimit({ windowMs:15*60_000, limit:5, standardHeaders:'draft-8', legacyHeaders:false, message:{code:'RATE_LIMITED',error:'Too many guest sessions. Try again later.'} });
  router.post('/register', limited, async (req,res) => {
    const input = z.object({email,password,countryCode:z.string().regex(/^[A-Z]{2}$/).optional()}).strict().parse(req.body);
    try {
      const c = await repo.create({email:input.email,passwordHash:await bcrypt.hash(input.password,12),countryCode:input.countryCode});
      const session=await issue(c); setWebRefreshCookie(res,session.refreshToken,session.refreshExpiresAt); res.status(201).json(session);
    } catch(error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') {res.status(409).json({code:'REGISTRATION_UNAVAILABLE',error:'Unable to create this account. Try signing in or resetting your password.'});return;}
      throw error;
    }
  });
  router.post('/guest', guestLimited, async (req,res) => {
    z.object({}).strict().parse(req.body ?? {});
    const error = options.guestError(); if (error) {res.status(403).json(error);return;}
    const session=await issue(await repo.create({guestExpiresAt:new Date(Date.now()+3600_000)})); setWebRefreshCookie(res,session.refreshToken,session.refreshExpiresAt); res.status(201).json(session);
  });
  router.post('/login', limited, async (req,res) => {
    const input = z.object({email,password}).strict().parse(req.body);
    const c = await repo.byEmail(input.email);
    // Same bcrypt cost for unknown identities; no TiCash User lookup or account linking.
    const matches = await bcrypt.compare(input.password,c?.passwordHash ?? '$2b$12$KIXr3XEEzZXZ89Op/OGrxuCIZhhLy/zzKFX47fbGxs2pFO6NtDz/C');
    if (!active(c) || c!.guestExpiresAt || !matches || (c!.loginLockedUntil && c!.loginLockedUntil > new Date())) {
      if (c && !c.guestExpiresAt) {
        await repo.recordLoginFailure(c.id);
        await options.audit(flupFlapOwner(c.id),'FLUPFLAP_LOGIN_REJECTED','FlupFlapCustomer',c.id);
      }
      res.status(401).json({code:'INVALID_CREDENTIALS',error:'Unable to sign in with these credentials'});return;
    }
    const updated = await repo.completeLogin(c!.id,c!.passwordHash!,c!.authVersion);
    if(!updated){res.status(401).json({code:'INVALID_CREDENTIALS',error:'Unable to sign in with these credentials'});return;}
    const session=await issue(updated); setWebRefreshCookie(res,session.refreshToken,session.refreshExpiresAt); res.json(session);
  });
  const requireAllowedWebOrigin: RequestHandler = (req,res,next) => {
    if (!cookies(req.header('cookie'))[webRefreshCookie]) { next(); return; }
    const origin=req.header('origin');
    const allowed=new Set(['https://flupflap.com','https://www.flupflap.com',...((process.env.CORS_ALLOWED_ORIGINS ?? '')+','+(process.env.CORS_ORIGIN ?? '')).split(',').map(v=>v.trim()).filter(Boolean)]);
    const local=process.env.NODE_ENV!=='production' && /^https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?$/.test(origin ?? '');
    if (!origin || (!local && !allowed.has(origin))) { res.status(403).json({code:'ORIGIN_DENIED',error:'Request origin is not allowed'}); return; }
    next();
  };
  router.post('/refresh', refreshLimited, requireAllowedWebOrigin, async (req,res) => {
    const cookieToken=cookies(req.header('cookie'))[webRefreshCookie];
    const input = z.object({refreshToken:token.optional()}).strict().parse(req.body ?? {});
    const supplied=input.refreshToken ?? cookieToken;
    if (!supplied || !token.safeParse(supplied).success) { res.status(401).json({code:'INVALID_REFRESH_TOKEN',error:'Sign in again'}); return; }
    const session = await repo.consumeSession(hash(supplied));
    const c = session ? await repo.customer(session.customerId) : null;
    if (!session || session.expiresAt <= new Date() || !active(c) || session.authVersion !== c!.authVersion || (c!.guestExpiresAt && options.guestError())) {res.status(401).json({code:'INVALID_REFRESH_TOKEN',error:'Sign in again'});return;}
    const next=await issue(c!); setWebRefreshCookie(res,next.refreshToken,next.refreshExpiresAt); res.json(next);
  });
  router.post('/logout', authenticate, async (req,res) => {clearWebRefreshCookie(res);await repo.revoke((req as AuthRequest).flupFlapSessionId!);await options.audit((req as AuthRequest).userId,'FLUPFLAP_LOGOUT','Security');res.status(204).end();});
  router.get('/me',authenticate,(req,res)=>{res.json({user:publicFlupFlapCustomer((req as AuthRequest).flupFlapCustomer!)});});
  router.patch('/me',authenticate,async(req,res)=>{
    const c=(req as AuthRequest).flupFlapCustomer!;
    if(c.guestExpiresAt){res.status(403).json({code:'GUEST_SCOPE_RESTRICTED'});return;}
    const input=z.object({countryCode:z.string().regex(/^[A-Z]{2}$/)}).strict().parse(req.body);
    const updated=await repo.update(c.id,input);
    await options.audit(flupFlapOwner(c.id),'FLUPFLAP_PROFILE_UPDATED','FlupFlapCustomer',c.id);
    res.json({user:publicFlupFlapCustomer(updated)});
  });
  router.post('/forgot-password',limited,async(req,res)=>{
    const input=z.object({email}).strict().parse(req.body); const c=await repo.byEmail(input.email);
    if(active(c) && !c!.guestExpiresAt && options.emailService.configured && config.resetUrl) {
      const resetToken=randomBytes(32).toString('base64url');const expiresAt=new Date(Date.now()+30*60_000);
      await repo.resetToken(c!.id,hash(resetToken),expiresAt);
      try {await options.emailService.sendPasswordReset({brand:'FlupFlap',to:c!.email!,resetUrl:passwordResetUrl(resetToken,{...process.env,PASSWORD_RESET_URL_BASE:config.resetUrl}),expiresAt});}
      catch { /* Generic public response; no secret or delivery exception disclosure. */ }
    }
    res.json({message:'If an account exists, reset instructions have been sent.'});
  });
  router.post('/reset-password',limited,async(req,res)=>{
    const input=z.object({token,password}).strict().parse(req.body);
    if(!await repo.resetPassword(hash(input.token),await bcrypt.hash(input.password,12),new Date())) {res.status(400).json({code:'INVALID_RESET_TOKEN',error:'Reset link is invalid or expired'});return;}
    await options.audit(undefined,'FLUPFLAP_PASSWORD_RESET_COMPLETED','Security');
    res.json({message:'Password updated. Sign in again.'});
  });
  return {router,authenticate,requireRechargeAllowed,
    isGuest:async(owner:string)=>Boolean((await repo.customer(flupFlapCustomerId(owner)!))?.guestExpiresAt),
    billingCountryForUser:async(owner:string)=>(await repo.customer(flupFlapCustomerId(owner)!))?.countryCode ?? undefined};
}
