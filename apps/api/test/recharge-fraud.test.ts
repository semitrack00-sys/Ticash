import { describe, expect, it, vi } from 'vitest';
import { assertPurchaseLimits, paymentReviewReason, type PaymentEvidence } from '../src/topup/fraud-policy.js';
import { createRechargeFraudGate } from '../src/topup/fraud-gate.js';
import { MobileTopUpService } from '../src/topup/service.js';

const now = new Date('2026-10-24T12:00:00Z');
const safe: PaymentEvidence = { chargeId: 'ch_test', fingerprint: 'card', risk: 'normal', authentication: 'authenticated', paymentType: 'card', review: false, disputed: false, refunded: false };
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
  it.each([{risk:'elevated'}, {risk:'highest'}, {risk:'unknown'}, {review:true}, {disputed:true}, {refunded:true}, {authentication:'attempt_acknowledged'}, {fingerprint:undefined}, {paymentType:'link'}])('holds uncertain evidence %j', patch => {
    expect(paymentReviewReason({...safe, ...patch})).toBeTruthy();
  });
  it('serializes the card history and persists a third-card review', async () => {
    const create = vi.fn(); const lock = vi.fn();
    const tx = { $queryRaw:lock, flupFlapCustomer:{findUnique:vi.fn().mockResolvedValue({status:'ACTIVE'})}, rechargeFraudAssessment: {
      findUnique:vi.fn().mockResolvedValue(null), findMany:vi.fn().mockResolvedValue([{fingerprint:'one'},{fingerprint:'two'}]), upsert:create } };
    const db = {...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx)};
    const gate = createRechargeFraudGate(db as never, {fraudEvidence:async()=>safe} as never);
    expect(await gate({id:'tx',userId:'flupflap:11111111-1111-4111-8111-111111111111',paymentProvider:'STRIPE',paymentProviderTransactionId:'pi_test'} as never)).toBe('CARD_SWITCHING_REVIEW');
    expect(lock).toHaveBeenCalledOnce();
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
