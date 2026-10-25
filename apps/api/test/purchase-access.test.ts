import { expect, it } from 'vitest';
import { assertPurchaseLimits, throwPurchaseBlocks, temporaryPurchaseAccess, type PurchaseHistory } from '../src/topup/fraud-policy.js';
import { MobileTopUpError } from '../src/topup/types.js';
const now=new Date('2026-10-25T12:00:00Z');
const row=(createdAt:string,totalChargeUsd=5,attemptExempt=false):PurchaseHistory=>({createdAt,totalChargeUsd,paymentStatus:'FAILED',attemptExempt});
function block(amount:number,history:PurchaseHistory[]) {
  try{assertPurchaseLimits(amount,history,now,false);}catch(error){if(error instanceof MobileTopUpError)return error;throw error;}
  throw new Error('Expected purchase block');
}
it('reopens after the correct rolling hourly reservation expires, including the inclusive boundary',()=>{
  const history=[row('2026-10-25T11:10:00Z'),row('2026-10-25T11:20:00Z'),row('2026-10-25T11:30:00Z')];
  const b=block(5,history);expect(b.purchaseAccess).toMatchObject({mode:'TEMPORARY_LIMIT',serverTime:now.toISOString(),retryAt:'2026-10-25T12:10:00.001Z',retryAfterSeconds:601});
  expect(()=>assertPurchaseLimits(5,history,new Date(b.purchaseAccess!.retryAt!),false)).not.toThrow();
  expect(()=>assertPurchaseLimits(5,history,new Date(Date.parse(b.purchaseAccess!.retryAt!)-1),false)).toThrow();
});
it('waits for enough daily dollars to expire, rather than just the first order',()=>{
  const history=[row('2026-10-24T13:00:00Z',10),row('2026-10-24T14:00:00Z',95),row('2026-10-24T15:00:00Z',95)];
  expect(block(100,history).purchaseAccess?.retryAt).toBe('2026-10-25T14:00:00.001Z');
});
it('accounts for daily attempt limits and keeps exempt attempts in the money budget',()=>{
  const history=Array.from({length:10},(_,i)=>row(`2026-10-24T${(13+i).toString()}:00:00Z`));
  expect(block(5,history).purchaseAccess?.retryAt).toBe('2026-10-25T13:00:00.001Z');
  expect(block(100,[row('2026-10-24T15:00:00Z',150,true)]).purchaseAccess?.retryAt).toBe('2026-10-25T15:00:00.001Z');
});
it('never invents an unlock time for a purchase exceeding the permanent per-order cap',()=>{
  expect(block(100.01,[]).purchaseAccess).toEqual({mode:'CHANGE_AMOUNT',serverTime:now.toISOString()});
});
it('combines customer, recipient and card gates using the latest reset',()=>{
  const a=block(5,Array.from({length:3},()=>row('2026-10-25T11:50:00Z')));
  const b=new MobileTopUpError('PAYMENT_CARD_LIMIT','Limit',429,temporaryPurchaseAccess(Date.parse('2026-10-26T09:00:00Z'),now));
  expect(()=>throwPurchaseBlocks([a,b],now)).toThrowError(expect.objectContaining({purchaseAccess:expect.objectContaining({retryAt:'2026-10-26T09:00:00.000Z'})}));
});
