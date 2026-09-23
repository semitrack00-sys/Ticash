import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaMobileTopUpRepository } from '../src/topup/repository.js';
import type { MobileTopUpTransactionRecord } from '../src/topup/repository.js';

describe('PrismaMobileTopUpRepository', () => {
  it('does not leak quote-only database metadata into transaction snapshots', async () => {
    const storedQuote = {
      id: 'quote-id',
      userId: 'user-id',
      provider: 'RELOADLY',
      testMode: true,
      countryCode: 'HT',
      recipientPhone: '+50937123456',
      operatorId: 173,
      operatorName: 'Digicel Haiti',
      productId: 'reloadly:173:airtime:range',
      productName: 'Digicel Haiti airtime',
      kind: 'AIRTIME',
      providerAmount: new Prisma.Decimal('4.00'),
      providerCurrency: 'USD',
      deliveredValue: null,
      deliveredCurrency: 'HTG',
      feeUsd: new Prisma.Decimal('0.00'),
      totalChargeUsd: new Prisma.Decimal('4.00'),
      expiresAt: new Date('2026-09-06T20:00:00.000Z'),
      consumedAt: null,
      createdAt: new Date('2026-09-06T19:55:00.000Z'),
    };
    const create = vi.fn().mockResolvedValue(storedQuote);
    const repository = new PrismaMobileTopUpRepository({
      mobileTopUpQuote: { create },
    } as never);

    const quote = await repository.createQuote({
      userId: storedQuote.userId,
      countryCode: storedQuote.countryCode,
      recipientPhone: storedQuote.recipientPhone,
      operatorId: storedQuote.operatorId,
      operatorName: storedQuote.operatorName,
      productId: storedQuote.productId,
      productName: storedQuote.productName,
      kind: 'AIRTIME',
      providerAmount: 4,
      providerCurrency: 'USD',
      deliveredCurrency: 'HTG',
      feeUsd: 0,
      totalChargeUsd: 4,
      expiresAt: storedQuote.expiresAt.toISOString(),
    });

    expect(quote).not.toHaveProperty('provider');
    expect(quote).not.toHaveProperty('testMode');
    expect(quote).toMatchObject({
      id: 'quote-id',
      countryCode: 'HT',
      providerAmount: 4,
      feeUsd: 0,
      totalChargeUsd: 4,
    });
  });
});

describe('payment foundation persistence', () => {
  const timestamp = new Date('2026-09-22T12:00:00Z');
  const row = { id:'transaction',userId:'customer',quoteId:'quote',recipientId:null,providerTransactionId:null,
    operatorTransactionId:null,customIdentifier:'immutable-reference',idempotencyKey:'key-123456',requestHash:'hash',
    status:'PENDING',paymentStatus:'AUTHORIZED',paymentAuthorizationId:'old-authorization',
    countryCode:'JM',recipientPhone:'+18765551234',operatorId:77,operatorName:'Fixture operator',productId:'product',productName:'Fixture product',
    kind:'AIRTIME',providerAmount:new Prisma.Decimal(5),providerCurrency:'USD',deliveredValue:null,deliveredCurrency:'JMD',
    feeUsd:new Prisma.Decimal(3.5),totalChargeUsd:new Prisma.Decimal(8.5),providerStatus:null,failureCode:null,testMode:true,
    createdAt:timestamp,updatedAt:timestamp,deliveredAt:null,failedAt:null,refundedAt:null,
    paymentMethod:null,paymentProvider:null,paymentSessionId:null,paymentProviderTransactionId:null,
    paymentStartedAt:null,fulfillmentStartedAt:null,recoveryStartedAt:null,paymentRecoveryCode:null };

  it('reads legacy NULL metadata without relabeling existing payment records', async () => {
    const repository=new PrismaMobileTopUpRepository({mobileTopUpTransaction:{findUnique:vi.fn(async()=>row)}} as never);
    expect(await repository.getTransactionById('transaction')).toMatchObject({paymentStatus:'AUTHORIZED',paymentAuthorizationId:'old-authorization',paymentProvider:undefined,paymentMethod:undefined,totalChargeUsd:8.5});
  });
  it('claims fulfillment with one conditional database write and no application-only lock', async () => {
    const updateMany=vi.fn().mockResolvedValueOnce({count:1}).mockResolvedValueOnce({count:0});
    const repository=new PrismaMobileTopUpRepository({mobileTopUpTransaction:{updateMany}} as never);
    expect(await repository.claimOperation('transaction','fulfillment',timestamp.toISOString())).toBe(true);
    expect(await repository.claimOperation('transaction','fulfillment',timestamp.toISOString())).toBe(false);
    expect(updateMany.mock.calls[0][0]).toMatchObject({where:{id:'transaction',fulfillmentStartedAt:null,providerTransactionId:null,status:'PENDING',OR:[
      {paymentProvider:'MOCK',paymentStatus:{in:['AUTHORIZED','CAPTURED']}},{paymentProvider:'CHECKOUT_COM',paymentStatus:'CAPTURED'},
    ]},data:{fulfillmentStartedAt:timestamp}});
  });
  it('never creates a transaction when atomic quote consumption fails', async () => {
    const create=vi.fn();const updateMany=vi.fn(async()=>({count:0}));
    const repository=new PrismaMobileTopUpRepository({
      mobileTopUpTransaction:{findUnique:vi.fn(async()=>null)},
      $transaction:async(fn:(tx:unknown)=>unknown)=>fn({mobileTopUpQuote:{updateMany},mobileTopUpTransaction:{create}}),
    } as never);
    await expect(repository.reserveTransaction({id:'transaction',userId:'customer',quoteId:'quote',idempotencyKey:'key-123456',createdAt:timestamp.toISOString()} as MobileTopUpTransactionRecord)).rejects.toMatchObject({statusCode:409});
    expect(create).not.toHaveBeenCalled();expect(updateMany).toHaveBeenCalledWith({where:{id:'quote',userId:'customer',consumedAt:null,expiresAt:{gt:timestamp}},data:{consumedAt:timestamp}});
  });
  it('retains event processing state for retries and rejects changed event identities', async () => {
    const upsert=vi.fn().mockResolvedValueOnce({payloadHash:'hash',transactionId:'transaction',processedAt:null})
      .mockResolvedValueOnce({payloadHash:'hash',transactionId:'transaction',processedAt:timestamp})
      .mockResolvedValueOnce({payloadHash:'different',transactionId:'transaction',processedAt:timestamp});
    const repository=new PrismaMobileTopUpRepository({mobileTopUpPaymentEvent:{upsert}} as never);
    expect(await repository.registerPaymentEvent('evt_one','hash','transaction')).toBe(true);
    expect(await repository.registerPaymentEvent('evt_one','hash','transaction')).toBe(false);
    await expect(repository.registerPaymentEvent('evt_one','hash','transaction')).rejects.toMatchObject({code:'PAYMENT_EVENT_CONFLICT'});
    expect(upsert.mock.calls[0][0].create).toEqual({provider:'CHECKOUT_COM',eventId:'evt_one',payloadHash:'hash',transactionId:'transaction'});
  });
  it('payment transitions constrain both prior state and bound provider payment ID', async () => {
    const updateMany=vi.fn(async()=>({count:0}));const repository=new PrismaMobileTopUpRepository({mobileTopUpTransaction:{updateMany}} as never);
    expect(await repository.transitionPayment('transaction',['SESSION_CREATED','AUTHORIZED'],{paymentStatus:'CAPTURED',paymentProviderTransactionId:'pay_one'})).toBe(false);
    expect(updateMany.mock.calls[0][0]).toMatchObject({where:{id:'transaction',paymentStatus:{in:['SESSION_CREATED','AUTHORIZED']},OR:[{paymentProviderTransactionId:null},{paymentProviderTransactionId:'pay_one'}]}});
  });
});
