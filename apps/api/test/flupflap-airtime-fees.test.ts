import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, resetStore } from '../src/app.js';
import { flupFlapOwner } from '../src/flupflap/owner.js';
import { ReloadlySandboxTopUpProvider } from '../src/topup/reloadly-provider.js';
import { MemoryMobileTopUpRepository } from '../src/topup/repository.js';
import { MobileTopUpService } from '../src/topup/service.js';
import { StripeHostedCheckoutProvider } from '../src/topup/stripe-provider.js';
import type { StripeConfig } from '../src/topup/stripe-config.js';
import { MockMobileTopUpPaymentProvider, type MobileTopUpConfig, type MobileTopUpOperator, type MobileTopUpProvider } from '../src/topup/types.js';

const cases = [[9.99,115],[10,173],[19.99,173],[20,234],[29.99,234],[30,284],[39.99,284],
  [40,334],[49.99,334],[50,384],[74.99,384],[75,484],[100,484],[5,115],[15,173],[25,234],[35,284],[45,334],[60,384],[90,484]];
const config: MobileTopUpConfig = { enabled:true, environment:'sandbox', paymentMode:'stripe_sandbox',
  productionEnabled:false, approvedForLiveUse:false, billingCurrency:'USD', quoteTtlSeconds:300,
  authUrl:'https://auth.reloadly.com/oauth/token', airtimeBaseUrl:'https://topups-sandbox.reloadly.com' };
const operator: MobileTopUpOperator = { id:77, name:'Fixture carrier', countryCode:'JM', status:true, bundle:false,
  denominationType:'FIXED', senderCurrencyCode:'USD', destinationCurrencyCode:'JMD', fixedAmounts:cases.map(([a])=>a),
  localFixedAmounts:cases.map(([a])=>Number((a*130).toFixed(2))), fixedAmountsPlanNames:{}, localFixedAmountsPlanNames:{} };
const owner = flupFlapOwner('00000000-0000-4000-8000-000000000001');
const input = (amount: number) => ({ countryCode:'JM', phone:'+18765551234', operatorId:77, productId:`reloadly:JM:77:airtime:${amount.toFixed(2)}` });
function fixture(production = false) {
  const repository = new MemoryMobileTopUpRepository();
  const submit = vi.fn(async () => ({ transactionId:'fixture-delivery', status:'SUCCESSFUL', requestedAmount:5,
    requestedAmountCurrencyCode:'USD', deliveredAmount:650, deliveredAmountCurrencyCode:'JMD' }));
  const provider: MobileTopUpProvider = { listCountries:async()=>[{code:'JM',name:'Jamaica'}], listOperators:async()=>[operator],
    getOperator:async()=>operator, detectOperator:async()=>operator, submitTopUp:submit, getTopUpStatus:submit };
  const sessionId = production ? 'cs_live_local_fixture' : 'cs_test_local_fixture';
  const transport = vi.fn(async () => new Response(JSON.stringify({id:sessionId,url:`https://checkout.stripe.com/c/pay/${sessionId}`}), {status:200}));
  // Dummy credentials and intercepted transport only. No provider network access.
  const stripeConfig: StripeConfig = {enabled:true, environment:production?'production':'sandbox', testMode:!production,
    secretKey:production?'sk_live_local_fixture':'sk_test_local_fixture', publicKey:production?'pk_live_local_fixture':'pk_test_local_fixture',
    webhookSecret:'whsec_local_fixture', successUrl:'https://flupflap.com/success', failureUrl:'https://flupflap.com/failure'};
  const stripe = new StripeHostedCheckoutProvider(stripeConfig,transport);
  const runtime: MobileTopUpConfig = production ? {...config,environment:'production',paymentMode:'stripe_live',productionEnabled:true,
    approvedForLiveUse:true,appApprovedForLiveUse:true,liveMoneyEnabled:true,liveRechargeEnabled:true} : config;
  const service = new MobileTopUpService(runtime,provider,new MockMobileTopUpPaymentProvider(),repository,async()=>{},undefined,stripe);
  return {service,repository,provider,submit,transport,stripe,stripeConfig};
}
beforeEach(()=>{resetStore();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Real network forbidden');}));});
afterEach(()=>vi.unstubAllGlobals());

describe('new FlupFlap airtime quotes',()=>{
  it.each([5, 10, 13, 100])('submits a FlupFlap $%s range quote through the real Reloadly adapter', async amount => {
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      const path = String(url);
      if (path === config.authUrl) return new Response(JSON.stringify({access_token:'fixture-token',expires_in:3600}));
      if (path.endsWith('/operators/77')) return new Response(JSON.stringify({operatorId:77,name:operator.name,
        country:{isoName:'JM'},denominationType:'RANGE',senderCurrencyCode:'USD',destinationCurrencyCode:'JMD',minAmount:1,maxAmount:100}));
      if (path.endsWith('/operators/fx-rate')) return new Response(JSON.stringify({id:77,fxRate:amount*130,currencyCode:'JMD'}));
      if (path.endsWith('/topups-async')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({operatorId:77,amount,useLocalAmount:false});
        return new Response(JSON.stringify({transactionId:12345}));
      }
      throw new Error('Unexpected provider endpoint');
    });
    const runtime = {...config,paymentMode:'mock' as const,clientId:'fixture-id',clientSecret:'fixture-secret'};
    const provider = new ReloadlySandboxTopUpProvider(runtime, transport);
    const repository = new MemoryMobileTopUpRepository();
    const service = new MobileTopUpService(runtime,provider,new MockMobileTopUpPaymentProvider(),repository,async()=>{});
    const quote = await service.createQuote(owner,{...input(amount),productId:'reloadly:JM:77:airtime:range',amount});
    expect(quote.productSnapshot).toMatchObject({price:5,minimumAmount:5,maximumAmount:100});
    expect(await service.purchase(owner,{quoteId:quote.id},'range-'+randomUUID())).toMatchObject({status:'PROCESSING',providerTransactionId:'12345'});
    expect(transport.mock.calls.filter(([url])=>String(url).endsWith('/topups-async'))).toHaveLength(1);
  });
  it.each(cases)('production $%s keeps principal/delivery and charges exactly %s cents fee',async(amount,fee)=>{
    const f=fixture(true);const q=await f.service.createQuote(owner,input(amount));
    expect(q).toMatchObject({providerAmount:amount,providerCurrency:'USD',feeUsd:fee/100,totalChargeUsd:(Math.round(amount*100)+fee)/100,
      deliveredValue:Number((amount*130).toFixed(2)),deliveredCurrency:'JMD',receiverQuote:{amount:Number((amount*130).toFixed(2)),currency:'JMD',senderAmount:amount}});
    const session=await f.service.createPaymentSession(owner,{quoteId:q.id},'fee-'+randomUUID(),'US');
    expect(session.amountMinor).toBe(Math.round(amount*100)+fee);
    const args=f.transport.mock.calls[0] as unknown as [string,RequestInit];
    const body=new URLSearchParams(String(args[1].body));
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe(String(Math.round(amount*100)+fee));
    expect(body.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(f.submit).not.toHaveBeenCalled();
    expect((await f.repository.getQuote(owner,q.id))?.receiverQuote).toEqual(q.receiverQuote);
  });
  it('exposes the same $5-$100 Reloadly range to FlupFlap and TiCash',async()=>{
    const f=fixture();
    f.provider.getOperator=async()=>({...operator,denominationType:'RANGE',fixedAmounts:[],localFixedAmounts:[],minAmount:1,maxAmount:100});
    const flupFlap=(await f.service.products('JM',77,undefined,owner)).products[0];
    expect(flupFlap).toMatchObject({price:5,minimumAmount:5,maximumAmount:100,classification:'AIRTIME',amountType:'RANGE'});
    const ticash=(await f.service.products('JM',77,undefined,'ticash-customer')).products[0];
    expect(ticash).toMatchObject({price:5,minimumAmount:5,maximumAmount:100,classification:'AIRTIME',amountType:'RANGE'});
  });
  it('uses the same FlupFlap schedule in sandbox without changing TiCash prices',async()=>{
    const f=fixture();
    expect(await f.service.createQuote(owner,input(5))).toMatchObject({feeUsd:1.15,totalChargeUsd:6.15});
    expect(await f.service.createQuote('ticash-customer',input(5))).toMatchObject({feeUsd:0.99,totalChargeUsd:5.99});
    await expect(f.service.createQuote('ticash-customer',input(1))).rejects.toMatchObject({code:'TOPUP_PRODUCT_UNAVAILABLE'});
  });
  it.each(['DATA','BUNDLE'] as const)('uses airtime fees for FlupFlap %s while preserving TiCash pricing',async classification=>{
    const f=fixture();
    f.provider.listProducts=async()=>[{id:'reloadly:JM:77:plan',provider:'RELOADLY',operatorId:77,countryCode:'JM',classification,kind:'DATA',
      name:'Provider plan',price:12,priceCurrency:'USD',amountType:'FIXED',deliveredCurrency:'JMD',deliveredValue:100}];
    const product=(await f.service.products('JM',77,undefined,owner)).products[0];
    expect(await f.service.createQuote(owner,{...input(12),productId:product.id,catalogVersion:product.catalogVersion})).toMatchObject({feeUsd:1.73,totalChargeUsd:13.73});
    expect(await f.service.createQuote('ticash-customer',{...input(12),productId:product.id,catalogVersion:product.catalogVersion})).toMatchObject({feeUsd:1.25,totalChargeUsd:13.25});
  });
  it.each((['DATA','BUNDLE'] as const).flatMap(classification =>
    cases.map(([amount,fee]) => ({classification,amount,fee}))))(
    '$classification $amount bundle uses the shared fee in its Stripe checkout',async({classification,amount,fee})=>{
    const f=fixture(true);
    f.provider.listProducts=async()=>[{id:'reloadly:JM:77:plan',provider:'RELOADLY',operatorId:77,countryCode:'JM',classification,kind:'DATA',
      name:'Provider internet plan',price:amount,priceCurrency:'USD',amountType:'FIXED',deliveredCurrency:'JMD',deliveredValue:100,
      validity:{quantity:15,unit:'DAY',semantics:'SERVICE'}}];
    const product=(await f.service.products('JM',77,undefined,owner)).products[0];
    const q=await f.service.createQuote(owner,{...input(amount),productId:product.id,catalogVersion:product.catalogVersion});
    expect(q).toMatchObject({providerAmount:amount,feeUsd:fee/100,totalChargeUsd:(Math.round(amount*100)+fee)/100,
      productSnapshot:{validity:{quantity:15,unit:'DAY',semantics:'SERVICE'}}});
    expect(await f.service.createPaymentSession(owner,{quoteId:q.id},'bundle-'+randomUUID(),'US'))
      .toMatchObject({amountMinor:Math.round(amount*100)+fee});
    const args=f.transport.mock.calls[0] as unknown as [string,RequestInit];
    expect(new URLSearchParams(String(args[1].body)).get('line_items[0][price_data][unit_amount]'))
      .toBe(String(Math.round(amount*100)+fee));
    expect(f.submit).not.toHaveBeenCalled();
  });
  it.each(['DATA','BUNDLE'] as const)('preserves an existing %s quote fee on payment and replay',async classification=>{
    const f=fixture();
    f.provider.listProducts=async()=>[{id:'reloadly:JM:77:plan',provider:'RELOADLY',operatorId:77,countryCode:'JM',classification,kind:'DATA',
      name:'Provider plan',price:12,priceCurrency:'USD',amountType:'FIXED',deliveredCurrency:'JMD',deliveredValue:100}];
    const product=(await f.service.products('JM',77,undefined,owner)).products[0];
    const fresh=await f.service.createQuote(owner,{...input(12),productId:product.id,catalogVersion:product.catalogVersion});
    const old=await f.repository.createQuote({...fresh,feeUsd:1.25,totalChargeUsd:13.25});
    for(let attempt=0;attempt<2;attempt++) {
      expect(await f.service.createPaymentSession(owner,{quoteId:old.id},'existing-bundle','US')).toMatchObject({amountMinor:1325});
    }
    expect(await f.repository.getQuote(owner,old.id)).toMatchObject({feeUsd:1.25,totalChargeUsd:13.25});
    const posts=f.transport.mock.calls.filter(call=>(call as unknown as [string,RequestInit])[1].method==='POST');
    expect(posts).toHaveLength(1);
  });
  it('respects exact fixed products and provider range/min/max/increment rules',async()=>{
    const f=fixture();
    await expect(f.service.createQuote(owner,input(12))).rejects.toMatchObject({code:'TOPUP_PRODUCT_UNAVAILABLE'});
    await expect(f.service.createQuote(owner,{...input(5),amount:1})).rejects.toMatchObject({code:'INVALID_TOPUP_AMOUNT'});
    f.provider.getOperator=async()=>({...operator,denominationType:'RANGE',minAmount:1,maxAmount:20});
    f.provider.listProducts=async()=>[{id:'reloadly:JM:77:airtime:range',provider:'RELOADLY',operatorId:77,countryCode:'JM',classification:'AIRTIME',kind:'AIRTIME',
      name:'Provider range',price:5,priceCurrency:'USD',amountType:'RANGE',minimumAmount:5,maximumAmount:20,amountIncrement:0.25,deliveredCurrency:'JMD'}];
    f.provider.quoteReceiverValue=async(p,amount)=>({amount:amount*130,currency:'JMD',senderAmount:amount,senderCurrency:p.priceCurrency,source:'RELOADLY_FX',quotedAt:new Date().toISOString()});
    const range={...input(1),productId:'reloadly:JM:77:airtime:range'};
    expect(await f.service.createQuote(owner,{...range,amount:5})).toMatchObject({providerAmount:5,feeUsd:1.15,totalChargeUsd:6.15});
    expect(await f.service.createQuote(owner,{...range,amount:15.25})).toMatchObject({providerAmount:15.25,feeUsd:1.73,totalChargeUsd:16.98});
    for(const amount of [0.99,1,4.99,20.25,100.01,5.01,5.001]) await expect(f.service.createQuote(owner,{...range,amount})).rejects.toMatchObject({code:'INVALID_TOPUP_AMOUNT'});
    const q=await f.service.createQuote(owner,{...range,amount:5});
    const prior=f.provider.listProducts;
    f.provider.listProducts=async(c,id)=>(await prior(c,id))!.map(p=>({...p,amountIncrement:0.5}));
    await expect(f.service.createPaymentSession(owner,{quoteId:q.id},'changed-snapshot','US')).rejects.toMatchObject({code:'TOPUP_QUOTE_CHANGED'});
  });
  it.each([99,139])('preserves an old %s-cent fee quote, Stripe replay, completed receipt and history without repricing',async(oldFee)=>{
    const f=fixture();const fresh=await f.service.createQuote(owner,input(5));
    const old=await f.repository.createQuote({...fresh,feeUsd:oldFee/100,totalChargeUsd:(500+oldFee)/100});
    expect(await f.service.createPaymentSession(owner,{quoteId:old.id},'historical-session','US')).toMatchObject({amountMinor:500+oldFee});
    await f.repository.transitionPayment((await f.repository.getTransactionByIdempotency(owner,'historical-session'))!.id,['SESSION_CREATED'],{paymentStatus:'CAPTURED',status:'DELIVERED',deliveredValue:650});
    const before=structuredClone(await f.repository.listTransactions(owner));
    expect(await f.service.createPaymentSession(owner,{quoteId:old.id},'historical-session','US')).toMatchObject({amountMinor:500+oldFee});
    await f.service.createQuote(owner,input(5));
    expect(await f.repository.listTransactions(owner)).toEqual(before);
    expect(await f.repository.getQuote(owner,old.id)).toMatchObject({feeUsd:oldFee/100,totalChargeUsd:(500+oldFee)/100});
    const posts=f.transport.mock.calls.filter(call=>(call as unknown as [string,RequestInit])[1].method==='POST');
    expect(posts).toHaveLength(1);expect(f.submit).not.toHaveBeenCalled();
  });
  it('API accepts provider-backed $5, rejects client fees/totals and preserves guest separation',async()=>{
    const f=fixture();const app=createApp({flupFlapConfig:{enabled:true,accessSecret:'test-flupflap-identity-secret-at-least-32-characters'},
      mobileTopUpConfig:config,mobileTopUpProvider:f.provider,mobileTopUpStripeProvider:f.stripe,stripeConfig:f.stripeConfig});
    const guest=await request(app).post('/api/flupflap/auth/guest').send({}).expect(201);
    const root='/api/flupflap/mobile-topups';const token=guest.body.accessToken;
    for(const field of ['fee','feeUsd','totalChargeUsd','providerAmount','paymentStatus']) {
      await request(app).post(root+'/quotes').auth(token,{type:'bearer'}).send({...input(1),[field]:0}).expect(400);
    }
    const q=(await request(app).post(root+'/quotes').auth(token,{type:'bearer'}).send(input(5)).expect(201)).body.quote;
    expect(q).toMatchObject({providerAmount:5,feeUsd:1.15,totalChargeUsd:6.15});
    for(const field of ['fee','feeUsd','totalChargeUsd','amountMinor']) await request(app).post(root+'/payment-sessions').auth(token,{type:'bearer'})
      .set('Idempotency-Key','api-fee-session').send({quoteId:q.id,billingCountry:'US',[field]:0}).expect(400);
    await request(app).patch('/api/flupflap/auth/me').auth(token,{type:'bearer'}).send({countryCode:'US'}).expect(403);
    expect((await request(app).post(root+'/payment-sessions').auth(token,{type:'bearer'}).set('Idempotency-Key','api-fee-session')
      .send({quoteId:q.id,billingCountry:'US'}).expect(201)).body.amountMinor).toBe(615);
    expect(f.submit).not.toHaveBeenCalled();
  });
});
