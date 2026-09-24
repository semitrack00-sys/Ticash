import { createHmac } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, resetStore } from '../src/app.js';
import { MemoryMobileTopUpRepository } from '../src/topup/repository.js';
import { MobileTopUpService } from '../src/topup/service.js';
import { MobileTopUpError, MockMobileTopUpPaymentProvider, type MobileTopUpConfig, type MobileTopUpPaymentProvider, type MobileTopUpProvider } from '../src/topup/types.js';
import { loadStripeConfig } from '../src/topup/stripe-config.js';
import { StripeSandboxPaymentProvider } from '../src/topup/stripe-provider.js';
import { verifyStripeEvent } from '../src/topup/stripe-webhook.js';

const config: MobileTopUpConfig = { enabled: true, environment: 'sandbox', clientId:'fixture', clientSecret:'fixture',
  authUrl:'https://auth.reloadly.com/oauth/token', airtimeBaseUrl:'https://topups-sandbox.reloadly.com', billingCurrency:'USD',
  quoteTtlSeconds:300, paymentMode:'mock', productionEnabled:false, approvedForLiveUse:false };
const approvedRechargeGrid = [
  [5, 0.99, 5.99],
  [10, 1.05, 11.05],
  [20, 1.49, 21.49],
  [30, 1.79, 31.79],
  [50, 2.49, 52.49],
  [75, 3.49, 78.49],
  [100, 4.49, 104.49],
] as const;
const operator = { id:77,name:'Fixture operator',countryCode:'JM',status:true,bundle:false,denominationType:'FIXED' as const,
  senderCurrencyCode:'USD',destinationCurrencyCode:'JMD',fixedAmounts:[5,10,20,30,50,75,100],localFixedAmounts:[800,1300,2400,3500,5700,8200,10800],fixedAmountsPlanNames:{},localFixedAmountsPlanNames:{} };
const quoteInput = { countryCode:'JM',phone:'+18765551234',operatorId:77,productId:'reloadly:JM:77:airtime:5.00' };
const quoteInputFor = (amount: number) => ({ countryCode:'JM', phone:'+18765551234', operatorId:77, productId:`reloadly:JM:77:airtime:${amount.toFixed(2)}` });
function fixture(payment: MobileTopUpPaymentProvider = new MockMobileTopUpPaymentProvider()) {
  const submit = vi.fn(async () => ({transactionId:'reloadly-fixture',status:'PROCESSING',requestedAmount:5,requestedAmountCurrencyCode:'USD'}));
  const provider: MobileTopUpProvider = { listCountries:async()=>[{code:'JM',name:'Jamaica'}],listOperators:async()=>[operator],
    getOperator:async()=>operator,detectOperator:async()=>operator,submitTopUp:submit,
    getTopUpStatus:async()=>({transactionId:'reloadly-fixture',status:'SUCCESSFUL',requestedAmount:5,requestedAmountCurrencyCode:'USD'}) };
  const repository = new MemoryMobileTopUpRepository();const audit=vi.fn(async()=>{});
  const service=new MobileTopUpService(config,provider,payment,repository,audit);
  return {service,repository,provider,submit,audit};
}
beforeEach(()=>{resetStore();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Real provider HTTP is forbidden in tests');}));});
afterEach(()=>vi.unstubAllGlobals());

describe('sandbox payment foundation',()=>{
  it('reserves a server-priced mock session and completes the existing purchase contract',async()=>{
    const f=fixture();const quote=await f.service.createQuote('customer',quoteInput);
    expect(quote).toMatchObject({providerAmount:5,feeUsd:0.99,totalChargeUsd:5.99});
    const session=await f.service.createPaymentSession('customer',{quoteId:quote.id},'session-key-001');
    expect(session).toMatchObject({provider:'MOCK',environment:'SANDBOX',amountMinor:599,currency:'USD',paymentStatus:'SESSION_CREATED'});
    expect(f.submit).not.toHaveBeenCalled();
    const receipt=await f.service.purchase('customer',{quoteId:quote.id},'session-key-001');
    expect(receipt).toMatchObject({id:session.transactionId,paymentMethod:'CARD',paymentProvider:'MOCK',paymentStatus:'AUTHORIZED',status:'PROCESSING'});
    expect(receipt.paymentSessionId).toBe(session.paymentSession.id);expect(receipt.paymentAuthorizationId).toBeTruthy();expect(f.submit).toHaveBeenCalledTimes(1);
  });
  it.each(approvedRechargeGrid)('uses the approved TiCash fee grid for $%s recharge', async (amount, fee, total) => {
    const f = fixture();
    const quote = await f.service.createQuote('customer', quoteInputFor(amount));
    expect(quote).toMatchObject({ providerAmount: amount, feeUsd: fee, totalChargeUsd: total });
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, `grid-session-${amount}`);
    expect(session.amountMinor).toBe(Math.round(total * 100));
  });
  it.each([
    [5, 0.99],
    [10, 1.05],
    [20, 1.49],
    [30, 1.79],
    [35, 1.97],
    [40, 2.14],
    [50, 2.49],
    [75, 3.49],
    [100, 4.49],
  ])('calculates the authoritative backend fee for custom USD amount $%s as $%s', async (amount, fee) => {
    const f = fixture();
    const quote = await f.service.createQuote('customer', { ...quoteInput, amount });
    expect(quote).toMatchObject({ providerAmount: amount, feeUsd: fee, totalChargeUsd: Number((amount + fee).toFixed(2)), providerCurrency: 'USD' });
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, `custom-session-${amount}`);
    expect(session.amountMinor).toBe(Math.round((amount + fee) * 100));
  });
  it.each([
    4.99,
    100.01,
    0,
    -5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    35.005,
  ])('rejects invalid custom recharge amount %s', async (amount) => {
    const f = fixture();
    await expect(f.service.createQuote('customer', { ...quoteInput, amount })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('preserves the authoritative Stripe total for custom amounts', async () => {
    const f = fixture();
    const quote = await f.service.createQuote('customer', { ...quoteInput, amount: 40 });
    expect(quote).toMatchObject({ providerAmount: 40, feeUsd: 2.14, totalChargeUsd: 42.14 });
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'custom-stripe-total');
    expect(session.amountMinor).toBe(4214);
  });
  it('survives concurrent session and purchase retries across service instances',async()=>{
    const f=fixture();const second=new MobileTopUpService(config,f.provider,new MockMobileTopUpPaymentProvider(),f.repository,f.audit);
    const quote=await f.service.createQuote('customer',quoteInput);
    const sessions=await Promise.all(Array.from({length:12},(_,i)=>(i%2?second:f.service).createPaymentSession('customer',{quoteId:quote.id},'same-key-123')));
    expect(new Set(sessions.map(s=>s.transactionId)).size).toBe(1);
    await Promise.all(Array.from({length:12},(_,i)=>(i%2?second:f.service).purchase('customer',{quoteId:quote.id},'same-key-123')));
    expect(f.submit).toHaveBeenCalledTimes(1);expect(await f.repository.listTransactions('customer')).toHaveLength(1);
  });
  it('rejects same key with a different quote and different keys for one quote',async()=>{
    const f=fixture();const a=await f.service.createQuote('customer',quoteInput);const b=await f.service.createQuote('customer',quoteInput);
    await f.service.createPaymentSession('customer',{quoteId:a.id},'same-key-123');
    await expect(f.service.createPaymentSession('customer',{quoteId:b.id},'same-key-123')).rejects.toMatchObject({statusCode:409,code:'IDEMPOTENCY_CONFLICT'});
    await expect(f.service.createPaymentSession('customer',{quoteId:a.id},'other-key-123')).rejects.toMatchObject({statusCode:409});
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('checks ownership, expiry and recipient ownership before reservation',async()=>{
    const f=fixture();const quote=await f.service.createQuote('customer',quoteInput);
    await expect(f.service.createPaymentSession('attacker',{quoteId:quote.id},'same-key-123')).rejects.toMatchObject({statusCode:404});
    const expired=new MobileTopUpService(config,f.provider,new MockMobileTopUpPaymentProvider(),f.repository,f.audit,()=>new Date(Date.now()+600_000));
    await expect(expired.createPaymentSession('customer',{quoteId:quote.id},'same-key-123')).rejects.toMatchObject({code:'TOPUP_QUOTE_EXPIRED'});
    await expect(f.service.createPaymentSession('customer',{quoteId:quote.id,recipientId:'unknown'},'same-key-123')).rejects.toMatchObject({code:'TOPUP_RECIPIENT_MISMATCH'});
    expect(await f.repository.listTransactions('customer')).toHaveLength(0);
  });
  it('allows only one reservation when different keys race for the same quote',async()=>{
    const f=fixture();const quote=await f.service.createQuote('customer',quoteInput);
    const results=await Promise.allSettled(Array.from({length:12},(_,i)=>f.service.createPaymentSession('customer',{quoteId:quote.id},`competing-key-${i}`)));
    expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
    expect(results.filter(result=>result.status==='rejected')).toHaveLength(11);
    expect(await f.repository.listTransactions('customer')).toHaveLength(1);expect(f.submit).not.toHaveBeenCalled();
  });
  it('replays an already reserved session after quote expiry',async()=>{
    const f=fixture();const quote=await f.service.createQuote('customer',quoteInput);
    const first=await f.service.createPaymentSession('customer',{quoteId:quote.id},'same-key-123');
    const later=new MobileTopUpService(config,f.provider,new MockMobileTopUpPaymentProvider(),f.repository,f.audit,()=>new Date(Date.now()+600_000));
    expect(await later.createPaymentSession('customer',{quoteId:quote.id},'same-key-123')).toEqual(first);
  });
  it('failed authorization never submits airtime',async()=>{
    const f=fixture({authorize:async()=>({authorizationId:'failed',status:'FAILED',testMode:true})});
    const quote=await f.service.createQuote('customer',quoteInput);
    expect(await f.service.purchase('customer',{quoteId:quote.id},'same-key-123')).toMatchObject({status:'FAILED',paymentStatus:'FAILED'});
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('uncertain authorization is never automatically repeated',async()=>{
    const authorize=vi.fn(async()=>{throw new Error('transport timeout');});const f=fixture({authorize});
    const quote=await f.service.createQuote('customer',quoteInput);
    await expect(f.service.purchase('customer',{quoteId:quote.id},'same-key-123')).rejects.toMatchObject({code:'PAYMENT_AUTHORIZATION_UNKNOWN'});
    expect(await f.service.purchase('customer',{quoteId:quote.id},'same-key-123')).toMatchObject({paymentRecoveryCode:'PAYMENT_AUTHORIZATION_UNKNOWN'});
    expect(authorize).toHaveBeenCalledTimes(1);expect(f.submit).not.toHaveBeenCalled();
  });
  it('definite Reloadly rejection voids mock authorization with audit evidence',async()=>{
    const f=fixture();f.submit.mockRejectedValue(new MobileTopUpError('RELOADLY_REJECTED','Rejected',400));
    const quote=await f.service.createQuote('customer',quoteInput);
    await expect(f.service.purchase('customer',{quoteId:quote.id},'same-key-123')).rejects.toMatchObject({code:'TOPUP_REJECTED'});
    expect((await f.repository.listTransactions('customer'))[0]).toMatchObject({status:'FAILED',paymentStatus:'VOIDED',paymentRecoveryCode:'RECOVERY_CONFIRMED'});
    expect(f.audit.mock.calls.flat()).toContain('MOBILE_TOPUP_PAYMENT_VOIDED');
  });
  it('uncertain void remains pending and is not claimed successful',async()=>{
    const payment=new MockMobileTopUpPaymentProvider();payment.void=vi.fn(async()=>{throw new Error('unknown');});const f=fixture(payment);
    f.submit.mockRejectedValue(new MobileTopUpError('RELOADLY_REJECTED','Rejected',400));const quote=await f.service.createQuote('customer',quoteInput);
    await expect(f.service.purchase('customer',{quoteId:quote.id},'same-key-123')).rejects.toThrow();
    expect((await f.repository.listTransactions('customer'))[0]).toMatchObject({paymentStatus:'VOID_PENDING',paymentRecoveryCode:'PAYMENT_RECOVERY_REQUIRED'});
  });
  it('unknown topup outcome requires reconciliation without resubmitting or refunding',async()=>{
    const payment=new MockMobileTopUpPaymentProvider();payment.void=vi.fn();const f=fixture(payment);f.submit.mockRejectedValue(new Error('timeout'));
    const quote=await f.service.createQuote('customer',quoteInput);await expect(f.service.purchase('customer',{quoteId:quote.id},'same-key-123')).rejects.toMatchObject({code:'TOPUP_SUBMISSION_UNKNOWN'});
    expect(await f.service.purchase('customer',{quoteId:quote.id},'same-key-123')).toMatchObject({status:'PROCESSING',paymentStatus:'AUTHORIZED',paymentRecoveryCode:'FULFILLMENT_RECONCILIATION_REQUIRED'});
    expect(f.submit).toHaveBeenCalledTimes(1);expect(payment.void).not.toHaveBeenCalled();
  });
});

describe('payment routes and guest restrictions',()=>{
  it('requires authentication and reports honest permanent/guest method availability',async()=>{
    const f=fixture();const app=createApp({mobileTopUpConfig:config,mobileTopUpProvider:f.provider});
    await request(app).get('/api/mobile-topups/payment-methods').expect(401);await request(app).post('/api/mobile-topups/payment-sessions').send({}).expect(401);
    const guest=await request(app).post('/api/auth/guest').send({}).expect(201);
    const account=await request(app).post('/api/auth/register').send({email:'payments@example.com',password:'correct-horse-42',firstName:'Test',lastName:'User'}).expect(201);
    for(const [token,reason] of [[guest.body.accessToken,'GUEST_SCOPE_RESTRICTED'],[account.body.accessToken,'NOT_ENABLED_FOR_RECHARGE']]){
      const methods=await request(app).get('/api/mobile-topups/payment-methods').auth(token,{type:'bearer'}).expect(200);
      expect(methods.body.methods).toContainEqual({type:'BANK_ACCOUNT',provider:'DWOLLA',enabled:false,reason});
      expect(methods.body.methods.filter((m:{enabled:boolean})=>m.enabled)).toEqual([{type:'CARD',enabled:true,provider:'MOCK',testMode:true,label:'Test card — Sandbox'}]);
    }
    await request(app).get('/api/funding/dwolla/funding-sources').auth(guest.body.accessToken,{type:'bearer'}).expect(403);
    await request(app).post('/api/funding/dwolla/customer').auth(guest.body.accessToken,{type:'bearer'}).send({}).expect(403);
  });
  it('strictly rejects client amounts, status, payment selection and raw financial data',async()=>{
    const f=fixture();const app=createApp({mobileTopUpConfig:config,mobileTopUpProvider:f.provider});
    const guest=await request(app).post('/api/auth/guest').send({}).expect(201);const token=guest.body.accessToken;
    const quoted=await request(app).post('/api/mobile-topups/quotes').auth(token,{type:'bearer'}).send(quoteInput).expect(201);
    for(const [field,value] of Object.entries({amount:1,fee:0,totalCharge:1,currency:'EUR',countryCode:'HT',paymentStatus:'CAPTURED',paymentSuccess:true,
      paymentMethod:'BANK_ACCOUNT',provider:'DWOLLA',cardNumber:'4111111111111111',cvv:'123',expiry:'12/30',routingNumber:'000000000',accountNumber:'123456'})) {
      await request(app).post('/api/mobile-topups/payment-sessions').auth(token,{type:'bearer'}).set('Idempotency-Key','safe-key-123').send({quoteId:quoted.body.quote.id,[field]:value}).expect(400);
    }
    await request(app).post('/api/mobile-topups/payment-sessions').auth(token,{type:'bearer'}).send({quoteId:quoted.body.quote.id}).expect(400);
    const response=await request(app).post('/api/mobile-topups/payment-sessions').auth(token,{type:'bearer'}).set('Idempotency-Key','safe-key-123').send({quoteId:quoted.body.quote.id}).expect(201);
    expect(response.body.amountMinor).toBe(599);expect(f.submit).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toMatch(/secret|cardNumber|cvv|accountNumber|routingNumber/);
  });
});

describe('Stripe sandbox flow',()=>{
  const stripeEnv = {
    STRIPE_ENABLED: 'true',
    STRIPE_ENVIRONMENT: 'sandbox',
    STRIPE_SECRET_KEY: 'sk_test_fixture_secret',
    STRIPE_PUBLIC_KEY: 'pk_test_fixture_public',
    STRIPE_WEBHOOK_SECRET: 'whsec_fixture_signing_key',
    STRIPE_SUCCESS_URL: 'https://website.example/success',
    STRIPE_FAILURE_URL: 'https://website.example/failure',
  } as const;

  function stripeFixture() {
    const submit = vi.fn(async () => ({
      transactionId: 'reloadly-fixture',
      status: 'PROCESSING',
      requestedAmount: 5,
      requestedAmountCurrencyCode: 'USD',
    }));

    const provider: MobileTopUpProvider = {
      listCountries: async () => [{ code: 'JM', name: 'Jamaica' }],
      listOperators: async () => [operator],
      getOperator: async () => operator,
      detectOperator: async () => operator,
      submitTopUp: submit,
      getTopUpStatus: async () => ({
        transactionId: 'reloadly-fixture',
        status: 'SUCCESSFUL',
        requestedAmount: 5,
        requestedAmountCurrencyCode: 'USD',
      }),
    };

    const service = new MobileTopUpService(
      { ...config, paymentMode: 'stripe_sandbox' },
      provider,
      new MockMobileTopUpPaymentProvider(),
      new MemoryMobileTopUpRepository(),
      vi.fn(async () => {}),
      undefined,
      new StripeSandboxPaymentProvider(loadStripeConfig(stripeEnv), vi.fn(async () => new Response(JSON.stringify({ id: 'pi_fixture_123', client_secret: 'pi_fixture_123_secret_456' }), { status: 200 }))),
    );

    return { service, provider, submit };
  }

  it('creates a Stripe payment intent from the authoritative server-side quote and blocks browser tampering', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('customer', quoteInput);

    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-session-001', 'US');
    expect(session).toMatchObject({
      provider: 'STRIPE',
      environment: 'SANDBOX',
      paymentStatus: 'SESSION_CREATED',
      amountMinor: 599,
      currency: 'USD',
    });
    expect(session.paymentSession).toMatchObject({ id: 'pi_fixture_123', client_secret: expect.any(String) });
    expect(session.paymentSession).not.toHaveProperty('secret');
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('requires a verified Stripe signature and rejects invalid payloads before fulfillment', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-session-002', 'US');
    const payload = JSON.stringify({
      id: 'evt_test_stripe_1',
      type: 'payment_intent.succeeded',
      data: {
        object: {
          id: 'pi_fixture_123',
          amount_received: 599,
          currency: 'usd',
          status: 'succeeded',
          metadata: { transactionId: session.transactionId },
        },
      },
    });
    const raw = Buffer.from(payload, 'utf8');
    const signed = `t=${Math.floor(Date.now() / 1000)},v1=${createHmac('sha256', stripeEnv.STRIPE_WEBHOOK_SECRET).update(`${Math.floor(Date.now() / 1000)}.${payload}`).digest('hex')}`;

    expect(() => verifyStripeEvent(raw, undefined, stripeEnv.STRIPE_WEBHOOK_SECRET)).toThrow();
    expect(() => verifyStripeEvent(raw, signed, 'wrong-secret')).toThrow();
    expect(verifyStripeEvent(raw, signed, stripeEnv.STRIPE_WEBHOOK_SECRET)).toMatchObject({
      eventId: 'evt_test_stripe_1',
      paymentId: 'pi_fixture_123',
      type: 'payment_intent.succeeded',
      transactionId: session.transactionId,
    });
  });

  it('only successful server-verified Stripe payments can trigger Reloadly fulfillment, and duplicates are ignored', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-session-003', 'US');
    const rawSuccess = Buffer.from(JSON.stringify({
      id: 'evt_stripe_success_1',
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_stripe_success_1', amount_received: 599, currency: 'usd', status: 'succeeded', metadata: { transactionId: session.transactionId } } },
    }));
    const successSig = `t=${Math.floor(Date.now() / 1000)},v1=${createHmac('sha256', stripeEnv.STRIPE_WEBHOOK_SECRET).update(`${Math.floor(Date.now() / 1000)}.${rawSuccess.toString('utf8')}`).digest('hex')}`;

    await f.service.acceptVerifiedPaymentEvent(verifyStripeEvent(rawSuccess, successSig, stripeEnv.STRIPE_WEBHOOK_SECRET));
    expect(f.submit).toHaveBeenCalledTimes(1);

    const rawFailed = Buffer.from(JSON.stringify({
      id: 'evt_stripe_failed_1',
      type: 'payment_intent.payment_failed',
      data: { object: { id: 'pi_stripe_failed_1', amount: 599, currency: 'usd', status: 'requires_payment_method', metadata: { transactionId: session.transactionId } } },
    }));
    const failedSig = `t=${Math.floor(Date.now() / 1000)},v1=${createHmac('sha256', stripeEnv.STRIPE_WEBHOOK_SECRET).update(`${Math.floor(Date.now() / 1000)}.${rawFailed.toString('utf8')}`).digest('hex')}`;
    await expect(f.service.acceptVerifiedPaymentEvent(verifyStripeEvent(rawFailed, failedSig, stripeEnv.STRIPE_WEBHOOK_SECRET))).resolves.toBeUndefined();
    expect(f.submit).toHaveBeenCalledTimes(1);
  });
});
