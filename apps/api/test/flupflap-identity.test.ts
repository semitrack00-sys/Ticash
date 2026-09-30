import jwt from 'jsonwebtoken';
import {loadFlupFlapConfig} from '../src/flupflap/auth.js';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, resetStore } from '../src/app.js';
import { FlupFlapIdentityRepository } from '../src/flupflap/repository.js';
import { flupFlapOwner, ownerFromDb } from '../src/flupflap/owner.js';
import { MemoryMobileTopUpRepository } from '../src/topup/repository.js';
import type { MobileTopUpConfig, MobileTopUpOperator, MobileTopUpProvider } from '../src/topup/types.js';
import { loadSecurityConfig } from '../src/security.js';
import { loadStripeConfig } from '../src/topup/stripe-config.js';

const config: MobileTopUpConfig = {enabled:true,environment:'sandbox',clientId:'fixture',clientSecret:'fixture',authUrl:'https://auth.reloadly.com/oauth/token',airtimeBaseUrl:'https://topups-sandbox.reloadly.com',billingCurrency:'USD',quoteTtlSeconds:300,paymentMode:'mock',productionEnabled:false,approvedForLiveUse:false};
const operator: MobileTopUpOperator = {id:77,name:'Fixture operator',countryCode:'JM',status:true,bundle:false,denominationType:'FIXED',senderCurrencyCode:'USD',destinationCurrencyCode:'JMD',fixedAmounts:[5],localFixedAmounts:[800],fixedAmountsPlanNames:{},localFixedAmountsPlanNames:{}};
function setup(options: Parameters<typeof createApp>[0] = {}) {
 const identities=new FlupFlapIdentityRepository(); const recharge=new MemoryMobileTopUpRepository();
 const provider:MobileTopUpProvider={listCountries:async()=>[{code:'JM',name:'Jamaica'}],listOperators:async()=>[operator],getOperator:async()=>operator,detectOperator:async()=>operator,
 submitTopUp:vi.fn(async()=>({transactionId:'fixture-provider',status:'PROCESSING'})),getTopUpStatus:async()=>({transactionId:'fixture-provider',status:'PROCESSING'})};
 const app=createApp({flupFlapConfig:{enabled:true,accessSecret:'test-flupflap-only-secret-at-least-32-characters'},flupFlapRepository:identities,mobileTopUpConfig:config,mobileTopUpProvider:provider,mobileTopUpRepository:recharge,...options});
 return {app,identities,recharge,provider};
}
const root='/api/flupflap';
const signup=async(app:ReturnType<typeof createApp>,name='a')=>(await request(app).post(root+'/auth/register').send({email:`${name}@example.test`,password:'correct-horse-42'}).expect(201)).body;
const headers=(token:string)=>({Authorization:`Bearer ${token}`});
const quoteInput={countryCode:'JM',phone:'+18765551234',operatorId:77,productId:'reloadly:JM:77:airtime:5.00'};

describe('FlupFlap identity and shared recharge isolation',()=>{
 beforeEach(resetStore);
 it('creates a lightweight separate identity, never a TiCash User',async()=>{
  const {app}=setup();const c=await signup(app);
  expect(c.user.domain).toBe('FLUPFLAP');expect(c.user).not.toHaveProperty('passwordHash');expect(c.user).not.toHaveProperty('role');
  await request(app).post('/api/auth/login').send({email:c.user.email,password:'correct-horse-42'}).expect(401);
  await request(app).get(root+'/auth/me').set(headers(c.accessToken)).expect(200);
  await request(app).post(root+'/auth/register').send({email:'bad@example.test',password:'correct-horse-42',role:'ADMIN'}).expect(400);
 });
 it('rejects FlupFlap tokens at every TiCash-only boundary, and TiCash tokens at FlupFlap',async()=>{
  const {app}=setup();const c=await signup(app);
  for(const path of ['/api/users/me','/api/recipients','/api/transfers','/api/funding/dwolla/funding-sources','/api/funding/wallet','/api/kyc/status','/api/admin/session','/api/mobile-topups/countries']) {
   const r=await request(app).get(path).set(headers(c.accessToken));expect(r.status).toBe(401);
  }
  const legacy=await request(app).post('/api/auth/register').send({email:c.user.email,password:'correct-horse-42',firstName:'Ti',lastName:'Cash'}).expect(201);
  await request(app).get('/api/mobile-topups/countries').set(headers(legacy.body.accessToken)).expect(200);
  await request(app).get(root+'/mobile-topups/countries').set(headers(legacy.body.accessToken)).expect(401);
 });
 it('scopes recipients, quotes, transactions and idempotency to authenticated FlupFlap owners',async()=>{
  const {app,provider}=setup();const a=await signup(app,'a');const b=await signup(app,'b');
  const ah=headers(a.accessToken),bh=headers(b.accessToken);
  await request(app).post(root+'/mobile-topups/recipients').set(ah).send({nickname:'Family',phone:quoteInput.phone,countryCode:'JM'}).expect(201);
  expect((await request(app).get(root+'/mobile-topups/recipients').set(bh).expect(200)).body.recipients).toEqual([]);
  const q=(await request(app).post(root+'/mobile-topups/quotes').set(ah).send(quoteInput).expect(201)).body.quote;
  await request(app).post(root+'/mobile-topups/transactions').set(bh).set('Idempotency-Key','shared-test-key').send({quoteId:q.id}).expect(404);
  const t=(await request(app).post(root+'/mobile-topups/transactions').set(ah).set('Idempotency-Key','shared-test-key').send({quoteId:q.id}).expect(201)).body.transaction;
  await request(app).get(root+'/mobile-topups/transactions/'+t.id).set(bh).expect(404);
  expect((await request(app).get(root+'/mobile-topups/transactions').set(bh).expect(200)).body.transactions).toEqual([]);
  const replay=(await request(app).post(root+'/mobile-topups/transactions').set(ah).set('Idempotency-Key','shared-test-key').send({quoteId:q.id}).expect(201)).body.transaction;
  expect(replay.id).toBe(t.id);expect(provider.submitTopUp).toHaveBeenCalledTimes(1);
  for(const extra of [{userId:b.user.id},{feeUsd:0},{totalChargeUsd:0},{status:'DELIVERED'},{paymentStatus:'CAPTURED'}]) await request(app).post(root+'/mobile-topups/quotes').set(ah).send({...quoteInput,...extra}).expect(400);
 });
 it('rotates refresh once, revokes old access, and revokes logout immediately',async()=>{
  const {app}=setup();const a=await signup(app);
  const results=await Promise.all([1,2].map(()=>request(app).post(root+'/auth/refresh').send({refreshToken:a.refreshToken})));
  expect(results.map(r=>r.status).sort()).toEqual([200,401]);const fresh=results.find(r=>r.status===200)!.body;
  await request(app).get(root+'/auth/me').set(headers(a.accessToken)).expect(401);
  await request(app).post(root+'/auth/logout').set(headers(fresh.accessToken)).expect(204);
  await request(app).get(root+'/auth/me').set(headers(fresh.accessToken)).expect(401);
 });
 it('reset revokes sessions and invalidates a refresh racing with reset',async()=>{
  const {app,identities}=setup();const a=await signup(app);const c=(await identities.customer(a.user.id))!;
  const hash=(v:string)=>createHash('sha256').update(v).digest('hex');const token='a'.repeat(43);
  await identities.resetToken(c.id,hash(token),new Date(Date.now()+60_000));
  await request(app).post(root+'/auth/reset-password').send({token,password:'new-correct-horse-42'}).expect(200);
  await request(app).get(root+'/auth/me').set(headers(a.accessToken)).expect(401);
  await request(app).post(root+'/auth/reset-password').send({token,password:'new-correct-horse-42'}).expect(400);
  // Model a pre-reset refresh that writes its old-version session after reset.
  await identities.createSession(c.id,hash(token),new Date(Date.now()+60_000),c.authVersion);
  await request(app).post(root+'/auth/refresh').send({refreshToken:token}).expect(401);
 });
 it('guest cannot gain TiCash access, change profile, bypass expiry, or use unsafe gates',async()=>{
  const {app,identities}=setup();const a=(await request(app).post(root+'/auth/guest').send({}).expect(201)).body;
  expect(a.user.guest).toBe(true);await request(app).get(root+'/mobile-topups/countries').set(headers(a.accessToken)).expect(200);
  await request(app).patch(root+'/auth/me').set(headers(a.accessToken)).send({countryCode:'US'}).expect(403);
  await request(app).get('/api/recipients').set(headers(a.accessToken)).expect(401);
  await identities.update(a.user.id,{status:'SUSPENDED'});
  await request(app).get(root+'/mobile-topups/countries').set(headers(a.accessToken)).expect(401);
  const disabled=createApp({mobileTopUpConfig:config});await request(disabled).post(root+'/auth/guest').send({}).expect(503);
  const live=createApp({flupFlapConfig:{enabled:true,accessSecret:'fixture-secret-at-least-thirty-two-characters'},mobileTopUpConfig:{...config,productionEnabled:true}});
  await request(live).post(root+'/auth/register').send({}).expect(503);
 });
 it('restricted customers cannot quote or purchase and ambiguous database ownership fails closed',async()=>{
  const {app,identities}=setup();const a=await signup(app);await identities.update(a.user.id,{rechargeRestricted:true});
  await request(app).post(root+'/mobile-topups/quotes').set(headers(a.accessToken)).send(quoteInput).expect(403);
  expect(ownerFromDb({userId:null,flupFlapCustomerId:a.user.id})).toBe(flupFlapOwner(a.user.id));
  expect(ownerFromDb({userId:'legacy'})).toBe('legacy');
  expect(()=>ownerFromDb({userId:null})).toThrow();expect(()=>ownerFromDb({userId:'legacy',flupFlapCustomerId:a.user.id})).toThrow();
 });
 it('staff permissions protect the dedicated admin without mixing customer domains',async()=>{
  const {app}=setup();const flup=await signup(app);
  await request(app).get('/api/admin/flupflap/customers').set(headers(flup.accessToken)).expect(401);
  const legacy=(await request(app).post('/api/auth/register').send({email:'support@example.test',password:'correct-horse-42',firstName:'Test',lastName:'Support'}).expect(201)).body;
  await request(app).get('/api/admin/flupflap/dashboard').set(headers(legacy.accessToken)).expect(403);
  const admin=(await request(app).post('/api/auth/login').send({email:'admin@ticash.local',password:'AdminPass123!'}).expect(200)).body;
  const ah=headers(admin.accessToken);
  const notificationPath='/api/admin/flupflap/transactions/00000000-0000-4000-8000-000000000001/receiver-notification/retry';
  await request(app).post(notificationPath).set(headers(flup.accessToken)).send({}).expect(401);
  await request(app).post(notificationPath).set(headers(legacy.accessToken)).send({}).expect(403);
  await request(app).post(notificationPath).set(ah).send({to:'+15555555555',message:'arbitrary'}).expect(400);
  const customers=(await request(app).get('/api/admin/flupflap/customers').set(ah).expect(200)).body.customers;
  expect(customers.map((c:{id:string})=>c.id)).toEqual([flup.user.id]);
  expect(JSON.stringify(customers)).not.toContain('passwordHash');
  await request(app).patch('/api/admin/staff/'+legacy.user.id+'/role').set(ah).send({role:'SUPPORT',reason:'Test support permissions'}).expect(200);
  await request(app).get('/api/admin/flupflap/customers').set(headers(legacy.accessToken)).expect(200);
  for(const path of ['refunds','settings','providers']) await request(app).patch('/api/admin/flupflap/'+path).set(headers(legacy.accessToken)).send({}).then(r=>expect([403,404]).toContain(r.status));
  await request(app).patch('/api/admin/flupflap/customers/'+flup.user.id+'/restrictions').set(headers(legacy.accessToken)).send({rechargeRestricted:true,reason:'Unauthorized operation'}).expect(403);
  await request(app).patch('/api/admin/flupflap/customers/'+flup.user.id+'/restrictions').set(ah).send({rechargeRestricted:true,reason:'Security review requested'}).expect(204);
  await request(app).get(root+'/mobile-topups/countries').set(headers(flup.accessToken)).expect(403);
  await request(app).post('/api/admin/flupflap/refunds').set(ah).send({status:'REFUNDED'}).expect(409);
 });

 it('expired guests and stale-password login completions cannot regain access',async()=>{
  const {app,identities}=setup();
  const guest=await identities.create({guestExpiresAt:new Date(Date.now()-1000)});
  const session=await identities.createSession(guest.id,'expired-guest-refresh',new Date(Date.now()+60000),guest.authVersion);
  const access=jwt.sign({sub:guest.id,type:'access',domain:'FLUPFLAP',sid:session.id,v:guest.authVersion},'test-flupflap-only-secret-at-least-32-characters',{issuer:'flupflap-api',audience:'flupflap-customer',expiresIn:60});
  await request(app).get(root+'/mobile-topups/countries').set(headers(access)).expect(401);
  const c=await identities.create({email:'race@example.test',passwordHash:'old-hash'});
  await identities.resetToken(c.id,'reset-hash',new Date(Date.now()+60000));
  await identities.resetPassword('reset-hash','new-hash',new Date());
  expect(await identities.completeLogin(c.id,'old-hash',0)).toBeNull();
  await Promise.all(Array.from({length:6},()=>identities.recordLoginFailure(c.id)));
  expect((await identities.customer(c.id))!.failedLoginAttempts).toBe(6);
  expect(await identities.completeLogin(c.id,'new-hash',1)).toBeNull();
 });

 it('defaults disabled and rejects missing persistence or shared secrets in production configuration',()=>{
  expect(loadFlupFlapConfig({}).enabled).toBe(false);
  const secret='test-only-secret-more-than-32-characters';
  expect(()=>loadFlupFlapConfig({FLUPFLAP_ENABLED:'true',FLUPFLAP_ACCESS_SECRET:secret,JWT_ACCESS_SECRET:secret})).toThrow('separate signing secret');
  expect(()=>loadFlupFlapConfig({FLUPFLAP_ENABLED:'true',FLUPFLAP_ACCESS_SECRET:secret,NODE_ENV:'production'})).toThrow('persistent database');
 });

});

describe('FlupFlap access in fully approved production', () => {
 beforeEach(() => {
  resetStore();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('TRUST_PROXY_HOPS', '1');
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network requests are forbidden in identity tests'); }));
 });
 afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

 function production() {
  const mobileTopUpConfig: MobileTopUpConfig = {
   ...config, environment:'production', paymentMode:'stripe_live', productionEnabled:true,
   approvedForLiveUse:true, liveRechargeEnabled:true, appApprovedForLiveUse:true, liveMoneyEnabled:true,
   airtimeBaseUrl:'https://topups.reloadly.com',
  };
  const securityConfig = { ...loadSecurityConfig({}), approvedForLiveUse:true, liveMoneyEnabled:true };
  const stripeConfig = loadStripeConfig({
   STRIPE_ENABLED:'true', STRIPE_ENVIRONMENT:'production', MOBILE_TOPUP_PAYMENT_MODE:'stripe_live',
   STRIPE_LIVE_SECRET_KEY:'sk_live_fixture_only', STRIPE_LIVE_PUBLIC_KEY:'pk_live_fixture_only',
   STRIPE_LIVE_WEBHOOK_SECRET:'whsec_fixture_only', STRIPE_SUCCESS_URL:'https://flupflap.com/recharge',
   STRIPE_FAILURE_URL:'https://flupflap.com/recharge',
  });
  return { mobileTopUpConfig, securityConfig, stripeConfig };
 }

 it('allows guest, registration and login with all approvals, without a payment/provider request', async () => {
  const { app, provider } = setup(production());
  const guest = (await request(app).post(root+'/auth/guest').send({}).expect(201)).body;
  expect(guest.user).toMatchObject({domain:'FLUPFLAP', guest:true});
  await request(app).get(root+'/auth/me').set(headers(guest.accessToken)).expect(200);
  const customer = await signup(app, 'production');
  const login = await request(app).post(root+'/auth/login').send({email:customer.user.email,password:'correct-horse-42'}).expect(200);
  expect(login.body.user).toMatchObject({id:customer.user.id, domain:'FLUPFLAP', guest:false});
  await request(app).get(root+'/auth/me').set(headers(login.body.accessToken)).expect(200);
  expect(provider.submitTopUp).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
 });

 it.each([
  ['topup','paymentMode','mock'], ['topup','paymentMode',undefined],
  ['topup','productionEnabled',false], ['topup','approvedForLiveUse',false],
  ['topup','liveRechargeEnabled',false], ['security','approvedForLiveUse',false],
  ['security','liveMoneyEnabled',false], ['topup','environment','sandbox'],
 ] as const)('blocks mixed/partial production at both identity checks: %s.%s=%s', async (scope, key, value) => {
  const options = production(); const {app} = setup(options);
  // Exercise the runtime gate after coherent startup; do not bypass or weaken startup validation.
  Object.assign(scope === 'topup' ? options.mobileTopUpConfig : options.securityConfig, {[key]:value});
  for (const endpoint of ['guest','register','login']) {
   const response = await request(app).post(root+'/auth/'+endpoint).send({}).expect(503);
   expect(response.body.code).toBe('FLUPFLAP_UNAVAILABLE');
   expect(response.body).not.toHaveProperty('accessToken');
  }
  const protectedResponse = await request(app).get(root+'/mobile-topups/status').expect(503);
  expect(protectedResponse.body.code).toBe('FLUPFLAP_UNAVAILABLE');
  expect(fetch).not.toHaveBeenCalled();
 });

 it.each(['productionEnabled','approvedForLiveUse','securityApproval','liveMoneyEnabled'] as const)(
  'keeps sandbox authentication blocked when %s is enabled', async key => {
   const mobileTopUpConfig = {...config}; const securityConfig = loadSecurityConfig({});
   if (key === 'securityApproval') securityConfig.approvedForLiveUse = true;
   else if (key === 'liveMoneyEnabled') securityConfig.liveMoneyEnabled = true;
   else mobileTopUpConfig[key] = true;
   const {app} = setup({mobileTopUpConfig,securityConfig});
   expect((await request(app).post(root+'/auth/guest').send({}).expect(503)).body.code).toBe('FLUPFLAP_UNAVAILABLE');
  });

 it.each(['paymentMode','liveRechargeEnabled'] as const)('preserves existing startup rejection of incoherent %s', key => {
  const options = production();
  if (key === 'paymentMode') options.mobileTopUpConfig.paymentMode = 'mock';
  else options.mobileTopUpConfig.liveRechargeEnabled = false;
  expect(() => setup(options)).toThrow(); expect(fetch).not.toHaveBeenCalled();
 });

 it('preserves cross-domain isolation and guest profile/bank restrictions in production', async () => {
  const {app, provider} = setup(production());
  const guest = (await request(app).post(root+'/auth/guest').send({}).expect(201)).body;
  const customer = await signup(app, 'isolated');
  for (const token of [guest.accessToken, customer.accessToken]) {
   for (const path of ['/api/users/me','/api/recipients','/api/funding/wallet','/api/admin/session','/api/mobile-topups/countries']) {
    await request(app).get(path).set(headers(token)).expect(401);
   }
  }
  const legacy = (await request(app).post('/api/auth/register').send({email:'legacy@example.test',password:'correct-horse-42',firstName:'Ti',lastName:'Cash'}).expect(201)).body;
  await request(app).get(root+'/auth/me').set(headers(legacy.accessToken)).expect(401);
  await request(app).get(root+'/mobile-topups/countries').set(headers(legacy.accessToken)).expect(401);
  await request(app).patch(root+'/auth/me').set(headers(guest.accessToken)).send({countryCode:'US'}).expect(403);
  const methods = await request(app).get(root+'/mobile-topups/payment-methods').set(headers(guest.accessToken)).expect(200);
  expect(methods.body.methods.find((m:{type:string})=>m.type==='BANK_ACCOUNT')).toMatchObject({enabled:false,reason:'GUEST_SCOPE_RESTRICTED'});
  expect((await request(app).post('/api/auth/guest').send({}).expect(403)).body.code).toBe('GUEST_SANDBOX_REQUIRED');
  expect(provider.submitTopUp).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
 });

 it.each([true,false])('preserves recharge restrictions for production guest=%s', async guest => {
  const {app,identities,provider} = setup(production());
  const customer = guest ? (await request(app).post(root+'/auth/guest').send({}).expect(201)).body : await signup(app);
  await identities.update(customer.user.id,{rechargeRestricted:true});
  for (const path of ['quotes','transactions','payment-sessions']) {
   const response = await request(app).post(root+'/mobile-topups/'+path).set(headers(customer.accessToken)).send({}).expect(403);
   expect(response.body.code).toBe('RECHARGE_RESTRICTED');
  }
  expect(provider.submitTopUp).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
 });

 it('retains proxy configuration enforcement for production guests but allows permanent sign-in', async () => {
  vi.stubEnv('TRUST_PROXY_HOPS', undefined);
  const {app} = setup(production());
  expect((await request(app).post(root+'/auth/guest').send({}).expect(403)).body.code).toBe('GUEST_PROXY_CONFIGURATION_REQUIRED');
  const customer = await signup(app);
  await request(app).post(root+'/auth/login').send({email:customer.user.email,password:'correct-horse-42'}).expect(200);
  expect(fetch).not.toHaveBeenCalled();
 });

 it('keeps FlupFlap enablement and its own signing secret required', async () => {
  for (const flupFlapConfig of [{enabled:false,accessSecret:'test-flupflap-only-secret-at-least-32-characters'},{enabled:true}]) {
   const {app} = setup({...production(),flupFlapConfig});
   expect((await request(app).post(root+'/auth/guest').send({}).expect(503)).body.code).toBe('FLUPFLAP_UNAVAILABLE');
  }
 });
});
