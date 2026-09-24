import { createHmac } from 'node:crypto';
import request from 'supertest';
import express from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, resetStore } from '../src/app.js';
import { MemoryMobileTopUpRepository } from '../src/topup/repository.js';
import { MobileTopUpService } from '../src/topup/service.js';
import { MobileTopUpError, MockMobileTopUpPaymentProvider, type MobileTopUpConfig, type MobileTopUpPaymentProvider, type MobileTopUpProvider } from '../src/topup/types.js';
import { loadCheckoutConfig } from '../src/topup/checkout-config.js';
import { CheckoutSandboxPaymentProvider, paymentReference } from '../src/topup/checkout-provider.js';
import { createCheckoutWebhookHandler, verifyCheckoutEvent } from '../src/topup/checkout-webhook.js';
import { usdMinorUnits } from '../src/topup/payment-utils.js';

const config: MobileTopUpConfig = { enabled: true, environment: 'sandbox', clientId:'fixture', clientSecret:'fixture',
  authUrl:'https://auth.reloadly.com/oauth/token', airtimeBaseUrl:'https://topups-sandbox.reloadly.com', billingCurrency:'USD',
  feeUsd:'3.50', quoteTtlSeconds:300, paymentMode:'mock', productionEnabled:false, approvedForLiveUse:false };
const checkoutEnv = { CHECKOUT_COM_ENABLED:'true', CHECKOUT_COM_ENVIRONMENT:'sandbox', CHECKOUT_COM_API_BASE_URL:'https://abcdefgh.api.sandbox.checkout.com',
  CHECKOUT_COM_PROCESSING_CHANNEL_ID:'pc_abcdefghijklmnopqrstuvwxyz',
  CHECKOUT_COM_SECRET_KEY:'sk_sbox_fixture_secret', CHECKOUT_COM_PUBLIC_KEY:'pk_sbox_fixture_public', CHECKOUT_COM_WEBHOOK_SECRET:'fixture-signing-key',
  CHECKOUT_COM_SUCCESS_URL:'https://website.example/success', CHECKOUT_COM_FAILURE_URL:'https://website.example/failure' };
const operator = { id:77,name:'Fixture operator',countryCode:'JM',status:true,bundle:false,denominationType:'FIXED' as const,
  senderCurrencyCode:'USD',destinationCurrencyCode:'JMD',fixedAmounts:[5],localFixedAmounts:[800],fixedAmountsPlanNames:{},localFixedAmountsPlanNames:{} };
const quoteInput = { countryCode:'JM',phone:'+18765551234',operatorId:77,productId:'reloadly:JM:77:airtime:5.00' };
function fixture(payment: MobileTopUpPaymentProvider = new MockMobileTopUpPaymentProvider()) {
  const submit = vi.fn(async () => ({transactionId:'reloadly-fixture',status:'PROCESSING',requestedAmount:5,requestedAmountCurrencyCode:'USD'}));
  const provider: MobileTopUpProvider = { listCountries:async()=>[{code:'JM',name:'Jamaica'}],listOperators:async()=>[operator],
    getOperator:async()=>operator,detectOperator:async()=>operator,submitTopUp:submit,
    getTopUpStatus:async()=>({transactionId:'reloadly-fixture',status:'SUCCESSFUL',requestedAmount:5,requestedAmountCurrencyCode:'USD'}) };
  const repository = new MemoryMobileTopUpRepository();const audit=vi.fn(async()=>{});
  const service=new MobileTopUpService(config,provider,payment,repository,audit);
  return {service,repository,provider,submit,audit};
}
function event(transactionId: string, type = 'payment_captured', id = 'evt_test1', amount = 850) {
  const raw=Buffer.from(JSON.stringify({id,type,data:{id:'pay_fixture1',reference:paymentReference(transactionId),amount,currency:'USD'}}));
  const signature=createHmac('sha256',checkoutEnv.CHECKOUT_COM_WEBHOOK_SECRET).update(raw).digest('hex');
  return {raw,signature,verified:()=>verifyCheckoutEvent(raw,signature,checkoutEnv.CHECKOUT_COM_WEBHOOK_SECRET)};
}
async function hosted(f=fixture()) {
  const quote=await f.service.createQuote('customer',quoteInput);
  const session=await f.service.createPaymentSession('customer',{quoteId:quote.id},'session-key-001');
  await f.repository.updateTransaction(session.transactionId,{paymentProvider:'CHECKOUT_COM',paymentSessionId:'ps_fixture1'});
  return {...f,quote,session};
}
beforeEach(()=>{resetStore();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Real provider HTTP is forbidden in tests');}));});
afterEach(()=>vi.unstubAllGlobals());

describe('sandbox payment foundation',()=>{
  it('reserves a server-priced mock session and completes the existing purchase contract',async()=>{
    const f=fixture();const quote=await f.service.createQuote('customer',quoteInput);
    expect(quote).toMatchObject({providerAmount:5,feeUsd:3.5,totalChargeUsd:8.5});
    const session=await f.service.createPaymentSession('customer',{quoteId:quote.id},'session-key-001');
    expect(session).toMatchObject({provider:'MOCK',environment:'SANDBOX',amountMinor:850,currency:'USD',paymentStatus:'SESSION_CREATED'});
    expect(f.submit).not.toHaveBeenCalled();
    const receipt=await f.service.purchase('customer',{quoteId:quote.id},'session-key-001');
    expect(receipt).toMatchObject({id:session.transactionId,paymentMethod:'CARD',paymentProvider:'MOCK',paymentStatus:'AUTHORIZED',status:'PROCESSING'});
    expect(receipt.paymentSessionId).toBe(session.paymentSession.id);expect(receipt.paymentAuthorizationId).toBeTruthy();expect(f.submit).toHaveBeenCalledTimes(1);
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
    expect(response.body.amountMinor).toBe(850);expect(f.submit).not.toHaveBeenCalled();
    expect(JSON.stringify(response.body)).not.toMatch(/secret|cardNumber|cvv|accountNumber|routingNumber/);
    await request(app).post('/api/webhooks/checkout').send({}).expect(503);
  });
});


describe('Checkout.com sandbox application wiring',()=>{
  const checkoutConfig: MobileTopUpConfig = {
    ...config,
    paymentMode: 'checkout_sandbox',
  };

  function checkoutFixture() {
    const submit = vi.fn(async () => ({
      transactionId:'reloadly-fixture',
      status:'PROCESSING',
      requestedAmount:5,
      requestedAmountCurrencyCode:'USD',
    }));

    const provider: MobileTopUpProvider = {
      listCountries:async()=>[{code:'JM',name:'Jamaica'}],
      listOperators:async()=>[operator],
      getOperator:async()=>operator,
      detectOperator:async()=>operator,
      submitTopUp:submit,
      getTopUpStatus:async()=>({
        transactionId:'reloadly-fixture',
        status:'SUCCESSFUL',
        requestedAmount:5,
        requestedAmountCurrencyCode:'USD',
      }),
    };

    const repository = new MemoryMobileTopUpRepository();
    const audit = vi.fn(async()=>{});

    const providerSession = {
      id:'ps_fixturecheckout',
      payment_session_token:'fixture-client-token',
    };

    const transport = vi.fn(async()=>new Response(
      JSON.stringify(providerSession),
      {status:201},
    ));

    const checkout = new CheckoutSandboxPaymentProvider(
      loadCheckoutConfig(checkoutEnv),
      transport,
    );

    const service = new MobileTopUpService(
      checkoutConfig,
      provider,
      new MockMobileTopUpPaymentProvider(),
      repository,
      audit,
      undefined,
      checkout,
    );

    return {
      service,
      repository,
      provider,
      submit,
      audit,
      checkout,
      transport,
      providerSession,
    };
  }

  it('reports Checkout.com Sandbox rather than mock when selected',()=>{
    const f=checkoutFixture();

    expect(f.service.availability()).toMatchObject({
      environment:'SANDBOX',
      paymentMode:'CHECKOUT_COM_SANDBOX',
      testMode:true,
      productionEnabled:false,
      approvedForLiveUse:false,
      liveRechargeEnabled:false,
    });

    expect(f.service.paymentMethods(false).methods).toContainEqual(
      expect.objectContaining({
        type:'CARD',
        provider:'CHECKOUT_COM',
        enabled:true,
        testMode:true,
      }),
    );

    expect(f.service.paymentMethods(true).methods).toContainEqual(
      expect.objectContaining({
        type:'CARD',
        provider:'CHECKOUT_COM',
        enabled:false,
        reason:'GUEST_BILLING_PROFILE_REQUIRED',
      }),
    );
  });

  it('creates one real Checkout Sandbox payment session from the server quote',async()=>{
    const f=checkoutFixture();
    const quote=await f.service.createQuote('customer',quoteInput);

    const session=await f.service.createPaymentSession(
      'customer',
      {quoteId:quote.id},
      'checkout-key-001',
      'US',
    );

    expect(session).toMatchObject({
      provider:'CHECKOUT_COM',
      environment:'SANDBOX',
      transactionId:expect.any(String),
      paymentSession:f.providerSession,
      publicKey:checkoutEnv.CHECKOUT_COM_PUBLIC_KEY,
      testMode:true,
      amountMinor:850,
      currency:'USD',
      paymentStatus:'SESSION_CREATED',
    });

    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.submit).not.toHaveBeenCalled();

    const stored=await f.repository.getTransactionById(session.transactionId);

    expect(stored).toMatchObject({
      paymentProvider:'CHECKOUT_COM',
      paymentSessionId:'ps_fixturecheckout',
      paymentStatus:'SESSION_CREATED',
      status:'PENDING',
    });
  });

  it('requires server billing country and never creates Checkout HTTP without it',async()=>{
    const f=checkoutFixture();
    const quote=await f.service.createQuote('customer',quoteInput);

    await expect(f.service.createPaymentSession(
      'customer',
      {quoteId:quote.id},
      'checkout-key-002',
    )).rejects.toMatchObject({
      code:'BILLING_COUNTRY_REQUIRED',
      statusCode:409,
    });

    expect(f.transport).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('never silently creates a second Checkout session for the same reservation',async()=>{
    const f=checkoutFixture();
    const quote=await f.service.createQuote('customer',quoteInput);

    await f.service.createPaymentSession(
      'customer',
      {quoteId:quote.id},
      'checkout-key-003',
      'US',
    );

    await expect(f.service.createPaymentSession(
      'customer',
      {quoteId:quote.id},
      'checkout-key-003',
      'US',
    )).rejects.toMatchObject({
      code:'PAYMENT_SESSION_REPLAY_UNAVAILABLE',
      statusCode:409,
    });

    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('requires complete Checkout sandbox configuration when createApp selects checkout_sandbox',()=>{
    expect(()=>createApp({
      mobileTopUpConfig:checkoutConfig,
    })).toThrow(/requires complete Checkout.com Sandbox configuration/);
  });
});

describe('Checkout.com sandbox adapter',()=>{
  it('is disabled by default with no guessed URL',()=>{expect(loadCheckoutConfig({})).toMatchObject({enabled:false,environment:'sandbox',apiBaseUrl:undefined});});
  for(const [field,value] of [['CHECKOUT_COM_ENVIRONMENT','production'],['CHECKOUT_COM_API_BASE_URL','https://abcdefgh.api.checkout.com'],
    ['CHECKOUT_COM_API_BASE_URL','https://abcdefgh.api.sandbox.checkout.com.evil.test'],['CHECKOUT_COM_API_BASE_URL','https://user:pass@abcdefgh.api.sandbox.checkout.com'],
    ['CHECKOUT_COM_API_BASE_URL','https://abcdefgh.api.sandbox.checkout.com/path'],['CHECKOUT_COM_SECRET_KEY',''],['CHECKOUT_COM_PUBLIC_KEY',''],['CHECKOUT_COM_WEBHOOK_SECRET',''],
    ['CHECKOUT_COM_PROCESSING_CHANNEL_ID',''],['CHECKOUT_COM_PROCESSING_CHANNEL_ID','invalid-channel']]) {
    it(`fails closed for invalid ${field}: ${value || '(missing)'}`,()=>{expect(()=>loadCheckoutConfig({...checkoutEnv,[field]:value})).toThrow();});
  }
  it('uses only configured sandbox HTTP and preserves the Flow session response unchanged',async()=>{
    const session={id:'ps_fixture1',payment_session_token:'fixture-client-token',_links:{self:{href:'https://abcdefgh.api.sandbox.checkout.com/payment-sessions/ps_fixture1'}}};
    const transport=vi.fn(async()=>new Response(JSON.stringify(session),{status:201}));
    const adapter=new CheckoutSandboxPaymentProvider(loadCheckoutConfig(checkoutEnv),transport);
    const id='11111111-1111-4111-8111-111111111111';const result=await adapter.createPaymentSession({transactionId:id,amountMinor:usdMinorUnits(8.5),currency:'USD',billingCountry:'US'});
    expect(result).toEqual(session);expect(transport).toHaveBeenCalledTimes(1);
    const call=transport.mock.calls[0] as unknown as [string,RequestInit];expect(call[0]).toBe(checkoutEnv.CHECKOUT_COM_API_BASE_URL+'/payment-sessions');
    expect(call[1]).toMatchObject({redirect:'error',method:'POST',headers:{Authorization:`Bearer ${checkoutEnv.CHECKOUT_COM_SECRET_KEY}`}});
    expect(JSON.parse(call[1].body as string)).toMatchObject({amount:850,currency:'USD',reference:paymentReference(id),processing_channel_id:checkoutEnv.CHECKOUT_COM_PROCESSING_CHANNEL_ID,billing:{address:{country:'US'}},enabled_payment_methods:['card']});
    const contract=adapter.flowContract(id,result);expect(contract.paymentSession).toBe(result);expect(contract.publicKey).toBe(checkoutEnv.CHECKOUT_COM_PUBLIC_KEY);
    expect(JSON.stringify(contract)).not.toContain(checkoutEnv.CHECKOUT_COM_SECRET_KEY);expect(JSON.stringify(contract)).not.toContain(checkoutEnv.CHECKOUT_COM_WEBHOOK_SECRET);
  });
  it('does not issue HTTP when disabled or required billing context is absent',async()=>{
    const transport=vi.fn();const adapter=new CheckoutSandboxPaymentProvider(loadCheckoutConfig({}),transport);
    await expect(adapter.createPaymentSession({transactionId:'11111111-1111-4111-8111-111111111111',amountMinor:850,currency:'USD',billingCountry:'US'})).rejects.toMatchObject({code:'CHECKOUT_DISABLED'});
    await expect(adapter.createPaymentSession({transactionId:'11111111-1111-4111-8111-111111111111',amountMinor:850,currency:'USD'})).rejects.toMatchObject({code:'INVALID_PAYMENT_SESSION'});
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects leaked server secrets and suppresses provider error details',async()=>{
    const transport=vi.fn(async()=>new Response(JSON.stringify({id:'ps_fixture1',payment_session_token:'token',secret_key:checkoutEnv.CHECKOUT_COM_SECRET_KEY}),{status:201}));
    const adapter=new CheckoutSandboxPaymentProvider(loadCheckoutConfig(checkoutEnv),transport);
    await expect(adapter.createPaymentSession({transactionId:'11111111-1111-4111-8111-111111111111',amountMinor:850,currency:'USD',billingCountry:'US'})).rejects.toMatchObject({message:'Unsafe payment session response'});
    transport.mockRejectedValue(new Error(checkoutEnv.CHECKOUT_COM_SECRET_KEY));
    await expect(adapter.getPayment('pay_fixture1')).rejects.toMatchObject({message:'Checkout.com request needs reconciliation'});
  });
  it('202 recovery requests remain pending and do not claim confirmed refunds',async()=>{
    const adapter=new CheckoutSandboxPaymentProvider(loadCheckoutConfig(checkoutEnv),vi.fn(async()=>new Response('{}',{status:202})));
    const input={transactionId:'11111111-1111-4111-8111-111111111111',paymentId:'pay_fixture1',amountMinor:850};
    expect(await adapter.void(input)).toBe('VOID_PENDING');expect(await adapter.refund(input)).toBe('REFUND_PENDING');expect(await adapter.capture(input)).toBe('PENDING');
  });
});

describe('verified webhook fulfillment',()=>{
  it('rejects unsigned, wrong-key, tampered and non-raw payloads before fulfillment',async()=>{
    const f=await hosted();const e=event(f.session.transactionId);
    for(const signature of [undefined,'invalid','0'.repeat(64)]) expect(()=>verifyCheckoutEvent(e.raw,signature,checkoutEnv.CHECKOUT_COM_WEBHOOK_SECRET)).toThrow();
    expect(()=>verifyCheckoutEvent(Buffer.concat([e.raw,Buffer.from(' ')]),e.signature,checkoutEnv.CHECKOUT_COM_WEBHOOK_SECRET)).toThrow();
    expect(()=>verifyCheckoutEvent(e.raw,e.signature,'wrong-key')).toThrow();
    await expect(f.service.acceptVerifiedPaymentEvent({} as never)).rejects.toMatchObject({statusCode:401});expect(f.submit).not.toHaveBeenCalled();
  });
  it('authorization alone cannot fulfill; captures and duplicate events fulfill only once',async()=>{
    const f=await hosted();await f.service.acceptVerifiedPaymentEvent(event(f.session.transactionId,'payment_approved','evt_authorized').verified());
    expect(f.submit).not.toHaveBeenCalled();
    await f.service.purchase('customer',{quoteId:f.quote.id},'session-key-001');expect(f.submit).not.toHaveBeenCalled();
    const e=event(f.session.transactionId);await Promise.all(Array.from({length:12},()=>f.service.acceptVerifiedPaymentEvent(e.verified())));
    await f.service.acceptVerifiedPaymentEvent(event(f.session.transactionId,'payment_captured','evt_second').verified());
    expect(f.submit).toHaveBeenCalledTimes(1);expect(await f.repository.getTransactionById(f.session.transactionId)).toMatchObject({paymentStatus:'CAPTURED',paymentProviderTransactionId:'pay_fixture1',providerTransactionId:'reloadly-fixture'});
  });
  it('rejects price mismatches, event ID reuse and provider/transaction mismatch',async()=>{
    const f=await hosted();await expect(f.service.acceptVerifiedPaymentEvent(event(f.session.transactionId,'payment_captured','evt_bad',1).verified())).rejects.toMatchObject({code:'PAYMENT_EVENT_MISMATCH'});
    await f.service.acceptVerifiedPaymentEvent(event(f.session.transactionId,'payment_approved','evt_reused').verified());
    await expect(f.service.acceptVerifiedPaymentEvent(event(f.session.transactionId,'payment_captured','evt_reused').verified())).rejects.toMatchObject({code:'PAYMENT_EVENT_CONFLICT'});
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('payment failure prevents fulfillment and stale authorization cannot regress capture',async()=>{
    const f=await hosted();await f.service.acceptVerifiedPaymentEvent(event(f.session.transactionId,'payment_declined','evt_declined').verified());
    expect(await f.repository.getTransactionById(f.session.transactionId)).toMatchObject({status:'FAILED',paymentStatus:'FAILED'});expect(f.submit).not.toHaveBeenCalled();
    await f.service.acceptVerifiedPaymentEvent(event(f.session.transactionId,'payment_captured','evt_late').verified());expect(f.submit).not.toHaveBeenCalled();
  });
  it('hosted payment followed by failed recharge stays REFUND_PENDING until a verified refund',async()=>{
    const f=await hosted();f.submit.mockResolvedValue({transactionId:'reloadly-fixture',status:'FAILED',requestedAmount:5,requestedAmountCurrencyCode:'USD'});
    await f.service.acceptVerifiedPaymentEvent(event(f.session.transactionId).verified());
    expect(await f.repository.getTransactionById(f.session.transactionId)).toMatchObject({paymentStatus:'REFUND_PENDING',status:'FAILED'});
    await f.service.acceptVerifiedPaymentEvent(event(f.session.transactionId,'payment_refunded','evt_refund').verified());
    expect(await f.repository.getTransactionById(f.session.transactionId)).toMatchObject({paymentStatus:'REFUNDED',paymentRecoveryCode:'RECOVERY_CONFIRMED'});
    await f.service.acceptVerifiedPaymentEvent(event(f.session.transactionId,'payment_captured','evt_latecapture').verified());expect(f.submit).toHaveBeenCalledTimes(1);
  });
  it('a concurrent confirmed refund cannot be downgraded by recovery',async()=>{
    const f=await hosted();f.submit.mockResolvedValue({transactionId:'reloadly-fixture',status:'FAILED',requestedAmount:5,requestedAmountCurrencyCode:'USD'});
    const original=f.repository.transitionPayment.bind(f.repository);
    vi.spyOn(f.repository,'transitionPayment').mockImplementation(async(id,from,input)=>{
      if(input.paymentStatus==='REFUND_PENDING') {
        await original(id,['CAPTURED'],{paymentStatus:'REFUNDED',paymentRecoveryCode:'RECOVERY_CONFIRMED'});
      }
      return original(id,from,input);
    });
    await f.service.acceptVerifiedPaymentEvent(event(f.session.transactionId).verified());
    expect(await f.repository.getTransactionById(f.session.transactionId)).toMatchObject({paymentStatus:'REFUNDED',paymentRecoveryCode:'RECOVERY_CONFIRMED'});
    expect(f.submit).toHaveBeenCalledTimes(1);
  });
  for (const terminal of ['payment_refunded','payment_voided']) it(`${terminal} arriving before capture prevents later airtime`,async()=>{
    const f=await hosted();await f.service.acceptVerifiedPaymentEvent(event(f.session.transactionId,terminal,'evt_terminal').verified());
    await f.service.acceptVerifiedPaymentEvent(event(f.session.transactionId,'payment_captured','evt_late').verified());
    expect(f.submit).not.toHaveBeenCalled();expect((await f.repository.getTransactionById(f.session.transactionId))?.paymentStatus).toBe(terminal==='payment_refunded'?'REFUNDED':'VOIDED');
  });
  it('raw HTTP webhook handling verifies the signature without exposing the payload',async()=>{
    const f=await hosted();const app=express();app.post('/webhook',express.raw({type:'application/json'}),createCheckoutWebhookHandler(loadCheckoutConfig(checkoutEnv),f.service));
    app.use((error:Error & {statusCode?:number},_req:express.Request,res:express.Response,next:express.NextFunction)=>{void next;res.status(error.statusCode??500).json({error:error.message});});
    const e=event(f.session.transactionId);
    await request(app).post('/webhook').set('Content-Type','application/json').send(e.raw.toString()).expect(401);
    await request(app).post('/webhook').set('Content-Type','application/json').set('Cko-Signature',e.signature).send(e.raw.toString()).expect(204);
    expect(f.submit).toHaveBeenCalledTimes(1);
  });
});
