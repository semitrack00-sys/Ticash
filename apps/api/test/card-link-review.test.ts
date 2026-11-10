import { createHash } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { cardLinkReviewApproved, cardLinkReviewRevoked, reviewDeletedCardLink, unreviewedCardLinks } from '../src/topup/card-link-review.js';
import { createRechargeFraudGate } from '../src/topup/fraud-gate.js';
import { createFlupFlapAdmin } from '../src/flupflap/admin.js';
import { requirePermission } from '../src/admin-access.js';

const now = new Date();
const fingerprint = createHash('sha256').update('card').digest('hex');
const note = 'Customer ownership and passing Stripe checks reviewed by support.';
const decision = { action: cardLinkReviewApproved, userId: 'staff', createdAt: now,
  metadata: { fingerprint, linkedCustomerId: 'deleted', note, expiresAt: new Date(+now + 86400000).toISOString() } };
function fixture() {
  const order = { id: 'order', flupFlapCustomerId: 'buyer', paymentProvider: 'STRIPE', testMode: false,
    status: 'FAILED', paymentStatus: 'REFUNDED', paymentProviderTransactionId: 'pi_test' };
  const assessment = { customerId: 'buyer', fingerprint, chargeId: 'ch_test', reason: 'LINKED_ACCOUNT_REVIEW' };
  const tx = { $queryRaw: vi.fn(),
    flupFlapCustomer: { findUnique: vi.fn(async ({where}) => where.id === 'deleted' ? {status:'DELETED'} : {status:'ACTIVE'}),
      findMany: vi.fn().mockResolvedValue([{id:'deleted'}]), findFirst: vi.fn().mockResolvedValue({id:'deleted'}) },
    mobileTopUpTransaction: { findUnique: vi.fn().mockResolvedValue(order) },
    rechargeFraudAssessment: { findUnique: vi.fn().mockResolvedValue(assessment), findFirst: vi.fn().mockResolvedValue(assessment),
      findMany: vi.fn().mockImplementation(async args => args.where.fingerprint ? [{customerId:'deleted'}] : []), upsert: vi.fn() },
    flupFlapDevice: {findMany: vi.fn().mockResolvedValue([])},
    auditLog: {findMany: vi.fn().mockResolvedValue([decision]), create: vi.fn()} };
  const db = {...tx, $transaction: async (fn: (t: typeof tx) => unknown) => fn(tx)};
  const evidence = { chargeId:'ch_test', fingerprint:'card', risk:'normal', paymentType:'card', review:false,
    disputed:false, refunded:true, postalCodeCheck:'pass', cvcCheck:'pass', streetCheck:'pass' };
  const stripe = {fraudEvidence: vi.fn().mockResolvedValue(evidence)};
  return {tx, db, stripe, evidence, order, assessment};
}
describe('deleted card association review', () => {
  it('clears only the reviewed deleted account and retains other associations', async () => {
    const {db}=fixture();
    expect(await unreviewedCardLinks(db as never,'buyer',fingerprint,['deleted','other'],now)).toEqual(['other']);
    expect(await unreviewedCardLinks(db as never,'buyer','different',['deleted'],now)).toEqual(['deleted']);
    expect(db.auditLog.findMany).toHaveBeenCalledWith(expect.objectContaining({where:expect.objectContaining({entity:'FlupFlapCustomer',entityId:'buyer'})}));
  });
  it.each(['expired','revoked','no-actor','short-note','too-long','restored'])('refuses %s approvals', async state => {
    const {db}=fixture();
    const d=structuredClone(decision);
    if(state==='expired')d.metadata.expiresAt=now.toISOString();
    if(state==='revoked')d.action=cardLinkReviewRevoked;
    if(state==='no-actor')d.userId='';
    if(state==='short-note')d.metadata.note='short';
    if(state==='too-long')d.metadata.expiresAt=new Date(+now+31*86400000).toISOString();
    if(state==='restored')db.flupFlapCustomer.findMany.mockResolvedValue([]);
    db.auditLog.findMany.mockResolvedValue([d,decision]);
    expect(await unreviewedCardLinks(db as never,'buyer',fingerprint,['deleted'],now)).toEqual(['deleted']);
  });
  it('permits a new payment after review but still rejects failing issuer checks',async()=>{
    const {db,stripe,assessment,evidence}=fixture();
    db.rechargeFraudAssessment.findUnique.mockResolvedValue(null);
    db.auditLog.findMany.mockImplementation(async args=>typeof args.where.action==='object'?[decision]:[]);
    stripe.fraudEvidence.mockResolvedValue({...evidence,refunded:false});
    const gate=createRechargeFraudGate(db as never,stripe as never);
    const record={id:'new-order',userId:'flupflap:buyer',paymentProvider:'STRIPE'} as never;
    expect(await gate(record)).toBeUndefined();
    stripe.fraudEvidence.mockResolvedValue({...evidence,refunded:false,cvcCheck:'fail'});
    expect(await gate(record)).toBe('PAYMENT_CARD_CHECK_FAILED');
    db.rechargeFraudAssessment.findUnique.mockResolvedValue(assessment);
    expect(await gate(record)).toBe('LINKED_ACCOUNT_REVIEW'); // old decisions are not replayed
  });
  it('records an expiring staff review without changing any payment or old account',async()=>{
    const {db,stripe}=fixture();
    expect(await reviewDeletedCardLink(db as never,stripe as never,'order','deleted','staff',note,true)).toMatchObject({approved:true,originalOrderUnchanged:true});
    expect(db.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({data:expect.objectContaining({userId:'staff',entityId:'buyer',action:cardLinkReviewApproved})}));
  });
  it.each([{risk:'highest'},{disputed:true},{cvcCheck:'fail'},{postalCodeCheck:'unavailable'},{refunded:false},{chargeId:'different'},{fingerprint:'other'}])('rejects approval with unsafe or mismatched evidence %j',async patch=>{
    const {db,stripe,evidence}=fixture();stripe.fraudEvidence.mockResolvedValue({...evidence,...patch});
    await expect(reviewDeletedCardLink(db as never,stripe as never,'order','deleted','staff',note,true)).rejects.toMatchObject({code:'CARD_LINK_REVIEW_NOT_ALLOWED'});
    expect(db.auditLog.create).not.toHaveBeenCalled();
  });
  it('can revoke without Stripe availability',async()=>{
    const {db}=fixture();
    expect(await reviewDeletedCardLink(db as never,undefined,'order','deleted','staff',note,false)).toMatchObject({approved:false});
  });
});

describe('card link review authorization',()=>{
  const id='11111111-1111-4111-8111-111111111111';
  it.each(['ADMIN','SUPER_ADMIN','SUPPORT','OPERATIONS','COMPLIANCE','READ_ONLY'])('checks %s permissions',async role=>{
    const review=vi.fn().mockResolvedValue({approved:true});
    const app=express();app.use(express.json());
    app.use(createFlupFlapAdmin({authenticate:(req,_res,next)=>{Object.assign(req,{userId:'staff'});next();},
      permission:p=>requirePermission(p,async()=>role),service:{} as never,identities:{} as never,recharge:{} as never,
      audit:async()=>{},auditRows:async()=>[],reviewDeletedCardLink:review}));
    const allowed=['ADMIN','SUPER_ADMIN'].includes(role);
    await request(app).post(`/transactions/${id}/deleted-card-link-review`).send({linkedCustomerId:id,reason:note,confirm:'APPROVE_DELETED_CARD_LINK'}).expect(allowed?200:403);
    expect(review).toHaveBeenCalledTimes(allowed?1:0);
  });
});
