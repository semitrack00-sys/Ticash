import { createHash, createHmac } from 'node:crypto';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, resetStore } from '../src/app.js';
import { MemoryMobileTopUpRepository } from '../src/topup/repository.js';
import { MobileTopUpService } from '../src/topup/service.js';
import { MobileTopUpError, MockMobileTopUpPaymentProvider, type MobileTopUpConfig, type MobileTopUpPaymentProvider, type MobileTopUpProvider, type MobileTopUpOperator } from '../src/topup/types.js';
import { loadStripeConfig } from '../src/topup/stripe-config.js';
import { StripeSandboxPaymentProvider } from '../src/topup/stripe-provider.js';
import { verifyStripeEvent } from '../src/topup/stripe-webhook.js';
import { FlupFlapIdentityRepository } from '../src/flupflap/repository.js';
import { flupFlapOwner } from '../src/flupflap/owner.js';

const config: MobileTopUpConfig = { enabled: true, environment: 'sandbox', clientId:'fixture', clientSecret:'fixture',
  authUrl:'https://auth.reloadly.com/oauth/token', airtimeBaseUrl:'https://topups-sandbox.reloadly.com', billingCurrency:'USD',
  quoteTtlSeconds:300, paymentMode:'mock', productionEnabled:false, approvedForLiveUse:false };
const productionConfig: MobileTopUpConfig = {
  ...config,
  environment: 'production',
  paymentMode: 'mock',
  productionEnabled: true,
  approvedForLiveUse: true,
  appApprovedForLiveUse: true,
  liveMoneyEnabled: true,
  liveRechargeEnabled: true,
};
const approvedRechargeGrid = [
  [5, 0.99, 5.99],
  [10, 1.25, 11.25],
  [20, 1.49, 21.49],
  [30, 1.99, 31.99],
  [50, 2.49, 52.49],
  [75, 3.49, 78.49],
  [100, 4.49, 104.49],
] as const;
const operator = { id:77,name:'Fixture operator',countryCode:'JM',status:true,bundle:false,denominationType:'FIXED' as const,
  senderCurrencyCode:'USD',destinationCurrencyCode:'JMD',fixedAmounts:[5,10,20,30,50,75,100],localFixedAmounts:[800,1300,2400,3500,5700,8200,10800],fixedAmountsPlanNames:{},localFixedAmountsPlanNames:{} };
const quoteInput = { countryCode:'JM',phone:'+18765551234',operatorId:77,productId:'reloadly:JM:77:airtime:5.00' };
const quoteInputFor = (amount: number) => ({ countryCode:'JM', phone:'+18765551234', operatorId:77, productId:`reloadly:JM:77:airtime:${amount.toFixed(2)}` });
const rangeOperator = { ...operator, denominationType: 'RANGE' as const, fixedAmounts: [], localFixedAmounts: [], minAmount: 5, maxAmount: 100 };
function fixture(payment: MobileTopUpPaymentProvider = new MockMobileTopUpPaymentProvider(), overrideOperator: MobileTopUpOperator = operator) {
  const submit = vi.fn(async () => ({transactionId:'reloadly-fixture',status:'PROCESSING',requestedAmount:5,requestedAmountCurrencyCode:'USD'}));
  const provider: MobileTopUpProvider = {
    quoteReceiverValue: async (p, amount) => ({ amount: p.deliveredValue ?? amount * 130, currency: p.deliveredCurrency,
      senderAmount: amount, senderCurrency: p.priceCurrency, source: 'RELOADLY_FX', quotedAt: new Date().toISOString() }),
    listCountries:async()=>[{code:'JM',name:'Jamaica'}],listOperators:async()=>[overrideOperator],
    getOperator:async()=>overrideOperator,detectOperator:async()=>overrideOperator,submitTopUp:submit,
    getTopUpStatus:async()=>({transactionId:'reloadly-fixture',status:'SUCCESSFUL',requestedAmount:5,requestedAmountCurrencyCode:'USD'}) };
  const repository = new MemoryMobileTopUpRepository();const audit=vi.fn(async()=>{});
  const service=new MobileTopUpService(config,provider,payment,repository,audit);
  return {service,repository,provider,submit,audit};
}
beforeEach(()=>{resetStore();vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('Real provider HTTP is forbidden in tests');}));});
afterEach(()=>vi.unstubAllGlobals());

describe('sandbox payment foundation',()=>{
  it.each(['DATA', 'BUNDLE'] as const)('quotes provider-backed $12 %s products without restricting them to legacy anchors', async classification => {
    const f = fixture();
    f.provider.getOperator = async () => ({ ...operator, data: classification === 'DATA', bundle: classification === 'BUNDLE',
      fixedAmounts: [12], localFixedAmounts: [], fixedAmountsPlanNames: { '12': 'Provider plan' } });
    const { products } = await f.service.products('JM', 77);
    expect(products).toHaveLength(1);
    const product = products[0]!;
    expect(product).toMatchObject({ classification, price: 12, amountType: 'FIXED' });
    const input = { ...quoteInput, productId: product.id, catalogVersion: product.catalogVersion };
    const quote = await f.service.createQuote('customer', input);
    expect(quote).toMatchObject({ providerAmount: 12, feeUsd: 1.25, totalChargeUsd: 13.25, productSnapshot: product });
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, `fixed-plan-${classification}`);
    expect(session.amountMinor).toBe(1325);
    await expect(f.service.createQuote('customer', { ...input, amount: 12 })).rejects.toMatchObject({ code: 'INVALID_TOPUP_AMOUNT' });
    await expect(f.service.createQuote('customer', { ...input, catalogVersion: 'stale' })).rejects.toMatchObject({ code: 'TOPUP_CATALOG_CHANGED' });
    f.provider.getOperator = async () => ({ ...operator, data: classification === 'DATA', bundle: classification === 'BUNDLE',
      fixedAmounts: [12], localFixedAmounts: [], fixedAmountsPlanNames: { '12': 'Changed provider plan' } });
    // The earlier reservation still must revalidate its locked snapshot before fulfillment.
    await expect(f.service.purchase('customer', { quoteId: quote.id }, `fixed-plan-${classification}`)).rejects.toMatchObject({ code: 'TOPUP_REJECTED' });
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('rejects fabricated fixed products and fixed catalog prices outside policy', async () => {
    const f = fixture();
    await expect(f.service.createQuote('customer', quoteInputFor(12))).rejects.toMatchObject({ code: 'TOPUP_PRODUCT_UNAVAILABLE' });
    f.provider.getOperator = async () => ({ ...operator, fixedAmounts: [4.99, 100.01], localFixedAmounts: [] });
    expect((await f.service.products('JM', 77)).products).toEqual([]);
    for (const amount of [4.99, 100.01]) {
      await expect(f.service.createQuote('customer', quoteInputFor(amount))).rejects.toMatchObject({ code: 'TOPUP_PRODUCT_UNAVAILABLE' });
    }
  });
  it('honors provider range increments and precision and locks those rules in the snapshot', async () => {
    const f = fixture(new MockMobileTopUpPaymentProvider(), rangeOperator);
    const range = (await f.service.products('JM', 77)).products[0]!;
    let current = { ...range, minimumAmount: 5.25, maximumAmount: 20.25, price: 5.25, amountIncrement: 0.5, amountPrecision: 2 };
    f.provider.listProducts = async () => [current];
    const input = { ...quoteInput, productId: range.id };
    const quote = await f.service.createQuote('customer', { ...input, amount: 12.25 });
    expect(quote).toMatchObject({ providerAmount: 12.25, feeUsd: 1.25, totalChargeUsd: 13.5 });
    for (const amount of [5, 20.75, 12.5, 12.251, 4.99, 100.01]) {
      await expect(f.service.createQuote('customer', { ...input, amount })).rejects.toMatchObject({ code: 'INVALID_TOPUP_AMOUNT' });
    }
    current = { ...current, amountIncrement: 1 };
    await expect(f.service.createPaymentSession('customer', { quoteId: quote.id }, 'changed-range-rule')).rejects.toMatchObject({ code: 'TOPUP_QUOTE_CHANGED' });
    current = { ...current, price: 5, minimumAmount: 5, maximumAmount: 20, amountIncrement: 0.1, amountPrecision: 0 };
    await expect(f.service.createQuote('customer', { ...input, amount: 12.1 })).rejects.toMatchObject({ code: 'INVALID_TOPUP_AMOUNT' });
    expect((await f.service.createQuote('customer', { ...input, amount: 12 })).totalChargeUsd).toBe(13.25);
    current = { ...current, amountIncrement: 0 };
    await expect(f.service.products('JM', 77)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    expect(f.submit).not.toHaveBeenCalled();
  });
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
  it('cancels only an untouched pending recharge and blocks cancellation after authorization', async () => {
    const f = fixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'cancel-pending-001');
    const cancelled = await f.service.cancelTransaction('customer', session.transactionId);
    expect(cancelled).toMatchObject({ status: 'FAILED', paymentStatus: 'FAILED', failureCode: 'CANCELLED_BY_CUSTOMER' });
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.audit.mock.calls.flat()).toContain('MOBILE_TOPUP_CANCELLED_BY_CUSTOMER');
    await expect(f.service.cancelTransaction('customer', session.transactionId)).rejects.toMatchObject({ code: 'TOPUP_NOT_CANCELLABLE', statusCode: 409 });

    await f.service.deleteCancelledTransactionFromHistory('customer', session.transactionId);
    expect(await f.repository.listTransactions('customer')).toHaveLength(0);
    await expect(f.service.getTransaction('customer', session.transactionId)).rejects.toMatchObject({ code: 'TOPUP_NOT_FOUND', statusCode: 404 });
    expect(await f.repository.getTransactionById(session.transactionId)).toMatchObject({
      id: session.transactionId,
      failureCode: 'CANCELLED_BY_CUSTOMER',
      customerHiddenAt: expect.any(String),
    });
    expect(f.audit.mock.calls.flat()).toContain('MOBILE_TOPUP_HIDDEN_BY_CUSTOMER');

    const quote2 = await f.service.createQuote('customer', quoteInput);
    const paid = await f.service.purchase('customer', { quoteId: quote2.id }, 'cancel-paid-001');
    expect(['AUTHORIZED', 'CAPTURED']).toContain(paid.paymentStatus);
    await expect(f.service.cancelTransaction('customer', paid.id)).rejects.toMatchObject({ code: 'TOPUP_NOT_CANCELLABLE', statusCode: 409 });
    await expect(f.service.deleteCancelledTransactionFromHistory('customer', paid.id)).rejects.toMatchObject({ code: 'TOPUP_NOT_DELETABLE', statusCode: 409 });
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
    [7, 0.99],
    [10, 1.25],
    [14, 1.25],
    [19, 1.25],
    [20, 1.49],
    [23, 1.49],
    [30, 1.99],
    [35, 1.99],
    [40, 1.99],
    [50, 2.49],
    [75, 3.49],
    [95, 3.49],
    [100, 4.49],
  ])('calculates the authoritative backend fee for custom USD amount $%s as $%s', async (amount, fee) => {
    const f = fixture(new MockMobileTopUpPaymentProvider(), rangeOperator);
    const quote = await f.service.createQuote('customer', { ...quoteInput, operatorId: rangeOperator.id, productId: 'reloadly:JM:77:airtime:range', amount });
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
    const f = fixture(new MockMobileTopUpPaymentProvider(), rangeOperator);
    await expect(f.service.createQuote('customer', { ...quoteInput, productId: 'reloadly:JM:77:airtime:range', amount })).rejects.toMatchObject({ statusCode: 400 });
  });
  it('preserves the authoritative Stripe total for custom amounts', async () => {
    const f = fixture(new MockMobileTopUpPaymentProvider(), rangeOperator);
    const quote = await f.service.createQuote('customer', { ...quoteInput, operatorId: rangeOperator.id, productId: 'reloadly:JM:77:airtime:range', amount: 40 });
    expect(quote).toMatchObject({ providerAmount: 40, feeUsd: 1.99, totalChargeUsd: 41.99 });
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'custom-stripe-total');
    expect(session.amountMinor).toBe(4199);
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

  it('fails closed before provider submission when persisted payment/recharge environments mismatch', async () => {
    const f = fixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'env-mismatch-check');
    const stored = (await f.repository.listTransactions('customer'))[0]!;
    await f.repository.updateTransaction(stored.id, { paymentStatus: 'AUTHORIZED' });
    await f.repository.updateTransaction(stored.id, { paymentEnvironment: 'PRODUCTION' } as never);
    await expect(f.service.fulfillPaidRecharge(session.transactionId)).rejects.toMatchObject({ code: 'TOPUP_ENVIRONMENT_MISMATCH' });
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('blocks Stripe refund when sandbox transaction is recovered under production runtime before any provider action', async () => {
    const f = fixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'recovery-env-refund');
    const record = (await f.repository.listTransactions('customer'))[0]!;
    await f.repository.updateTransaction(record.id, {
      paymentStatus: 'CAPTURED',
      paymentProvider: 'STRIPE',
      paymentProviderTransactionId: 'pi_refund_guard',
    });
    const refund = vi.fn(async () => 'REFUNDED' as const);
    const voidPayment = vi.fn(async () => 'VOIDED' as const);
    const productionRuntimeService = new MobileTopUpService(
      productionConfig,
      f.provider,
      new MockMobileTopUpPaymentProvider(),
      f.repository,
      f.audit,
      undefined,
      { refund, void: voidPayment } as never,
    );

    await expect((productionRuntimeService as unknown as { recoverPayment: (id: string) => Promise<unknown> }).recoverPayment(session.transactionId))
      .rejects.toMatchObject({ code: 'TOPUP_ENVIRONMENT_MISMATCH' });
    expect(refund).not.toHaveBeenCalled();
    expect(voidPayment).not.toHaveBeenCalled();
  });

  it('blocks Stripe void when sandbox transaction is recovered under production runtime before any provider action', async () => {
    const f = fixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'recovery-env-void');
    const record = (await f.repository.listTransactions('customer'))[0]!;
    await f.repository.updateTransaction(record.id, {
      paymentStatus: 'AUTHORIZED',
      paymentProvider: 'STRIPE',
      paymentProviderTransactionId: 'pi_void_guard',
    });
    const refund = vi.fn(async () => 'REFUNDED' as const);
    const voidPayment = vi.fn(async () => 'VOIDED' as const);
    const productionRuntimeService = new MobileTopUpService(
      productionConfig,
      f.provider,
      new MockMobileTopUpPaymentProvider(),
      f.repository,
      f.audit,
      undefined,
      { refund, void: voidPayment } as never,
    );

    await expect((productionRuntimeService as unknown as { recoverPayment: (id: string) => Promise<unknown> }).recoverPayment(session.transactionId))
      .rejects.toMatchObject({ code: 'TOPUP_ENVIRONMENT_MISMATCH' });
    expect(voidPayment).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
  });

  it('blocks recovery provider selection when production transaction is recovered under sandbox runtime', async () => {
    const f = fixture();
    const productionService = new MobileTopUpService(
      productionConfig,
      f.provider,
      new MockMobileTopUpPaymentProvider(),
      f.repository,
      f.audit,
    );
    const quote = await productionService.createQuote('customer', quoteInput);
    const session = await productionService.createPaymentSession('customer', { quoteId: quote.id }, 'prod-recovery-under-sandbox');
    const record = (await f.repository.listTransactions('customer'))[0]!;
    await f.repository.updateTransaction(record.id, {
      paymentStatus: 'AUTHORIZED',
      paymentProvider: 'STRIPE',
      paymentProviderTransactionId: 'pi_prod_guard',
    });
    const refund = vi.fn(async () => 'REFUNDED' as const);
    const voidPayment = vi.fn(async () => 'VOIDED' as const);
    const sandboxRuntimeService = new MobileTopUpService(
      config,
      f.provider,
      new MockMobileTopUpPaymentProvider(),
      f.repository,
      f.audit,
      undefined,
      { refund, void: voidPayment } as never,
    );

    await expect((sandboxRuntimeService as unknown as { recoverPayment: (id: string) => Promise<unknown> }).recoverPayment(session.transactionId))
      .rejects.toMatchObject({ code: 'TOPUP_ENVIRONMENT_MISMATCH' });
    expect(refund).not.toHaveBeenCalled();
    expect(voidPayment).not.toHaveBeenCalled();
  });

  it('rejects SANDBOX records marked with testMode=false', () => {
    const f = fixture();
    const assertEnv = (f.service as unknown as { assertTransactionEnvironment: (r: { paymentEnvironment: 'SANDBOX' | 'PRODUCTION'; rechargeEnvironment: 'SANDBOX' | 'PRODUCTION'; testMode: boolean }) => void }).assertTransactionEnvironment.bind(f.service);
    expect(() => assertEnv({ paymentEnvironment: 'SANDBOX', rechargeEnvironment: 'SANDBOX', testMode: false }))
      .toThrowError(MobileTopUpError);
  });

  it('rejects PRODUCTION records marked with testMode=true and accepts matching combinations', () => {
    const sandbox = fixture();
    const production = new MobileTopUpService(
      productionConfig,
      sandbox.provider,
      new MockMobileTopUpPaymentProvider(),
      sandbox.repository,
      sandbox.audit,
    );
    const assertSandbox = (sandbox.service as unknown as { assertTransactionEnvironment: (r: { paymentEnvironment: 'SANDBOX' | 'PRODUCTION'; rechargeEnvironment: 'SANDBOX' | 'PRODUCTION'; testMode: boolean }) => void }).assertTransactionEnvironment.bind(sandbox.service);
    const assertProduction = (production as unknown as { assertTransactionEnvironment: (r: { paymentEnvironment: 'SANDBOX' | 'PRODUCTION'; rechargeEnvironment: 'SANDBOX' | 'PRODUCTION'; testMode: boolean }) => void }).assertTransactionEnvironment.bind(production);

    expect(() => assertSandbox({ paymentEnvironment: 'SANDBOX', rechargeEnvironment: 'SANDBOX', testMode: true })).not.toThrow();
    expect(() => assertProduction({ paymentEnvironment: 'PRODUCTION', rechargeEnvironment: 'PRODUCTION', testMode: false })).not.toThrow();
    expect(() => assertProduction({ paymentEnvironment: 'PRODUCTION', rechargeEnvironment: 'PRODUCTION', testMode: true }))
      .toThrowError(MobileTopUpError);
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
    STRIPE_SUCCESS_URL: 'https://ticash-app.com/success',
    STRIPE_FAILURE_URL: 'https://flupflap.com/failure',
  } as const;

  function stripeResponse(body: Record<string, unknown>) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }

  function transportRequest(transport: ReturnType<typeof vi.fn>, index = 0) {
    const [url, init] = transport.mock.calls[index] as [string, RequestInit];
    return {
      url,
      init,
      headers: init.headers as Record<string, string>,
      body: typeof init.body === 'string' ? init.body : '',
    };
  }

  function stripeFixture(
    transport = vi.fn(async () => stripeResponse({ id: 'cs_test_fixture_123', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture_123' })),
    options: {
      enabled?: boolean;
      configured?: boolean;
      clock?: () => Date;
      configOverride?: Partial<MobileTopUpConfig>;
    } = {},
  ) {
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

    const stripeProvider = options.configured === false ? undefined
      : new StripeSandboxPaymentProvider(loadStripeConfig(stripeEnv), transport);
    const repository = new MemoryMobileTopUpRepository();
    const service = new MobileTopUpService(
      {
        ...config,
        ...(options.configOverride ?? {}),
        enabled: options.enabled ?? true,
        paymentMode: 'stripe_sandbox',
      },
      provider,
      new MockMobileTopUpPaymentProvider(),
      repository,
      vi.fn(async () => {}),
      options.clock,
      stripeProvider,
    );

    return { service, provider, repository, submit, transport, stripeProvider };
  }

  it('confirms Stripe refund immediately when Stripe returns succeeded', async () => {
    const transport = vi.fn(async () => stripeResponse({
      id: 're_fixture_123',
      status: 'succeeded',
      amount: 599,
      payment_intent: 'pi_fixture_123',
      metadata: { transactionId: 'transaction-fixture' },
    }));
    const provider = new StripeSandboxPaymentProvider(loadStripeConfig(stripeEnv), transport);
    await expect(provider.refund({
      paymentId: 'pi_fixture_123',
      transactionId: 'transaction-fixture',
      amountMinor: 599,
    })).resolves.toBe('REFUNDED');
    const payload = new URLSearchParams(transportRequest(transport).body);
    expect(payload.get('metadata[transactionId]')).toBe('transaction-fixture');
  });

  it('reconciles a pending Stripe refund from the refunds API without resubmitting it', async () => {
    const transport = vi.fn(async () => stripeResponse({
      object: 'list',
      data: [{
        id: 're_fixture_123',
        status: 'succeeded',
        amount: 599,
        metadata: { transactionId: 'transaction-fixture' },
      }],
    }));
    const provider = new StripeSandboxPaymentProvider(loadStripeConfig(stripeEnv), transport);
    await expect(provider.getRecoveryStatus({
      paymentId: 'pi_fixture_123',
      transactionId: 'transaction-fixture',
      kind: 'REFUND',
      amountMinor: 599,
    })).resolves.toBe('REFUNDED');
    expect(transportRequest(transport).url).toContain('/v1/refunds?payment_intent=pi_fixture_123');
  });

  it.each([true, false])('enables configured Stripe Sandbox CARD for guest=%s while preserving bank restrictions', guest => {
    const f = stripeFixture();
    const methods = f.service.paymentMethods(guest).methods;
    const card = methods.find(method => method.type === 'CARD');
    expect(card).toMatchObject({ enabled: true, provider: 'STRIPE', testMode: true });
    expect(card).not.toHaveProperty('reason');
    expect(methods).toContainEqual({ type: 'BANK_ACCOUNT', enabled: false, provider: 'DWOLLA',
      reason: guest ? 'GUEST_SCOPE_RESTRICTED' : 'NOT_ENABLED_FOR_RECHARGE' });
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it.each([true, false])('keeps CARD disabled without a Stripe provider for guest=%s', guest => {
    const f = stripeFixture(undefined, { configured: false });
    expect(f.service.paymentMethods(guest).methods.find(method => method.type === 'CARD'))
      .toMatchObject({ enabled: false, provider: 'STRIPE', reason: 'PROVIDER_NOT_CONFIGURED' });
  });

  it.each([true, false])('prioritizes RECHARGE_DISABLED for guest=%s regardless of Stripe configuration', guest => {
    for (const configured of [true, false]) {
      const f = stripeFixture(undefined, { enabled: false, configured });
      expect(f.service.paymentMethods(guest).methods.find(method => method.type === 'CARD'))
        .toMatchObject({ enabled: false, provider: 'STRIPE', reason: 'RECHARGE_DISABLED' });
    }
  });

  it.each([undefined, '', 'USA', '1!'])('still rejects missing or malformed billing country %s before contacting Stripe', async billingCountry => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('guest', quoteInput);
    await expect(f.service.createPaymentSession('guest', { quoteId: quote.id }, 'guest-country-required', billingCountry))
      .rejects.toMatchObject({ code: 'BILLING_COUNTRY_REQUIRED' });
    expect(await f.repository.listTransactions('guest')).toEqual([]);
    expect((await f.repository.getQuote('guest', quote.id))?.consumedAt).toBeUndefined();
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('does not reserve or consume the quote when Stripe is unconfigured', async () => {
    const f = stripeFixture(undefined, { configured: false });
    const quote = await f.service.createQuote('customer', quoteInput);
    await expect(f.service.createPaymentSession('customer', { quoteId: quote.id }, 'missing-stripe-provider', 'US'))
      .rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_DISABLED' });
    expect(await f.repository.listTransactions('customer')).toEqual([]);
    expect((await f.repository.getQuote('customer', quote.id))?.consumedAt).toBeUndefined();
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('cancels an untouched Stripe orphan, and the cancelled reservation cannot start a session', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    const orphan = await f.service.purchase('customer', { quoteId: quote.id }, 'legacy-orphan-reservation');
    expect(orphan).toMatchObject({ status: 'PENDING', paymentStatus: 'PENDING', paymentProvider: 'STRIPE' });
    const cancelled = await f.service.cancelTransaction('customer', orphan.id);
    expect(cancelled).toMatchObject({ status: 'FAILED', paymentStatus: 'FAILED', failureCode: 'CANCELLED_BY_CUSTOMER' });
    await expect(f.service.createPaymentSession('customer', { quoteId: quote.id }, 'legacy-orphan-reservation', 'US'))
      .rejects.toMatchObject({ code: 'PAYMENT_SESSION_IN_PROGRESS' });
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('cancellation loses atomically if payment creation claims an orphan first', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    const orphan = await f.service.purchase('customer', { quoteId: quote.id }, 'orphan-cancel-race');
    const claim = f.repository.claimOperation.bind(f.repository);
    vi.spyOn(f.repository, 'claimOperation').mockImplementationOnce(async (id, op, when) => {
      expect(await claim(id, op, when)).toBe(true); // concurrent session creation wins
      return claim(id, op, when);
    });
    await expect(f.service.cancelTransaction('customer', orphan.id)).rejects.toMatchObject({ code: 'TOPUP_CANCELLATION_UNRESOLVED' });
    expect((await f.repository.getTransactionById(orphan.id))?.paymentStatus).toBe('PENDING');
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('refuses cancellation after an unknown Stripe session-creation outcome', async () => {
    const transport = vi.fn(async () => { throw new Error('lost response'); });
    const f = stripeFixture(transport);
    const quote = await f.service.createQuote('customer', quoteInput);
    await expect(f.service.createPaymentSession('customer', { quoteId: quote.id }, 'unknown-session-cancel', 'US')).rejects.toBeDefined();
    const [record] = await f.repository.listTransactions('customer');
    await expect(f.service.cancelTransaction('customer', record!.id)).rejects.toMatchObject({ code: 'TOPUP_CANCELLATION_UNRESOLVED' });
    expect((await f.repository.getTransactionById(record!.id))?.paymentStatus).toBe('PENDING');
    expect(transport).toHaveBeenCalledTimes(1);
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('creates a guest Stripe Sandbox session with explicit US billing country, independent of the JM destination', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('guest', quoteInput);
    const session = await f.service.createPaymentSession('guest', { quoteId: quote.id }, 'guest-explicit-country', 'US');
    expect(session).toMatchObject({ provider: 'STRIPE', environment: 'SANDBOX', testMode: true, amountMinor: 599 });
    expect(new URLSearchParams(transportRequest(f.transport).body).get('metadata[billingCountry]')).toBe('US');
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('exposes guest CARD through the FlupFlap endpoint without permitting guest profile changes or billing-country inference', async () => {
    const f = stripeFixture();
    const app = createApp({
      flupFlapConfig: { enabled: true, accessSecret: 'test-flupflap-only-secret-at-least-32-characters' },
      mobileTopUpConfig: { ...config, paymentMode: 'stripe_sandbox' },
      mobileTopUpProvider: f.provider,
      stripeConfig: loadStripeConfig({ ...stripeEnv, MOBILE_TOPUP_PAYMENT_MODE: 'stripe_sandbox' }),
      mobileTopUpStripeProvider: f.stripeProvider,
    });
    const root = '/api/flupflap';
    const guest = await request(app).post(root + '/auth/guest').send({}).expect(201);
    const token = guest.body.accessToken;
    const methods = await request(app).get(root + '/mobile-topups/payment-methods').auth(token, { type: 'bearer' }).expect(200);
    expect(methods.body.methods).toContainEqual(expect.objectContaining({ type: 'CARD', enabled: true, provider: 'STRIPE' }));
    expect(methods.body.methods).toContainEqual({ type: 'BANK_ACCOUNT', enabled: false, provider: 'DWOLLA', reason: 'GUEST_SCOPE_RESTRICTED' });
    await request(app).patch(root + '/auth/me').auth(token, { type: 'bearer' }).send({ countryCode: 'US' }).expect(403);
    const quote = await request(app).post(root + '/mobile-topups/quotes').auth(token, { type: 'bearer' }).send(quoteInput).expect(201);
    const missingCountry = await request(app).post(root + '/mobile-topups/payment-sessions').auth(token, { type: 'bearer' })
      .set('Idempotency-Key', 'guest-route-country-required').send({ quoteId: quote.body.quote.id }).expect(409);
    expect(missingCountry.body.code).toBe('BILLING_COUNTRY_REQUIRED');
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  function flupFlapStripeFixture() {
    const f = stripeFixture();
    const htOperator = { ...operator, countryCode: 'HT', destinationCurrencyCode: 'HTG' };
    f.provider.listCountries = async () => [{ code: 'HT', name: 'Haiti' }];
    f.provider.listOperators = async () => [htOperator];
    f.provider.getOperator = async () => htOperator;
    f.provider.detectOperator = async () => htOperator;
    const identities = new FlupFlapIdentityRepository();
    const repository = new MemoryMobileTopUpRepository();
    let now = new Date();
    const app = createApp({
      flupFlapConfig: { enabled: true, accessSecret: 'test-flupflap-only-secret-at-least-32-characters' },
      flupFlapRepository: identities,
      mobileTopUpConfig: { ...config, paymentMode: 'stripe_sandbox' },
      mobileTopUpProvider: f.provider,
      stripeConfig: loadStripeConfig({ ...stripeEnv, MOBILE_TOPUP_PAYMENT_MODE: 'stripe_sandbox' }),
      mobileTopUpStripeProvider: f.stripeProvider,
      mobileTopUpRepository: repository,
      mobileTopUpClock: () => now,
    });
    const root = '/api/flupflap/mobile-topups';
    const quote = async (token: string) => (await request(app).post(root + '/quotes').auth(token, { type: 'bearer' })
      .send({ countryCode: 'HT', phone: '+50937050210', operatorId: 77, productId: 'reloadly:HT:77:airtime:5.00' }).expect(201)).body.quote;
    const session = (token: string, body: Record<string, unknown>, key = 'flupflap-guest-billing') => request(app)
      .post(root + '/payment-sessions').auth(token, { type: 'bearer' }).set('Idempotency-Key', key).send(body);
    const guest = async () => (await request(app).post('/api/flupflap/auth/guest').send({}).expect(201)).body;
    return { ...f, app, identities, repository, quote, session, guest,
      expireQuote: () => { now = new Date(now.getTime() + 600_000); } };
  }

  it.each(['expired', 'declined', 'paid'] as const)('FlupFlap refresh/resume reconcile %s without external mutations', async outcome => {
    const f = flupFlapStripeFixture();
    const guest = await f.guest();
    const quote = await f.quote(guest.accessToken);
    const session = await f.session(guest.accessToken, { quoteId: quote.id, billingCountry: 'US' }).expect(201);
    const payload = new URLSearchParams(transportRequest(f.transport).body);
    const token = new URL(payload.get('success_url')!).searchParams.get('checkoutResumeToken')!;
    const state = vi.spyOn(f.stripeProvider!, 'getHostedCheckoutPaymentState').mockResolvedValue({
      id: session.body.checkoutSession.id,
      status: outcome === 'expired' ? 'expired' : outcome === 'paid' ? 'complete' : 'open',
      paymentStatus: outcome === 'paid' ? 'paid' : 'unpaid',
      paymentIntentId: outcome === 'expired' ? undefined : 'pi_recovery_bound',
    });
    vi.spyOn(f.stripeProvider!, 'getPayment').mockResolvedValue({
      id: 'pi_recovery_bound', amount: 624, amount_received: outcome === 'paid' ? 624 : 0,
      currency: 'usd', status: outcome === 'paid' ? 'succeeded' : 'requires_payment_method',
      metadata: { transactionId: session.body.transactionId }, last_payment_error: { decline_code: 'insufficient_funds' },
    });
    const read = await request(f.app).get(`/api/flupflap/mobile-topups/transactions/${session.body.transactionId}?refresh=true`)
      .auth(guest.accessToken, { type: 'bearer' }).expect(200);
    const resumed = await request(f.app).post('/api/flupflap/mobile-topups/checkout-resume').send({ resumeToken: token }).expect(200);
    const expected = outcome === 'paid' ? { status: 'PENDING', paymentStatus: 'SESSION_CREATED' } : { status: 'FAILED', paymentStatus: 'FAILED' };
    expect(read.body.transaction).toMatchObject(expected);
    expect(resumed.body.transaction).toMatchObject(expected);
    expect(state).toHaveBeenCalledWith(session.body.checkoutSession.id);
    expect(f.transport).toHaveBeenCalledTimes(1); // only original session POST; reads stubbed above
    expect(f.submit).not.toHaveBeenCalled();
    expect(JSON.stringify(resumed.body)).not.toContain(token);
    expect(resumed.body.transaction).not.toHaveProperty('id');
    expect(resumed.body.transaction).not.toHaveProperty('paymentSessionId');
  });

  it.each(['CAPTURED', 'AUTHORIZED'] as const)('FlupFlap status/resume leaves %s recovery to server workers without capture/void/refund', async paymentStatus => {
    const f = flupFlapStripeFixture();
    const guest = await f.guest();
    const quote = await f.quote(guest.accessToken);
    const session = await f.session(guest.accessToken, { quoteId: quote.id, billingCountry: 'US' }).expect(201);
    const payload = new URLSearchParams(transportRequest(f.transport).body);
    const token = new URL(payload.get('success_url')!).searchParams.get('checkoutResumeToken')!;
    await f.repository.updateTransaction(session.body.transactionId, {
      status: 'PROCESSING', paymentStatus, paymentProviderTransactionId: 'pi_recovery_bound',
      providerTransactionId: 'provider-failure',
    });
    vi.spyOn(f.provider, 'getTopUpStatus').mockResolvedValue({ transactionId: 'provider-failure', status: 'FAILED' });
    vi.spyOn(f.stripeProvider!, 'getPayment').mockResolvedValue({
      id: 'pi_recovery_bound', amount: 624, currency: 'usd',
      status: paymentStatus === 'CAPTURED' ? 'succeeded' : 'requires_capture',
      amount_received: paymentStatus === 'CAPTURED' ? 624 : 0,
      amount_capturable: paymentStatus === 'AUTHORIZED' ? 624 : 0,
    });
    vi.spyOn(f.stripeProvider!, 'getRecoveryStatus').mockResolvedValue('PENDING');
    const capture = vi.spyOn(f.stripeProvider!, 'capture');
    const refund = vi.spyOn(f.stripeProvider!, 'refund');
    const voidPayment = vi.spyOn(f.stripeProvider!, 'void');
    const read = await request(f.app).get(`/api/flupflap/mobile-topups/transactions/${session.body.transactionId}?refresh=true`)
      .auth(guest.accessToken, { type: 'bearer' }).expect(200);
    const resumed = await request(f.app).post('/api/flupflap/mobile-topups/checkout-resume').send({ resumeToken: token }).expect(200);
    const expected = { status: 'FAILED', paymentStatus: paymentStatus === 'CAPTURED' ? 'REFUND_PENDING' : 'VOID_PENDING' };
    expect(read.body.transaction).toMatchObject(expected);
    expect(resumed.body.transaction).toMatchObject(expected);
    expect(capture).not.toHaveBeenCalled();
    expect(refund).not.toHaveBeenCalled();
    expect(voidPayment).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.transport).toHaveBeenCalledTimes(1);
  });

  it('FlupFlap cancellation confirms session expiration and fails closed when Stripe cannot confirm', async () => {
    const f = flupFlapStripeFixture();
    const guest = await f.guest();
    const quote = await f.quote(guest.accessToken);
    const session = await f.session(guest.accessToken, { quoteId: quote.id, billingCountry: 'US' }).expect(201);
    const expire = vi.spyOn(f.stripeProvider!, 'expireHostedCheckoutSession').mockRejectedValueOnce(new Error('unknown'));
    const path = `/api/flupflap/mobile-topups/transactions/${session.body.transactionId}/cancel`;
    const blocked = await request(f.app).post(path).auth(guest.accessToken, { type: 'bearer' }).expect(409);
    expect(blocked.body.code).toBe('TOPUP_CANCELLATION_UNRESOLVED');
    expect((await f.repository.getTransactionById(session.body.transactionId))?.paymentStatus).toBe('SESSION_CREATED');
    expire.mockResolvedValueOnce(undefined);
    const cancelled = await request(f.app).post(path).auth(guest.accessToken, { type: 'bearer' }).expect(200);
    expect(cancelled.body.transaction).toMatchObject({ status: 'FAILED', paymentStatus: 'FAILED', failureCode: 'CANCELLED_BY_CUSTOMER' });
    expect(expire).toHaveBeenCalledWith(session.body.checkoutSession.id, session.body.transactionId);
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('uses the Android-only HTTPS handoff without leaking capabilities or fulfilling a recharge', async () => {
    const f = flupFlapStripeFixture();
    const guest = await f.guest();
    const quote = await f.quote(guest.accessToken);
    const body = { quoteId: quote.id, billingCountry: 'US', returnTarget: 'FLUPFLAP_ANDROID' };
    const session = await f.session(guest.accessToken, body, 'android-checkout-test').expect(201);
    const payload = new URLSearchParams(transportRequest(f.transport).body);
    const success = new URL(payload.get('success_url')!);
    expect(success.origin + success.pathname).toBe('https://ticash-api.onrender.com/api/flupflap/mobile-topups/checkout-return');
    expect(payload.get('cancel_url')).toBe(success.toString());
    const token = success.searchParams.get('checkoutResumeToken')!;
    expect(session.text).not.toContain(token);
    expect(session.body.amountMinor).toBe(624);
    const handoff = await request(f.app).get(success.pathname).query({ checkoutResumeToken: token }).expect(200);
    expect(handoff.headers['cache-control']).toBe('no-store');
    expect(handoff.headers['referrer-policy']).toBe('no-referrer');
    expect(handoff.headers['content-security-policy']).toContain("default-src 'none'");
    expect(handoff.text).toContain('package=com.ticash.flupflap;end');
    expect(handoff.text).toContain('https://www.flupflap.com/?checkoutResumeToken=');
    expect(handoff.text).toContain('window.location.assign(openApp.href)');
    expect(handoff.text).not.toMatch(/<script[^>]+src=/);
    const resumed = await request(f.app).post('/api/flupflap/mobile-topups/checkout-resume').send({ resumeToken: token }).expect(200);
    expect(resumed.body.transaction.paymentStatus).toBe('SESSION_CREATED');
    expect(f.submit).not.toHaveBeenCalled();
    await request(f.app).get(success.pathname).query({ checkoutResumeToken: '<script>bad</script>' }).expect(400);
    await f.session(guest.accessToken, { ...body, returnTarget: 'https://attacker.invalid' }, 'android-invalid-target').expect(400);
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('rejects Android handoff for TiCash identities even when calling the service directly', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    await expect(f.service.createPaymentSession('customer', { quoteId: quote.id }, 'ticash-no-android', 'US', true))
      .rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it.each(['US', 'us'])('creates a guest HT recharge / %s billing session without changing the guest profile', async billingCountry => {
    const f = flupFlapStripeFixture();
    const guest = await f.guest();
    const before = await f.identities.customer(guest.user.id);
    expect(before?.countryCode).toBeNull();
    const quote = await f.quote(guest.accessToken);
    expect(quote).toMatchObject({ countryCode: 'HT', providerAmount: 5, feeUsd: 1.24, totalChargeUsd: 6.24 });
    const response = await f.session(guest.accessToken, { quoteId: quote.id, billingCountry }).expect(201);
    expect(response.body).toMatchObject({ provider: 'STRIPE', environment: 'SANDBOX', testMode: true, amountMinor: 624, currency: 'USD' });
    const payload = new URLSearchParams(transportRequest(f.transport).body);
    const resumeToken = new URL(payload.get('success_url')!).searchParams.get('checkoutResumeToken')!;
    expect(response.body).not.toHaveProperty('checkoutResumeToken');
    expect(response.text).not.toContain(resumeToken);
    expect(payload.get('metadata[billingCountry]')).toBe('US');
    expect(payload.get('line_items[0][price_data][unit_amount]')).toBe('624');
    expect(payload.get('line_items[0][price_data][currency]')).toBe('usd');
    expect(await f.identities.customer(guest.user.id)).toEqual(before);
    const profile = await request(f.app).get('/api/flupflap/auth/me').auth(guest.accessToken, { type: 'bearer' }).expect(200);
    expect(profile.body.user).toMatchObject({ guest: true, countryCode: null });
    await request(f.app).patch('/api/flupflap/auth/me').auth(guest.accessToken, { type: 'bearer' })
      .send({ countryCode: 'US' }).expect(403);
    expect(f.transport).toHaveBeenCalledTimes(1);
    expect(f.submit).not.toHaveBeenCalled();
    // A later session still requires its own explicit country, not the prior session's value or destination.
    const nextQuote = await f.quote(guest.accessToken);
    const missing = await f.session(guest.accessToken, { quoteId: nextQuote.id }, 'next-guest-session').expect(409);
    expect(missing.body.code).toBe('BILLING_COUNTRY_REQUIRED');
    expect(f.transport).toHaveBeenCalledTimes(1);
  });

  it.each(['', 'U', 'USA', '1!', ' US ', 'ÜS', null, 123, { country: 'US' }])('rejects malformed guest billingCountry %j at the API boundary', async billingCountry => {
    const f = flupFlapStripeFixture();
    const guest = await f.guest();
    const quote = await f.quote(guest.accessToken);
    await f.session(guest.accessToken, { quoteId: quote.id, billingCountry }).expect(400);
    expect(await f.repository.listTransactions(flupFlapOwner(guest.user.id))).toHaveLength(0);
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('preserves permanent customers stored country and rejects browser overrides', async () => {
    const f = flupFlapStripeFixture();
    const customer = (await request(f.app).post('/api/flupflap/auth/register')
      .send({ firstName:'Stripe', lastName:'Profile', phone:'+15550001001', email: 'stripe-profile@example.test', password: 'correct-horse-42', countryCode: 'US' }).expect(201)).body;
    const before = await f.identities.customer(customer.user.id);
    const quote = await f.quote(customer.accessToken);
    for (const billingCountry of ['CA', 'US']) {
      await f.session(customer.accessToken, { quoteId: quote.id, billingCountry }).expect(400);
    }
    expect(f.transport).not.toHaveBeenCalled();
    const response = await f.session(customer.accessToken, { quoteId: quote.id }).expect(201);
    expect(response.body).toMatchObject({ provider: 'STRIPE', amountMinor: 624 });
    expect(new URLSearchParams(transportRequest(f.transport).body).get('metadata[billingCountry]')).toBe('US');
    expect(await f.identities.customer(customer.user.id)).toEqual(before);
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('does not let a permanent customer without a stored country substitute a request country', async () => {
    const f = flupFlapStripeFixture();
    const customer = (await request(f.app).post('/api/flupflap/auth/register')
      .send({ firstName:'Stripe', lastName:'NoCountry', phone:'+15550001002', email: 'stripe-no-country@example.test', password: 'correct-horse-42' }).expect(201)).body;
    const quote = await f.quote(customer.accessToken);
    await f.session(customer.accessToken, { quoteId: quote.id, billingCountry: 'US' }).expect(400);
    const response = await f.session(customer.accessToken, { quoteId: quote.id }).expect(409);
    expect(response.body.code).toBe('BILLING_COUNTRY_REQUIRED');
    expect(f.transport).not.toHaveBeenCalled();
  });

  it.each(['expired', 'consumed'])('rejects %s guest quotes even with valid explicit billing country', async state => {
    const f = flupFlapStripeFixture();
    const guest = await f.guest();
    const quote = await f.quote(guest.accessToken);
    if (state === 'expired') f.expireQuote();
    else await f.repository.markQuoteConsumed(flupFlapOwner(guest.user.id), quote.id, new Date().toISOString());
    const response = await f.session(guest.accessToken, { quoteId: quote.id, billingCountry: 'US' }).expect(409);
    expect(response.body.code).toBe(state === 'expired' ? 'TOPUP_QUOTE_EXPIRED' : 'TOPUP_QUOTE_ALREADY_USED');
    expect(f.transport).not.toHaveBeenCalled();
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('rejects browser price, fee, total, currency and provider overrides in guest sessions', async () => {
    const f = flupFlapStripeFixture();
    const guest = await f.guest();
    const quote = await f.quote(guest.accessToken);
    for (const [field, value] of Object.entries({ amount: 1, fee: 0, feeUsd: 0, total: 1, totalChargeUsd: 1,
      amountMinor: 1, currency: 'EUR', provider: 'MOCK', productId: 'fabricated', providerAmount: 1, paymentStatus: 'CAPTURED' })) {
      await f.session(guest.accessToken, { quoteId: quote.id, billingCountry: 'US', [field]: value }).expect(400);
    }
    expect(f.transport).not.toHaveBeenCalled();
    expect(await f.repository.listTransactions(flupFlapOwner(guest.user.id))).toHaveLength(0);
    expect((await f.session(guest.accessToken, { quoteId: quote.id, billingCountry: 'US' }).expect(201)).body.amountMinor).toBe(624);
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('creates a hosted Stripe Checkout session with form-encoded Stripe REST parameters and blocks browser tampering', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('customer', quoteInput);

    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-session-001', 'US');
    expect(session).toMatchObject({
      provider: 'STRIPE',
      environment: 'SANDBOX',
      testMode: true,
      paymentStatus: 'SESSION_CREATED',
      amountMinor: 599,
      currency: 'USD',
    });
    expect(session.checkoutSession).toMatchObject({ id: 'cs_test_fixture_123', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture_123' });
    expect(session).not.toHaveProperty('checkoutResumeToken');
    expect(f.submit).not.toHaveBeenCalled();

    expect(f.transport).toHaveBeenCalledTimes(1);
    const request = transportRequest(f.transport);
    expect(request.url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect(request.init.method).toBe('POST');
    expect(request.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(request.headers.Authorization).toBe(`Bearer ${stripeEnv.STRIPE_SECRET_KEY}`);
    expect(request.headers['Idempotency-Key']).toBe(session.transactionId + ':checkout');
    expect(request.body).toContain('mode=payment');
    expect(request.body).toContain('line_items%5B0%5D%5Bquantity%5D=1');
    expect(request.body).toContain('line_items%5B0%5D%5Bprice_data%5D%5Bcurrency%5D=usd');
    expect(request.body).toContain('line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=599');
    expect(new URLSearchParams(request.body).get('client_reference_id')).toBe(session.transactionId);
    expect(new URLSearchParams(request.body).get('metadata[transactionId]')).toBe(session.transactionId);
    expect(new URLSearchParams(request.body).get('payment_intent_data[metadata][transactionId]')).toBe(session.transactionId);
    expect(new URLSearchParams(request.body).get('payment_intent_data[metadata][billingCountry]')).toBe('US');
    expect(request.body).toContain('metadata%5BbillingCountry%5D=US');
    const params = new URLSearchParams(request.body);
    const resumeToken = new URL(params.get('success_url')!).searchParams.get('checkoutResumeToken')!;
    expect(resumeToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(new URL(params.get('cancel_url')!).searchParams.get('checkoutResumeToken')).toBe(resumeToken);
    expect([...params].filter(([, value]) => value.includes(resumeToken)).map(([key]) => key).sort()).toEqual(['cancel_url', 'success_url']);
    expect(JSON.stringify(session)).not.toContain(resumeToken);
    expect(request.body).not.toContain('return_url');
    expect(request.body).not.toContain(encodeURIComponent(stripeEnv.STRIPE_SECRET_KEY));
    expect(request.body).not.toContain(encodeURIComponent(stripeEnv.STRIPE_WEBHOOK_SECRET));
    expect(JSON.stringify(session)).not.toContain(stripeEnv.STRIPE_SECRET_KEY);
    expect(JSON.stringify(session)).not.toContain(stripeEnv.STRIPE_WEBHOOK_SECRET);
    expect(JSON.stringify(session)).not.toContain(`Bearer ${stripeEnv.STRIPE_SECRET_KEY}`);
    const stored = await f.repository.listTransactions('customer');
    expect(stored).toHaveLength(1);
    expect(stored[0]?.checkoutResumeTokenHash).toBe(createHash('sha256').update(resumeToken).digest('hex'));
    expect(stored[0]?.checkoutResumeTokenExpiresAt).toEqual(expect.any(String));
    expect(JSON.stringify(stored)).not.toContain(resumeToken);
  });

  it.each([
    { label: 'null client_secret', response: { id: 'cs_test_fixture_123', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture_123', client_secret: null } },
    { label: 'absent client_secret', response: { id: 'cs_test_fixture_123', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture_123' } },
  ])('accepts hosted Stripe Checkout when %s', async ({ response }) => {
    const transport = vi.fn(async () => stripeResponse(response));
    const provider = new StripeSandboxPaymentProvider(loadStripeConfig(stripeEnv), transport);

    const session = await provider.createPaymentSession({
      transactionId: 'tx-null-client-secret',
      amountMinor: 599,
      currency: 'USD',
      billingCountry: 'US',
      resumeToken: 'A'.repeat(43),
    });

    expect(session).toMatchObject({ id: 'cs_test_fixture_123', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture_123' });
    expect(session).not.toHaveProperty('client_secret');
    expect(JSON.stringify(session)).not.toContain('client_secret');
  });

  it.each([
    { label: 'string', client_secret: 'cs_test_secret_value' },
    { label: 'empty string', client_secret: '' },
    { label: 'object', client_secret: {} },
    { label: 'number', client_secret: 123 },
  ])('rejects hosted Stripe Checkout when client_secret is a non-null %s', async ({ client_secret }) => {
    const transport = vi.fn(async () => stripeResponse({
      id: 'cs_test_fixture_123',
      url: 'https://checkout.stripe.com/c/pay/cs_test_fixture_123',
      client_secret,
    }));
    const provider = new StripeSandboxPaymentProvider(loadStripeConfig(stripeEnv), transport);

    await expect(provider.createPaymentSession({
      transactionId: 'tx-reject-client-secret',
      amountMinor: 599,
      currency: 'USD',
      billingCountry: 'US',
      resumeToken: 'A'.repeat(43),
    })).rejects.toMatchObject({ code: 'INVALID_PAYMENT_SESSION', statusCode: 502 });
    expect(JSON.stringify(transport.mock.calls)).not.toContain('cs_test_secret_value');
  });

  it('isolates failed A and paid B capabilities, duplicate webhooks and delayed failures', async () => {
    let sessions = 0;
    const f = stripeFixture(vi.fn(async () => {
      sessions += 1;
      return stripeResponse({ id: `cs_test_attempt_${sessions}`, url: `https://checkout.stripe.com/c/pay/cs_test_attempt_${sessions}` });
    }));
    f.submit.mockResolvedValue({ transactionId: 'provider-B', status: 'SUCCESSFUL', requestedAmount: 5,
      requestedAmountCurrencyCode: 'USD', deliveredAmount: 805, deliveredAmountCurrencyCode: 'JMD' } as never);
    async function attempt(key: string) {
      const quote = await f.service.createQuote('customer', quoteInput);
      const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, key, 'US');
      const params = new URLSearchParams(transportRequest(f.transport, sessions - 1).body);
      const token = new URL(params.get('success_url')!).searchParams.get('checkoutResumeToken')!;
      return { session, token };
    }
    function event(attempt: Awaited<ReturnType<typeof attempt>>, paid: boolean, eventId: string) {
      const raw = Buffer.from(JSON.stringify({ id: eventId, livemode: false,
        type: paid ? 'checkout.session.completed' : 'payment_intent.payment_failed',
        data: { object: { id: paid ? attempt.session.checkoutSession.id : 'pi_attempt_A',
          amount: attempt.session.amountMinor, amount_received: 0, amount_total: attempt.session.amountMinor,
          currency: 'usd', ...(paid ? { payment_intent: 'pi_attempt_B', payment_status: 'paid' } :
            { last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds', message: 'private Stripe details' } }),
          metadata: { transactionId: attempt.session.transactionId } } } }));
      const timestamp = Math.floor(Date.now() / 1000);
      return verifyStripeEvent(raw, `t=${timestamp},v1=${createHmac('sha256', stripeEnv.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${raw.toString('utf8')}`).digest('hex')}`, stripeEnv.STRIPE_WEBHOOK_SECRET);
    }
    const a = await attempt('attempt-A');
    const failed = event(a, false, 'evt_attempt_A_failed');
    await f.service.acceptVerifiedPaymentEvent(failed);
    await f.service.acceptVerifiedPaymentEvent(failed);
    expect(f.submit).not.toHaveBeenCalled();
    expect(await f.service.resumeCheckout(a.token)).toMatchObject({ status: 'FAILED', paymentStatus: 'FAILED', failureReason: 'INSUFFICIENT_FUNDS', deliveredValue: null });
    const b = await attempt('attempt-B');
    expect(b.session.transactionId).not.toBe(a.session.transactionId);
    expect(b.token).not.toBe(a.token);
    const paid = event(b, true, 'evt_attempt_B_paid');
    await f.service.acceptVerifiedPaymentEvent(paid);
    const delivered = await f.repository.getTransactionById(b.session.transactionId);
    expect(delivered).toMatchObject({ status: 'DELIVERED', paymentStatus: 'CAPTURED' });
    await f.service.acceptVerifiedPaymentEvent(paid);
    await f.service.acceptVerifiedPaymentEvent(event(b, true, 'evt_attempt_B_paid_duplicate'));
    await f.service.acceptVerifiedPaymentEvent(event(a, false, 'evt_attempt_A_delayed_failed'));
    expect(await f.repository.getTransactionById(b.session.transactionId)).toEqual(delivered);
    expect(f.submit).toHaveBeenCalledTimes(1);
    const beforeResume = f.transport.mock.calls.length;
    expect(await f.service.resumeCheckout(b.token)).toMatchObject({ status: 'DELIVERED', paymentStatus: 'CAPTURED', failureReason: null, deliveredValue: 805 });
    expect(await f.service.resumeCheckout(a.token)).toMatchObject({ status: 'FAILED', failureReason: 'INSUFFICIENT_FUNDS', deliveredValue: null });
    expect(f.transport).toHaveBeenCalledTimes(beforeResume + 1);
    expect(transportRequest(f.transport, beforeResume).init.method).toBe('GET');
    expect(f.submit).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(await f.service.resumeCheckout(b.token))).not.toMatch(/pi_attempt|cs_test|private Stripe|checkoutResumeToken|transactionId/);
  });

  it('resume rejects a mismatched capability lookup or missing hosted binding without provider requests', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'resume-binding-check', 'US');
    const params = new URLSearchParams(transportRequest(f.transport).body);
    const token = new URL(params.get('success_url')!).searchParams.get('checkoutResumeToken')!;
    const stored = (await f.repository.getTransactionById(session.transactionId))!;
    const lookup = vi.spyOn(f.repository, 'getTransactionByCheckoutResumeTokenHash');
    for (const invalid of [{ ...stored, checkoutResumeTokenHash: 'f'.repeat(64) }, { ...stored, paymentSessionId: undefined },
      { ...stored, paymentProviderTransactionId: 'cs_not_a_payment_intent' }]) {
      lookup.mockResolvedValueOnce(invalid);
      await expect(f.service.resumeCheckout(token)).rejects.toMatchObject({ code: 'RESUME_TOKEN_NOT_FOUND' });
    }
    lookup.mockResolvedValueOnce({ ...stored, checkoutResumeTokenExpiresAt: 'invalid' });
    await expect(f.service.resumeCheckout(token)).rejects.toMatchObject({ code: 'RESUME_TOKEN_EXPIRED' });
    expect(f.transport).toHaveBeenCalledTimes(1); expect(f.submit).not.toHaveBeenCalled();
  });

  it('returns a generic customer-safe provider failure after a refunded recharge', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'provider-failure-resume', 'US');
    const params = new URLSearchParams(transportRequest(f.transport).body);
    const resumeToken = new URL(params.get('success_url')!).searchParams.get('checkoutResumeToken')!;
    await f.repository.updateTransaction(session.transactionId, {
      status: 'FAILED',
      paymentStatus: 'REFUNDED',
      providerStatus: 'FAILED',
      failureCode: 'PROVIDER_RECIPIENT_NOT_FOUND',
      failedAt: new Date().toISOString(),
    });

    expect(await f.service.resumeCheckout(resumeToken)).toMatchObject({
      status: 'FAILED',
      paymentStatus: 'REFUNDED',
      failureReason: 'RECHARGE_PROVIDER_FAILED',
      deliveredValue: null,
    });
    expect(JSON.stringify(await f.service.resumeCheckout(resumeToken))).not.toContain('RECIPIENT_NOT_FOUND');
  });

  it('resolves checkout resumes without granting payment authority', async () => {
    const f = stripeFixture();
    const app = createApp({
      mobileTopUpConfig: { ...config, paymentMode: 'stripe_sandbox' },
      mobileTopUpProvider: f.provider,
      stripeConfig: loadStripeConfig({ ...stripeEnv, MOBILE_TOPUP_PAYMENT_MODE: 'stripe_sandbox' }),
      mobileTopUpRepository: f.repository,
      mobileTopUpStripeProvider: f.stripeProvider,
    });
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-resume-001', 'US');
    const params = new URLSearchParams(transportRequest(f.transport).body);
    const resumeToken = new URL(params.get('success_url')!).searchParams.get('checkoutResumeToken')!;
    const response = await request(app)
      .post('/api/mobile-topups/checkout-resume')
      .send({ resumeToken })
      .expect(200);

    expect(response.body).toEqual({ transaction: {
      countryCode: 'JM', receiverQuote: quote.receiverQuote, deliveredValue: null, deliveredCurrency: null, receiverDiscrepancy: false,
      status: 'PENDING', paymentStatus: 'SESSION_CREATED', failureReason: null, testMode: true, recipientPhone: quote.recipientPhone,
      operatorName: quote.operatorName, productName: quote.productName,
      providerAmount: 5, providerCurrency: 'USD', feeUsd: 0.99, totalChargeUsd: 5.99,
    } });
    await request(app).post('/api/mobile-topups/checkout-resume').send({ resumeToken: 'bogus' }).expect(400);
    await request(app).post('/api/flupflap/mobile-topups/checkout-resume')
      .send({ resumeToken, paymentStatus: 'AUTHORIZED' }).expect(400);
    const resumed = await request(app).post('/api/flupflap/mobile-topups/checkout-resume')
      .send({ resumeToken }).expect(200);
    expect(resumed.body).toEqual(response.body);
    expect((await f.repository.getTransactionById(session.transactionId))?.paymentStatus).toBe('SESSION_CREATED');
    expect(f.transport).toHaveBeenCalledTimes(3); // Creation plus two read-only session queries.
    expect(f.transport.mock.calls.slice(1).every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(f.submit).not.toHaveBeenCalled();

    const expiredService = new MobileTopUpService(
      { ...config, paymentMode: 'stripe_sandbox' },
      f.provider,
      new MockMobileTopUpPaymentProvider(),
      f.repository,
      vi.fn(async () => {}),
      () => new Date(Date.now() + 3_600_000),
      f.stripeProvider,
    );
    await expect(expiredService.resumeCheckout(resumeToken)).rejects.toMatchObject({ code: 'RESUME_TOKEN_EXPIRED' });
  });

  it('keeps checkout resume valid after quote expiry when dedicated resume TTL is longer', async () => {
    let now = new Date('2026-09-28T12:00:00.000Z');
    const f = stripeFixture(undefined, {
      clock: () => now,
      configOverride: { quoteTtlSeconds: 30, checkoutResumeTtlSeconds: 3600 },
    });

    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-resume-after-quote-expiry', 'US');
    const params = new URLSearchParams(transportRequest(f.transport).body);
    const resumeToken = new URL(params.get('success_url')!).searchParams.get('checkoutResumeToken')!;

    now = new Date(now.getTime() + 31_000); // Quote TTL (30s) is expired.
    const resumed = await f.service.resumeCheckout(resumeToken);
    expect(resumed).toMatchObject({
      status: 'PENDING',
      testMode: true,
      recipientPhone: quote.recipientPhone,
      operatorName: quote.operatorName,
      productName: quote.productName,
      providerAmount: 5,
      providerCurrency: 'USD',
      feeUsd: 0.99,
      totalChargeUsd: 5.99,
    });
    expect((await f.repository.getTransactionById(session.transactionId))?.paymentStatus).toBe('SESSION_CREATED');
    expect(f.submit).not.toHaveBeenCalled();
    expect(f.transport).toHaveBeenCalledTimes(2);
    expect(transportRequest(f.transport, 1).init.method).toBe('GET');
  });

  it('expires checkout resume strictly at the dedicated TTL boundary', async () => {
    let now = new Date('2026-09-28T14:00:00.000Z');
    const f = stripeFixture(undefined, {
      clock: () => now,
      configOverride: { quoteTtlSeconds: 300, checkoutResumeTtlSeconds: 120 },
    });

    const quote = await f.service.createQuote('customer', quoteInput);
    await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-resume-boundary', 'US');
    const params = new URLSearchParams(transportRequest(f.transport).body);
    const resumeToken = new URL(params.get('success_url')!).searchParams.get('checkoutResumeToken')!;

    now = new Date(now.getTime() + 119_999);
    await expect(f.service.resumeCheckout(resumeToken)).resolves.toMatchObject({ testMode: true, status: 'PENDING' });

    now = new Date(now.getTime() + 1);
    await expect(f.service.resumeCheckout(resumeToken)).rejects.toMatchObject({ code: 'RESUME_TOKEN_EXPIRED' });
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('serializes only the customer-safe resume DTO, including when internal recovery fields are populated', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'resume-safe-dto', 'US');
    const params = new URLSearchParams(transportRequest(f.transport).body);
    const resumeToken = new URL(params.get('success_url')!).searchParams.get('checkoutResumeToken')!;
    await f.repository.updateTransaction(session.transactionId, {
      paymentProviderTransactionId: 'pi_internal', providerTransactionId: 'provider-internal',
      paymentRecoveryCode: 'internal-recovery', recoveryStartedAt: new Date().toISOString(),
      failureCode: 'internal-failure', providerStatus: 'internal-status',
    });
    const app = createApp({ mobileTopUpConfig: { ...config, paymentMode: 'stripe_sandbox' },
      mobileTopUpProvider: f.provider,
      stripeConfig: loadStripeConfig({ ...stripeEnv, MOBILE_TOPUP_PAYMENT_MODE: 'stripe_sandbox' }),
      mobileTopUpRepository: f.repository,
      mobileTopUpStripeProvider: f.stripeProvider });
    const record = (await f.repository.getTransactionById(session.transactionId))!;
    const allowed = ['paymentStatus', 'failureReason', 'countryCode', 'receiverQuote', 'deliveredValue', 'deliveredCurrency', 'receiverDiscrepancy', 'status', 'testMode', 'recipientPhone', 'operatorName', 'productName', 'providerAmount', 'providerCurrency', 'feeUsd', 'totalChargeUsd'];
    for (const path of ['/api/mobile-topups/checkout-resume', '/api/flupflap/mobile-topups/checkout-resume']) {
      const response = await request(app).post(path).send({ resumeToken }).expect(200);
      expect(Object.keys(response.body.transaction).sort()).toEqual([...allowed].sort());
      for (const key of Object.keys(record).filter(key => !allowed.includes(key))) {
        expect(response.body.transaction).not.toHaveProperty(key);
      }
      expect(response.text).not.toMatch(/checkoutResumeToken|idempotency|requestHash|paymentSessionId|paymentProvider|recovery|providerStatus|failureCode|createdAt|updatedAt|quoteId|userId|recipientId/);
      for (const secret of [resumeToken, record.checkoutResumeTokenHash!, session.transactionId, session.checkoutSession.id, 'pi_internal', 'provider-internal']) {
        expect(response.text).not.toContain(secret);
      }
    }
    expect(f.transport).toHaveBeenCalledTimes(5);
    expect(f.transport.mock.calls.slice(1).every(([, init]) => init?.method === 'GET')).toBe(true);
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('replays the same usable hosted session across service instances without creating a duplicate or returning the capability', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    const first = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-replay-key', 'US');
    const storedBefore = await f.repository.getTransactionById(first.transactionId);
    const secondService = new MobileTopUpService({ ...config, paymentMode: 'stripe_sandbox' }, f.provider,
      new MockMobileTopUpPaymentProvider(), f.repository, vi.fn(async () => {}), undefined, f.stripeProvider);
    const replays = await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? secondService : f.service)
      .createPaymentSession('customer', { quoteId: quote.id }, 'stripe-replay-key', 'US')));
    for (const replay of replays) {
      expect(replay).toEqual(first);
      expect(replay).not.toHaveProperty('checkoutResumeToken');
    }
    const requests = f.transport.mock.calls.map((_, i) => transportRequest(f.transport, i));
    expect(requests.filter(r => r.init.method === 'POST')).toHaveLength(1);
    expect(requests.filter(r => r.init.method === 'GET')).toHaveLength(6);
    expect(requests.slice(1).every(r => r.url.endsWith('/v1/checkout/sessions/' + first.checkoutSession.id))).toBe(true);
    expect(await f.repository.getTransactionById(first.transactionId)).toEqual(storedBefore);
    expect(await f.repository.listTransactions('customer')).toHaveLength(1);
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('concurrent first-time retries create exactly one Stripe Checkout Session', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () =>
      f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-concurrent-key', 'US')));
    const fulfilled = results.filter(r => r.status === 'fulfilled');
    expect(fulfilled.length).toBeGreaterThan(0);
    for (const result of results) {
      if (result.status === 'rejected') expect(result.reason).toMatchObject({ code: 'PAYMENT_SESSION_IN_PROGRESS' });
      else expect(result.value).not.toHaveProperty('checkoutResumeToken');
    }
    const replay = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-concurrent-key', 'US');
    expect(replay.checkoutSession.id).toBe('cs_test_fixture_123');
    expect(f.transport.mock.calls.filter((_, i) => transportRequest(f.transport, i).init.method === 'POST')).toHaveLength(1);
    expect(await f.repository.listTransactions('customer')).toHaveLength(1);
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('rejects a replay response for a different Stripe session without creating a replacement', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-replay-mismatch', 'US');
    f.transport.mockImplementationOnce(async () => stripeResponse({ id: 'cs_test_wrong', url: 'https://checkout.stripe.com/c/pay/cs_test_wrong' }));
    await expect(f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-replay-mismatch', 'US'))
      .rejects.toMatchObject({ code: 'INVALID_PAYMENT_SESSION' });
    expect(f.transport).toHaveBeenCalledTimes(2);
    expect(transportRequest(f.transport, 1).init.method).toBe('GET');
    expect(f.submit).not.toHaveBeenCalled();
  });

  it('form-encodes capture, cancel and refund Stripe requests with header-only authorization', async () => {
    const transport = vi
      .fn(async () => stripeResponse({ id: 'cs_test_fixture_123', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture_123' }))
      .mockImplementationOnce(async () => stripeResponse({ id: 'cs_test_fixture_123', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture_123' }))
      .mockImplementationOnce(async () => stripeResponse({ id: 'pi_fixture_123', status: 'requires_capture' }))
      .mockImplementationOnce(async () => stripeResponse({ id: 'pi_fixture_123', status: 'canceled' }))
      .mockImplementationOnce(async () => stripeResponse({ id: 're_fixture_123', status: 'pending', payment_intent: 'pi_fixture_123', amount: 599 }));
    const provider = new StripeSandboxPaymentProvider(loadStripeConfig(stripeEnv), transport);

    await provider.createPaymentSession({ transactionId: 'tx-capture-1', amountMinor: 599, currency: 'USD', billingCountry: 'US', resumeToken: 'A'.repeat(43) });
    await provider.capture({ paymentId: 'pi_fixture_123', transactionId: 'tx-capture-1', amountMinor: 599 });
    await provider.void({ paymentId: 'pi_fixture_123', transactionId: 'tx-capture-1' });
    await provider.refund({ paymentId: 'pi_fixture_123', transactionId: 'tx-refund-1', amountMinor: 599 });

    const capture = transportRequest(transport, 1);
    expect(capture.url).toBe('https://api.stripe.com/v1/payment_intents/pi_fixture_123/capture');
    expect(capture.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(capture.headers.Authorization).toBe(`Bearer ${stripeEnv.STRIPE_SECRET_KEY}`);
    expect(capture.body).toBe('amount_to_capture=599');
    expect(capture.body).not.toContain('{');

    const cancel = transportRequest(transport, 2);
    expect(cancel.url).toBe('https://api.stripe.com/v1/payment_intents/pi_fixture_123/cancel');
    expect(cancel.headers.Authorization).toBe(`Bearer ${stripeEnv.STRIPE_SECRET_KEY}`);
    expect(cancel.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(cancel.body).toBe('');

    const refund = transportRequest(transport, 3);
    expect(refund.url).toBe('https://api.stripe.com/v1/refunds');
    expect(refund.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(refund.headers.Authorization).toBe(`Bearer ${stripeEnv.STRIPE_SECRET_KEY}`);
    expect(refund.body).toContain('payment_intent=pi_fixture_123');
    expect(refund.body).toContain('amount=599');
    expect(refund.body).toContain('metadata%5BtransactionId%5D=tx-refund-1');
    expect(refund.body).not.toContain('{');
  });

  it('repairs legacy VOID_PENDING to refund when Stripe already captured the payment', async () => {
    let now = new Date();
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(stripeResponse({ id: 'cs_test_fixture_123', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture_123' }))
      .mockResolvedValueOnce(stripeResponse({
        id: 'pi_captured_legacy', status: 'succeeded', amount: 599, amount_received: 599,
        amount_capturable: 0, currency: 'usd',
      }))
      .mockResolvedValueOnce(stripeResponse({
        id: 're_captured_legacy', status: 'pending', amount: 599,
        payment_intent: 'pi_captured_legacy', metadata: { transactionId: 'placeholder' },
      }));
    const f = stripeFixture(transport, { clock: () => now });
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'legacy-void-captured', 'US');
    await f.repository.updateTransaction(session.transactionId, {
      status: 'FAILED',
      paymentStatus: 'VOID_PENDING',
      paymentProviderTransactionId: 'pi_captured_legacy',
      paymentRecoveryCode: 'PAYMENT_RECOVERY_REQUIRED',
      failureCode: 'TOPUP_SUBMISSION_UNKNOWN',
    });
    now = new Date(now.getTime() + 20_000);

    const result = await f.service.reconcilePendingTransactions();
    expect(result).toMatchObject({ scanned: 1, pending: 1, errors: 0 });
    expect(await f.repository.getTransactionById(session.transactionId)).toMatchObject({
      status: 'FAILED',
      paymentStatus: 'REFUND_PENDING',
      paymentRecoveryCode: 'PAYMENT_RECOVERY_REQUIRED',
    });
    expect(transportRequest(transport, 1).url).toBe('https://api.stripe.com/v1/payment_intents/pi_captured_legacy');
    expect(transportRequest(transport, 2).url).toBe('https://api.stripe.com/v1/refunds');
    expect(transportRequest(transport, 2).body).toContain('payment_intent=pi_captured_legacy');
    expect(transport.mock.calls.every(([url]) => !String(url).includes('/cancel'))).toBe(true);
  });

  it('keeps VOID_PENDING as a void when Stripe has not captured the authorization', async () => {
    let now = new Date();
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(stripeResponse({ id: 'cs_test_fixture_123', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture_123' }))
      .mockResolvedValueOnce(stripeResponse({
        id: 'pi_uncaptured', status: 'requires_capture', amount: 599, amount_received: 0,
        amount_capturable: 599, currency: 'usd',
      }))
      .mockResolvedValueOnce(stripeResponse({ id: 'pi_uncaptured', status: 'canceled' }));
    const f = stripeFixture(transport, { clock: () => now });
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'legacy-void-uncaptured', 'US');
    await f.repository.updateTransaction(session.transactionId, {
      status: 'FAILED',
      paymentStatus: 'VOID_PENDING',
      paymentProviderTransactionId: 'pi_uncaptured',
      paymentRecoveryCode: 'PAYMENT_RECOVERY_REQUIRED',
    });
    now = new Date(now.getTime() + 20_000);

    await expect(f.service.reconcilePendingTransactions()).resolves.toMatchObject({ scanned: 1, resolved: 1, errors: 0 });
    expect(await f.repository.getTransactionById(session.transactionId)).toMatchObject({
      paymentStatus: 'VOIDED',
      paymentRecoveryCode: 'RECOVERY_CONFIRMED',
    });
    expect(transportRequest(transport, 2).url).toBe('https://api.stripe.com/v1/payment_intents/pi_uncaptured/cancel');
    expect(transport.mock.calls.every(([url]) => !String(url).includes('/v1/refunds'))).toBe(true);
  });

  it('does not guess void versus refund when Stripe status lookup is unresolved', async () => {
    let now = new Date();
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(stripeResponse({ id: 'cs_test_fixture_123', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture_123' }))
      .mockRejectedValueOnce(new Error('network timeout'));
    const f = stripeFixture(transport, { clock: () => now });
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-unknown-recovery-state', 'US');
    await f.repository.updateTransaction(session.transactionId, {
      status: 'FAILED',
      paymentStatus: 'VOID_PENDING',
      paymentProviderTransactionId: 'pi_unknown_state',
      paymentRecoveryCode: 'PAYMENT_RECOVERY_REQUIRED',
    });
    now = new Date(now.getTime() + 20_000);

    await expect(f.service.reconcilePendingTransactions()).resolves.toMatchObject({ scanned: 1, pending: 1 });
    expect((await f.repository.getTransactionById(session.transactionId))?.paymentStatus).toBe('VOID_PENDING');
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each([
    { id: 'pi_wrong', status: 'succeeded', amount: 599, amount_received: 599, currency: 'usd' },
    { id: 'pi_guard', status: 'succeeded', amount: 600, amount_received: 600, currency: 'usd' },
    { id: 'pi_guard', status: 'succeeded', amount: 599, amount_received: 599, currency: 'eur' },
  ])('fails closed on mismatched Stripe recovery evidence %#', async payment => {
    let now = new Date();
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(stripeResponse({ id: 'cs_test_fixture_123', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture_123' }))
      .mockResolvedValueOnce(stripeResponse(payment));
    const f = stripeFixture(transport, { clock: () => now });
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-recovery-guard-' + payment.currency + '-' + payment.amount, 'US');
    await f.repository.updateTransaction(session.transactionId, {
      status: 'FAILED',
      paymentStatus: 'VOID_PENDING',
      paymentProviderTransactionId: 'pi_guard',
      paymentRecoveryCode: 'PAYMENT_RECOVERY_REQUIRED',
    });
    now = new Date(now.getTime() + 20_000);

    await expect(f.service.reconcilePendingTransactions()).resolves.toMatchObject({ scanned: 1 });
    expect((await f.repository.getTransactionById(session.transactionId))?.paymentStatus).toBe('VOID_PENDING');
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('rejects a different PaymentIntent returned for an already-bound Checkout Session', async () => {
    const transport = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(stripeResponse({ id: 'cs_test_bound', url: 'https://checkout.stripe.com/c/pay/cs_test_bound' }))
      .mockResolvedValueOnce(stripeResponse({ id: 'cs_test_bound', status: 'complete', payment_status: 'paid', payment_intent: 'pi_other' }));
    const f = stripeFixture(transport);
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-session-binding-guard', 'US');
    await f.repository.updateTransaction(session.transactionId, { paymentProviderTransactionId: 'pi_original' });
    const before = await f.repository.getTransactionById(session.transactionId);
    await f.service.getTransaction('customer', session.transactionId, true);
    expect(await f.repository.getTransactionById(session.transactionId)).toEqual(before);
    expect(transport).toHaveBeenCalledTimes(2); expect(f.submit).not.toHaveBeenCalled();
  });

  it('reconciles an insufficient-funds Stripe attempt out of pending and permits a later successful retry', async () => {
    let paid = false;
    const transport = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith('/v1/checkout/sessions') && init?.method === 'POST') {
        return stripeResponse({ id: 'cs_test_fixture_123', url: 'https://checkout.stripe.com/c/pay/cs_test_fixture_123' });
      }
      if (target.includes('/v1/checkout/sessions/cs_test_fixture_123')) {
        return stripeResponse({
          id: 'cs_test_fixture_123',
          status: 'open',
          payment_status: paid ? 'paid' : 'unpaid',
          payment_intent: 'pi_declined_fixture',
        });
      }
      if (target.includes('/v1/payment_intents/pi_declined_fixture')) {
        return stripeResponse({
          id: 'pi_declined_fixture',
          status: paid ? 'succeeded' : 'requires_payment_method',
          amount: 599,
          amount_received: paid ? 599 : 0,
          currency: 'usd',
          metadata: {},
          ...(paid ? {} : { last_payment_error: { code: 'card_declined', decline_code: 'insufficient_funds' } }),
        });
      }
      throw new Error('Unexpected Stripe fixture request: ' + target);
    });
    const f = stripeFixture(transport);
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-insufficient-funds-reconcile', 'US');

    const failed = await f.service.getTransaction('customer', session.transactionId, true);
    expect(failed).toMatchObject({
      status: 'FAILED',
      paymentStatus: 'FAILED',
      failureCode: 'INSUFFICIENT_FUNDS',
      paymentProviderTransactionId: 'pi_declined_fixture',
    });
    expect(f.submit).not.toHaveBeenCalled();

    paid = true;
    const recovered = await f.service.getTransaction('customer', session.transactionId, true);
    expect(recovered.paymentStatus).toBe('CAPTURED');
    expect(recovered.failureCode).toBe('PAYMENT_RECOVERED');
    expect(f.submit).toHaveBeenCalledTimes(1);
  });

  it('requires a verified Stripe signature and rejects invalid payloads before fulfillment', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-session-002', 'US');
    const payload = JSON.stringify({
      id: 'evt_test_stripe_1',
      livemode: false,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: session.checkoutSession.id,
          amount_total: 599,
          currency: 'usd',
          payment_status: 'paid',
          payment_intent: 'pi_fixture_123',
          metadata: { transactionId: session.transactionId },
        },
      },
    });
    const raw = Buffer.from(payload, 'utf8');
    const signed = `t=${Math.floor(Date.now() / 1000)},v1=${createHmac('sha256', stripeEnv.STRIPE_WEBHOOK_SECRET).update(`${Math.floor(Date.now() / 1000)}.${payload}`).digest('hex')}`;

    expect(() => verifyStripeEvent(raw, undefined, stripeEnv.STRIPE_WEBHOOK_SECRET)).toThrow();
    expect(() => verifyStripeEvent(raw, signed, 'wrong-secret')).toThrow();
    expect(() => verifyStripeEvent(raw, `t=${Math.floor(Date.now() / 1000)},v1=zz`, stripeEnv.STRIPE_WEBHOOK_SECRET))
      .toThrow(expect.objectContaining({ code: 'INVALID_WEBHOOK_SIGNATURE' }));
    expect(() => verifyStripeEvent(raw, `t=${Math.floor(Date.now() / 1000)},v1=00`, stripeEnv.STRIPE_WEBHOOK_SECRET))
      .toThrow(expect.objectContaining({ code: 'INVALID_WEBHOOK_SIGNATURE' }));
    expect(verifyStripeEvent(raw, signed, stripeEnv.STRIPE_WEBHOOK_SECRET)).toMatchObject({
      eventId: 'evt_test_stripe_1',
      paymentId: 'pi_fixture_123',
      checkoutSessionId: session.checkoutSession.id,
      type: 'checkout.session.completed',
      transactionId: session.transactionId,
    });
  });

  describe('hosted Checkout webhook binding', () => {
    async function checkout() {
      const f = stripeFixture();
      const quote = await f.service.createQuote('customer', quoteInput);
      const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-webhook-binding', 'US');
      function event(type = 'checkout.session.completed', overrides: Record<string, unknown> = {}, eventId = 'evt_binding') {
        const raw = Buffer.from(JSON.stringify({ id: eventId, type, data: { object: {
          id: session.checkoutSession.id, amount_total: session.amountMinor, currency: 'usd',
          payment_intent: 'pi_binding', payment_status: 'paid', metadata: { transactionId: session.transactionId },
          ...overrides,
        } }, livemode: false }));
        const timestamp = Math.floor(Date.now() / 1000);
        const signature = `t=${timestamp},v1=${createHmac('sha256', stripeEnv.STRIPE_WEBHOOK_SECRET).update(`${timestamp}.${raw.toString('utf8')}`).digest('hex')}`;
        return verifyStripeEvent(raw, signature, stripeEnv.STRIPE_WEBHOOK_SECRET);
      }
      return { ...f, session, event };
    }

    it.each(['checkout.session.completed', 'checkout.session.async_payment_succeeded'])('%s + paid authorizes once, including duplicate events', async type => {
      const f = await checkout();
      const event = f.event(type);
      await f.service.acceptVerifiedPaymentEvent(event);
      await f.service.acceptVerifiedPaymentEvent(event);
      await f.service.acceptVerifiedPaymentEvent(f.event(type, {}, 'evt_binding_second_delivery'));
      expect((await f.repository.getTransactionById(f.session.transactionId))?.paymentStatus).toBe('CAPTURED');
      expect(f.submit).toHaveBeenCalledTimes(1);
    });

    it('duplicate signed paid webhooks create one actual-value notification after provider success', async () => {
      const f = await checkout();
      f.submit.mockResolvedValue({ transactionId: 'reloadly-fixture', status: 'SUCCESSFUL', requestedAmount: 5,
        requestedAmountCurrencyCode: 'USD', deliveredAmount: 805, deliveredAmountCurrencyCode: 'JMD' } as never);
      const event = f.event();
      await f.service.acceptVerifiedPaymentEvent(event);
      const first = await f.repository.getNotification(f.session.transactionId);
      expect(first).toMatchObject({ amount: 805, currency: 'JMD', status: 'PENDING', attempts: 0 });
      await f.service.acceptVerifiedPaymentEvent(event);
      await f.service.acceptVerifiedPaymentEvent(f.event('checkout.session.completed', {}, 'evt_notification_replay'));
      expect(await f.repository.getNotification(f.session.transactionId)).toEqual(first);
      expect(f.submit).toHaveBeenCalledTimes(1);
    });

    for (const type of ['checkout.session.completed', 'checkout.session.async_payment_succeeded']) {
      it.each(['unpaid', undefined, 'no_payment_required'])(`${type} + %s never authorizes or fulfills`, async paymentStatus => {
        const f = await checkout();
        const event = f.event(type, { payment_status: paymentStatus });
        await f.service.acceptVerifiedPaymentEvent(event);
        await f.service.acceptVerifiedPaymentEvent(event);
        expect((await f.repository.getTransactionById(f.session.transactionId))?.paymentStatus).toBe('SESSION_CREATED');
        expect(f.submit).not.toHaveBeenCalled();
      });
    }

    it('accepts delayed paid confirmation after an unpaid completion without duplicate fulfillment', async () => {
      const f = await checkout();
      await f.service.acceptVerifiedPaymentEvent(f.event('checkout.session.completed', { payment_status: 'unpaid' }));
      expect(f.submit).not.toHaveBeenCalled();
      const paid = f.event('checkout.session.async_payment_succeeded', {}, 'evt_binding_delayed_paid');
      await f.service.acceptVerifiedPaymentEvent(paid);
      await f.service.acceptVerifiedPaymentEvent(paid);
      expect(f.submit).toHaveBeenCalledTimes(1);
    });

    it.each([
      [{ id: 'cs_test_wrong' }, 'PAYMENT_NOT_FOUND'],
      [{ metadata: { transactionId: 'wrong-transaction' } }, 'PAYMENT_NOT_FOUND'],
      [{ amount_total: 600 }, 'PAYMENT_EVENT_MISMATCH'],
    ])('rejects mismatched server reservation %j', async (overrides, code) => {
      const f = await checkout();
      await expect(f.service.acceptVerifiedPaymentEvent(f.event('checkout.session.completed', overrides)))
        .rejects.toMatchObject({ code });
      expect(f.submit).not.toHaveBeenCalled();
    });

    it('fails closed when webhook event environment does not match the stored reservation binding', async () => {
      const f = await checkout();
      await f.repository.updateTransaction(f.session.transactionId, { paymentEnvironment: 'PRODUCTION' } as never);
      await expect(f.service.acceptVerifiedPaymentEvent(f.event('checkout.session.completed')))
        .rejects.toMatchObject({ code: 'PAYMENT_EVENT_MISMATCH' });
      expect(f.submit).not.toHaveBeenCalled();
    });

    it('fails closed when webhook livemode environment does not match runtime environment', async () => {
      const f = await checkout();
      const paid = f.event('checkout.session.completed');
      const liveEvent = { ...paid, environment: 'PRODUCTION' as const };
      await expect(f.service.acceptVerifiedPaymentEvent(liveEvent))
        .rejects.toMatchObject({ code: 'PAYMENT_EVENT_MISMATCH' });
      expect(f.submit).not.toHaveBeenCalled();
    });

    it.each([
      { currency: 'eur' }, { currency: undefined }, { amount_total: undefined, amount: 599 },
      { payment_intent: undefined }, { payment_intent: 'cs_test_not_an_intent' },
    ])('rejects incomplete or invalid Checkout payment evidence %j', async overrides => {
      const f = await checkout();
      expect(() => f.event('checkout.session.completed', overrides)).toThrow();
      expect(f.submit).not.toHaveBeenCalled();
    });

    it('rejects another PaymentIntent after the reserved session is bound', async () => {
      const f = await checkout();
      await f.service.acceptVerifiedPaymentEvent(f.event());
      await expect(f.service.acceptVerifiedPaymentEvent(f.event('checkout.session.async_payment_succeeded',
        { payment_intent: 'pi_wrong' }, 'evt_binding_wrong_intent'))).rejects.toMatchObject({ code: 'PAYMENT_EVENT_MISMATCH' });
      expect(f.submit).toHaveBeenCalledTimes(1);
      expect((await f.repository.getTransactionById(f.session.transactionId))?.paymentProviderTransactionId).toBe('pi_binding');
    });

    it.each(['checkout.session.async_payment_failed', 'checkout.session.expired'])('%s never fulfills', async type => {
      const f = await checkout();
      await f.service.acceptVerifiedPaymentEvent(f.event(type, { payment_status: 'unpaid', payment_intent: undefined }));
      expect((await f.repository.getTransactionById(f.session.transactionId))?.paymentStatus).toBe('FAILED');
      expect(f.submit).not.toHaveBeenCalled();
    });

    it('does not let a standalone PaymentIntent success bypass the stored Checkout Session binding', async () => {
      const f = await checkout();
      const intent = f.event('payment_intent.succeeded', { id: 'pi_binding', amount_received: 599 });
      await expect(f.service.acceptVerifiedPaymentEvent(intent)).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
      expect(() => f.event('payment_intent.succeeded')).toThrow(); // A cs_ ID is not a PaymentIntent.
      expect(f.submit).not.toHaveBeenCalled();
    });

    it.each(['payment_intent.payment_failed', 'payment_intent.canceled'])('%s marks the reserved recharge failed without fulfillment', async type => {
      const f = await checkout();
      const intent = f.event(type, {
        id: 'pi_binding',
        amount_received: 599,
        amount_total: undefined,
        payment_status: undefined,
      }, 'evt_binding_terminal_failure');
      await f.service.acceptVerifiedPaymentEvent(intent);
      expect(await f.repository.getTransactionById(f.session.transactionId)).toMatchObject({
        status: 'FAILED',
        paymentStatus: 'FAILED',
        failureCode: type === 'payment_intent.canceled' ? 'PAYMENT_CANCELLED' : 'PAYMENT_DECLINED',
        paymentProviderTransactionId: 'pi_binding',
      });
      expect(f.submit).not.toHaveBeenCalled();
    });
  });

  it('only successful server-verified Stripe payments can trigger Reloadly fulfillment, and duplicates are ignored', async () => {
    const f = stripeFixture();
    const quote = await f.service.createQuote('customer', quoteInput);
    const session = await f.service.createPaymentSession('customer', { quoteId: quote.id }, 'stripe-session-003', 'US');
    const rawSuccess = Buffer.from(JSON.stringify({
      id: 'evt_stripe_success_1',
      livemode: false,
      type: 'checkout.session.completed',
      data: { object: { id: session.checkoutSession.id, amount_total: session.amountMinor, currency: 'usd', payment_status: 'paid', payment_intent: 'pi_stripe_success_1', metadata: { transactionId: session.transactionId } } },
    }));
    const successSig = `t=${Math.floor(Date.now() / 1000)},v1=${createHmac('sha256', stripeEnv.STRIPE_WEBHOOK_SECRET).update(`${Math.floor(Date.now() / 1000)}.${rawSuccess.toString('utf8')}`).digest('hex')}`;

    await f.service.acceptVerifiedPaymentEvent(verifyStripeEvent(rawSuccess, successSig, stripeEnv.STRIPE_WEBHOOK_SECRET));
    expect(f.submit).toHaveBeenCalledTimes(1);

    const rawFailed = Buffer.from(JSON.stringify({
      id: 'evt_stripe_failed_1',
      livemode: false,
      type: 'checkout.session.async_payment_failed',
      data: { object: { id: session.checkoutSession.id, amount_total: session.amountMinor, currency: 'usd', payment_status: 'unpaid', payment_intent: 'pi_stripe_success_1', metadata: { transactionId: session.transactionId } } },
    }));
    const failedSig = `t=${Math.floor(Date.now() / 1000)},v1=${createHmac('sha256', stripeEnv.STRIPE_WEBHOOK_SECRET).update(`${Math.floor(Date.now() / 1000)}.${rawFailed.toString('utf8')}`).digest('hex')}`;
    await expect(f.service.acceptVerifiedPaymentEvent(verifyStripeEvent(rawFailed, failedSig, stripeEnv.STRIPE_WEBHOOK_SECRET))).resolves.toBeUndefined();
    expect(f.submit).toHaveBeenCalledTimes(1);
  });
});
