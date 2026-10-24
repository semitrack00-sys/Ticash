import { describe, expect, it, vi } from 'vitest';
import { assertPurchaseLimits, paymentReviewReason, type PaymentEvidence } from '../src/topup/fraud-policy.js';
import { approveRechargeReview, createRechargeFraudGate } from '../src/topup/fraud-gate.js';
import { MobileTopUpService } from '../src/topup/service.js';

const now = new Date('2026-10-24T12:00:00Z');
const safe: PaymentEvidence = { postalCodeCheck:'pass', cvcCheck:'pass', chargeId: 'ch_test', fingerprint: 'card', risk: 'normal', authentication: 'authenticated', paymentType: 'card', review: false, disputed: false, refunded: false };
describe('recharge purchase limits', () => {
  it('limits new buyers before collecting money', () => {
    expect(() => assertPurchaseLimits(25, [], now, true)).not.toThrow();
    expect(() => assertPurchaseLimits(25.01, [], now, true)).toThrowError(expect.objectContaining({ code: 'RECHARGE_LIMIT_REACHED' }));
    expect(() => assertPurchaseLimits(20, [{ createdAt: now.toISOString(), totalChargeUsd: 35, paymentStatus: 'FAILED' }], now, true)).toThrow();
  });
  it('counts failed reservations against velocity and excludes old orders', () => {
    const history = Array.from({length: 3}, () => ({ createdAt: now.toISOString(), totalChargeUsd: 5, paymentStatus: 'FAILED' }));
    expect(() => assertPurchaseLimits(5, history, now, false)).toThrow();
    expect(() => assertPurchaseLimits(5, history.map(r => ({...r, createdAt: '2026-10-22T12:00:00Z'})), now, false)).not.toThrow();
  });
});
describe('payment risk decision', () => {
  it('allows only authenticated normal-risk cards', () => expect(paymentReviewReason(safe)).toBeUndefined());
  it.each([{postalCodeCheck:'fail'}, {cvcCheck:'fail'}, {postalCodeCheck:'fail', cvcCheck:'fail'}])('holds failed issuer checks despite authenticated normal risk %j', patch => {
    expect(paymentReviewReason({...safe, ...patch})).toBe('PAYMENT_CARD_CHECK_FAILED');
  });
  it.each(['unavailable', 'unchecked', 'not_provided', undefined, '', 'unknown'])('requires both checks to pass, refusing %s independently', check => {
    expect(paymentReviewReason({...safe, postalCodeCheck:check})).toBe('PAYMENT_CARD_CHECK_FAILED');
    expect(paymentReviewReason({...safe, cvcCheck:check})).toBe('PAYMENT_CARD_CHECK_FAILED');
  });
  it.each([{risk:'elevated'}, {risk:'highest'}, {risk:'unknown'}, {review:true}, {disputed:true}, {refunded:true}, {authentication:'attempt_acknowledged'}, {fingerprint:undefined}, {paymentType:'link'}])('holds uncertain evidence %j', patch => {
    expect(paymentReviewReason({...safe, ...patch})).toBeTruthy();
  });
  it('holds network-downgraded authentication without confusing card networks', () => {
    expect(paymentReviewReason({...safe, cardNetwork:'visa', responseEci:'07'})).toBe('PAYMENT_AUTHENTICATION_REVIEW');
    expect(paymentReviewReason({...safe, cardNetwork:'mastercard', responseEci:'06'})).toBe('PAYMENT_AUTHENTICATION_REVIEW');
    expect(paymentReviewReason({...safe, cardNetwork:'visa', responseEci:'05'})).toBeUndefined();
    expect(paymentReviewReason({...safe, cardNetwork:'mastercard', responseEci:'02'})).toBeUndefined();
  });
  it('serializes the card history and persists a third-card review', async () => {
    const create = vi.fn(); const lock = vi.fn();
    const tx = { $queryRaw:lock, flupFlapCustomer:{findUnique:vi.fn().mockResolvedValue({status:'ACTIVE'})}, rechargeFraudAssessment: {
      findUnique:vi.fn().mockResolvedValue(null), findMany:vi.fn().mockImplementation(async args => args.where.fingerprint ? [] : [{fingerprint:'one'},{fingerprint:'two'}]), upsert:create } };
    const db = {...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx)};
    const gate = createRechargeFraudGate(db as never, {fraudEvidence:async()=>safe} as never);
    expect(await gate({id:'tx',userId:'flupflap:11111111-1111-4111-8111-111111111111',paymentProvider:'STRIPE',paymentProviderTransactionId:'pi_test'} as never)).toBe('CARD_SWITCHING_REVIEW');
    expect(lock).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({create:expect.objectContaining({reason:'CARD_SWITCHING_REVIEW'})}));
  });
  it('never submits held orders, including repeated fulfillment calls', async () => {
    let record = {id:'tx',userId:'flupflap:11111111-1111-4111-8111-111111111111',status:'PENDING',paymentStatus:'CAPTURED',paymentProvider:'STRIPE',testMode:false};
    const submit = vi.fn(); const claim=vi.fn(); const gate=vi.fn().mockResolvedValue('PAYMENT_RISK_REVIEW');
    const repo={getTransactionById:async()=>record,claimOperation:claim,updateTransaction:async(_id:string,patch:object)=>record={...record,...patch}};
    const service=new MobileTopUpService({} as never,{submitTopUp:submit} as never,{} as never,repo as never,async()=>{},undefined,undefined,undefined,undefined,false,undefined,gate);
    vi.spyOn(service as never,'assertEnabled' as never).mockImplementation(()=>undefined);
    vi.spyOn(service as never,'assertTransactionEnvironment' as never).mockImplementation(()=>undefined);
    await service.fulfillPaidRecharge('tx'); await service.fulfillPaidRecharge('tx');
    expect(gate).toHaveBeenCalledOnce(); expect(submit).not.toHaveBeenCalled(); expect(claim).not.toHaveBeenCalled();
  });
});

describe('staff review safeguards', () => {
  const record = {id:'tx',userId:'flupflap:11111111-1111-4111-8111-111111111111',paymentProvider:'STRIPE',paymentProviderTransactionId:'pi_test',testMode:false};
  function fixture(evidence = safe) {
    const assessment = {findUnique:vi.fn().mockResolvedValue(null),findMany:vi.fn().mockImplementation(async args => args.where.fingerprint ? [] : [{fingerprint:'one'},{fingerprint:'two'}]),upsert:vi.fn()};
    const tx = {$queryRaw:vi.fn(),flupFlapCustomer:{findUnique:vi.fn().mockResolvedValue({status:'ACTIVE'}),findFirst:vi.fn().mockResolvedValue(null)},
      mobileTopUpTransaction:{findUnique:vi.fn().mockResolvedValue({flupFlapCustomerId:record.userId.slice(9),status:'PENDING',paymentStatus:'CAPTURED',failureCode:'FRAUD_REVIEW_REQUIRED'})},
      rechargeFraudAssessment:assessment,auditLog:{create:vi.fn()}};
    return {tx,db:{...tx,$transaction:async(fn:(t:typeof tx)=>unknown)=>fn(tx)},stripe:{fraudEvidence:vi.fn().mockResolvedValue(evidence)}};
  }
  it('holds a shared card on a new account and keeps restricted links held after staff review',async()=>{
    const {db,stripe,tx}=fixture();
    tx.rechargeFraudAssessment.findMany.mockResolvedValue([{customerId:'other-buyer'}]);
    const gate=createRechargeFraudGate(db as never,stripe as never);
    expect(await gate(record as never)).toBe('SHARED_CARD_REVIEW');
    await approveRechargeReview(db as never,stripe as never,record as never,'staff','Reviewed legitimate family sharing');
    const approved=tx.rechargeFraudAssessment.upsert.mock.calls.at(-1)![0].create;
    tx.rechargeFraudAssessment.findUnique.mockResolvedValue(approved);
    expect(await gate(record as never)).toBeUndefined();
    tx.flupFlapCustomer.findFirst.mockResolvedValue({id:'other-buyer'} as never);
    expect(await gate(record as never)).toBe('LINKED_ACCOUNT_REVIEW');
  });
  it.each([{disputed:true},{refunded:true},{risk:'elevated'},{authentication:'attempt_acknowledged'},{review:true},{postalCodeCheck:'fail'},{cvcCheck:'fail'},{postalCodeCheck:undefined},{cvcCheck:'unavailable'}])('rejects unsafe release %j',async patch=>{
    const {db,stripe,tx}=fixture({...safe,...patch});
    await expect(approveRechargeReview(db as never,stripe as never,record as never,'staff','Reviewed payment evidence')).rejects.toMatchObject({code:'FRAUD_REVIEW_NOT_CLEAR'});
    expect(tx.rechargeFraudAssessment.upsert).not.toHaveBeenCalled();
  });
  it('rejects a restricted account even when payment evidence passes',async()=>{
    const {db,stripe,tx}=fixture();
    tx.flupFlapCustomer.findUnique.mockResolvedValue({status:'ACTIVE',rechargeRestricted:true} as never);
    await expect(approveRechargeReview(db as never,stripe as never,record as never,'staff','Reviewed payment evidence')).rejects.toMatchObject({code:'FRAUD_REVIEW_CONFLICT'});
  });
  it('records the staff reason and a charge-bound approval',async()=>{
    const {db,stripe,tx}=fixture();
    await approveRechargeReview(db as never,stripe as never,record as never,'staff','Reviewed payment evidence');
    const approved=tx.rechargeFraudAssessment.upsert.mock.calls[0][0].create;
    expect(approved).toMatchObject({chargeId:'ch_test',reason:null,reviewedBy:'staff'});
    expect(approved.fingerprint).not.toBe('card');
    expect(tx.auditLog.create).toHaveBeenCalledOnce();
    tx.rechargeFraudAssessment.findUnique.mockResolvedValue(approved);
    expect(await createRechargeFraudGate(db as never,stripe as never)(record as never)).toBeUndefined();
    stripe.fraudEvidence.mockResolvedValue({...safe,chargeId:'ch_changed'});
    expect(await createRechargeFraudGate(db as never,stripe as never)(record as never)).toBe('CARD_SWITCHING_REVIEW');
    stripe.fraudEvidence.mockResolvedValue({...safe,disputed:true});
    expect(await createRechargeFraudGate(db as never,stripe as never)(record as never)).toBeTruthy();
  });
});
