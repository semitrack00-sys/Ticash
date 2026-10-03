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
      testMode: true,
      expiresAt: storedQuote.expiresAt.toISOString(),
    });

    expect(quote.provider).toBe('RELOADLY');
    expect(quote.testMode).toBe(true);
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
    feeUsd:new Prisma.Decimal(0.99),totalChargeUsd:new Prisma.Decimal(5.99),providerStatus:null,failureCode:null,testMode:true,
    createdAt:timestamp,updatedAt:timestamp,deliveredAt:null,failedAt:null,refundedAt:null,
    paymentMethod:null,paymentProvider:null,paymentSessionId:null,paymentProviderTransactionId:null,
    paymentStartedAt:null,fulfillmentStartedAt:null,recoveryStartedAt:null,paymentRecoveryCode:null };

  it.each(['DTONE', 'DING'] as const)('persists %s provider and exact product in quote, transaction and recipient database writes', async provider => {
    const operatorId = provider === 'DING' ? 1400000255 : 700000255;
    const providerProductId = provider === 'DING' ? 'fixture-exact-sku' : '56876';
    const identity = { provider, providerProductId, operatorId, productId: `${provider.toLowerCase()}:JM:${operatorId}:product:${providerProductId}` };
    const quoteRow = { ...row, ...identity, id: 'quote', expiresAt: timestamp, consumedAt: null };
    const quoteCreate = vi.fn(async () => quoteRow);
    const transactionCreate = vi.fn(async () => ({ ...row, ...identity }));
    const recipientRow = { id: 'recipient', userId: 'customer', nickname: 'Test', phone: '+18765551234', countryCode: 'JM', provider, operatorId, operatorName: 'Fixture', lastProductId: null, lastProductName: null, createdAt: timestamp, updatedAt: timestamp };
    const upsert = vi.fn().mockResolvedValue(recipientRow);
    const repository = new PrismaMobileTopUpRepository({
      mobileTopUpQuote: { create: quoteCreate }, mobileTopUpRecipient: { upsert },
      mobileTopUpTransaction: { findUnique: vi.fn(async () => null) },
      $transaction: async (fn: (tx: unknown) => unknown) => fn({ mobileTopUpQuote: { updateMany: vi.fn(async () => ({ count: 1 })) }, mobileTopUpTransaction: { create: transactionCreate } }),
    } as never);
    const quote = await repository.createQuote({ ...identity, userId: 'customer', countryCode: 'JM', recipientPhone: recipientRow.phone, operatorName: 'Fixture', productName: 'Exact product', kind: 'AIRTIME', providerAmount: 5, providerCurrency: 'USD', deliveredCurrency: 'JMD', feeUsd: 0.99, totalChargeUsd: 5.99, testMode: true, expiresAt: timestamp.toISOString() });
    expect(quote).toMatchObject(identity);
    expect(quoteCreate).toHaveBeenCalledWith({ data: expect.objectContaining(identity) });
    const reserved = await repository.reserveTransaction({ ...quote, id: 'transaction', quoteId: quote.id, idempotencyKey: 'fixture-key', requestHash: 'hash', customIdentifier: 'fixture-reference', status: 'PENDING', paymentStatus: 'AUTHORIZED', testMode: true, updatedAt: timestamp.toISOString() });
    expect(reserved.record).toMatchObject(identity);
    expect(transactionCreate).toHaveBeenCalledWith({ data: expect.objectContaining(identity) });
    const recipient = await repository.saveRecipient({ userId: 'customer', nickname: 'Test', phone: recipientRow.phone, countryCode: 'JM', provider, operatorId });
    expect(recipient).toMatchObject({ provider, operatorId });
    expect(upsert.mock.calls[0]![0]).toMatchObject({ create: { provider, operatorId }, update: { provider, operatorId } });
  });
  it('atomically persists confirmed receiver value and one outbox row without rewriting its quote', async () => {
    const receiverQuote = { amount: 800, currency: 'JMD', senderAmount: 5, senderCurrency: 'USD', source: 'PROVIDER_PRODUCT', quotedAt: timestamp.toISOString() };
    const actual = { ...row, status: 'DELIVERED', providerTransactionId: 'provider-ref', deliveredAt: timestamp,
      deliveredValue: new Prisma.Decimal(805), receiverValueConfirmed: true, receiverQuote, receiverDiscrepancy: true };
    const updateMany = vi.fn(async () => ({ count: 1 })); const upsert = vi.fn();
    const transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn({
      mobileTopUpTransaction: { updateMany, findUniqueOrThrow: async () => actual }, rechargeNotification: { upsert },
    }));
    const repository = new PrismaMobileTopUpRepository({ $transaction: transaction } as never);
    const value = await repository.updateTransaction('transaction', { status: 'DELIVERED', receiverValueConfirmed: true,
      deliveredValue: 805, deliveredCurrency: 'JMD', receiverDiscrepancy: true, deliveredAt: timestamp.toISOString() });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(updateMany.mock.calls[0]![0]).toMatchObject({ where: { id: 'transaction', OR: [{ deliveredAt: null }, { receiverValueConfirmed: false }] } });
    expect(value.receiverQuote).toEqual(receiverQuote);
    expect(value.deliveredValue).toBe(805);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { transactionId: 'transaction' }, update: {},
      create: expect.objectContaining({ amount: 805, currency: 'JMD', status: 'PENDING' }) }));
  });
  it('never presents a legacy quoted value as provider-confirmed delivery', async () => {
    const repository = new PrismaMobileTopUpRepository({ mobileTopUpTransaction: {
      findUnique: async () => ({ ...row, status: 'DELIVERED', deliveredValue: new Prisma.Decimal(800) }),
    } } as never);
    expect((await repository.getTransactionById('transaction'))?.deliveredValue).toBeUndefined();
  });
  it('uses a conditional database claim to exclude delivered and ambiguous SMS retries', async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const repository = new PrismaMobileTopUpRepository({ rechargeNotification: { updateMany } } as never);
    expect(await repository.claimNotification('transaction', timestamp.toISOString())).toBe(true);
    expect(updateMany.mock.calls[0]![0]).toMatchObject({ where: { transactionId: 'transaction', transaction: { status: 'DELIVERED', receiverValueConfirmed: true }, OR: [
      { status: 'PENDING', claimedAt: null },
      { status: 'FAILED', lastErrorCategory: { in: ['SMS_NOT_CONFIGURED', 'PROVIDER_REJECTED'] } },
    ] }, data: { attempts: { increment: 1 }, claimedAt: timestamp, status: 'PENDING' } });
  });
  it('reads legacy NULL metadata without relabeling existing payment records', async () => {
    const repository=new PrismaMobileTopUpRepository({mobileTopUpTransaction:{findUnique:vi.fn(async()=>row)}} as never);
    expect(await repository.getTransactionById('transaction')).toMatchObject({paymentStatus:'AUTHORIZED',paymentAuthorizationId:'old-authorization',paymentProvider:undefined,paymentMethod:undefined,totalChargeUsd:5.99});
  });
  it('claims fulfillment with one conditional database write and no application-only lock', async () => {
    const updateMany=vi.fn().mockResolvedValueOnce({count:1}).mockResolvedValueOnce({count:0});
    const repository=new PrismaMobileTopUpRepository({mobileTopUpTransaction:{updateMany}} as never);
    expect(await repository.claimOperation('transaction','fulfillment',timestamp.toISOString())).toBe(true);
    expect(await repository.claimOperation('transaction','fulfillment',timestamp.toISOString())).toBe(false);
    expect(updateMany.mock.calls[0][0]).toMatchObject({where:{id:'transaction',fulfillmentStartedAt:null,providerTransactionId:null,status:'PENDING',OR:[
      {paymentProvider:'MOCK',paymentStatus:{in:['AUTHORIZED','CAPTURED']}},{paymentProvider:'STRIPE',paymentStatus:{in:['AUTHORIZED','CAPTURED']}},
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
    expect(upsert.mock.calls[0][0].create).toEqual({provider:'STRIPE',eventId:'evt_one',payloadHash:'hash',transactionId:'transaction'});
  });
  it('payment transitions constrain both prior state and bound provider payment ID', async () => {
    const updateMany=vi.fn(async()=>({count:0}));const repository=new PrismaMobileTopUpRepository({mobileTopUpTransaction:{updateMany}} as never);
    expect(await repository.transitionPayment('transaction',['SESSION_CREATED','AUTHORIZED'],{paymentStatus:'CAPTURED',paymentProviderTransactionId:'pay_one'})).toBe(false);
    expect(updateMany.mock.calls[0][0]).toMatchObject({where:{id:'transaction',paymentStatus:{in:['SESSION_CREATED','AUTHORIZED']},OR:[{paymentProviderTransactionId:null},{paymentProviderTransactionId:'pay_one'}]}});
  });

  it.each([
    { label: 'sandbox', testMode: true },
    { label: 'production', testMode: false },
  ])('persists %s testMode into quote and transaction writes', async ({ testMode }) => {
    const quoteRow = { ...row, id: 'quote', expiresAt: timestamp, consumedAt: null, testMode };
    const quoteCreate = vi.fn(async () => quoteRow);
    const transactionCreate = vi.fn(async () => ({ ...row, testMode }));
    const repository = new PrismaMobileTopUpRepository({
      mobileTopUpQuote: { create: quoteCreate },
      mobileTopUpTransaction: { findUnique: vi.fn(async () => null) },
      $transaction: async (fn: (tx: unknown) => unknown) => fn({
        mobileTopUpQuote: { updateMany: vi.fn(async () => ({ count: 1 })) },
        mobileTopUpTransaction: { create: transactionCreate },
      }),
    } as never);

    const quote = await repository.createQuote({
      userId: 'customer',
      countryCode: 'JM',
      recipientPhone: '+18765551234',
      operatorId: 77,
      operatorName: 'Fixture',
      productId: 'reloadly:JM:77:airtime:5.00',
      productName: 'Fixture product',
      kind: 'AIRTIME',
      providerAmount: 5,
      providerCurrency: 'USD',
      deliveredCurrency: 'JMD',
      feeUsd: 0.99,
      totalChargeUsd: 5.99,
      testMode,
      expiresAt: timestamp.toISOString(),
    });

    await repository.reserveTransaction({
      ...quote,
      id: 'transaction',
      quoteId: quote.id,
      idempotencyKey: 'fixture-key',
      requestHash: 'hash',
      customIdentifier: 'fixture-reference',
      status: 'PENDING',
      paymentStatus: 'AUTHORIZED',
      paymentEnvironment: testMode ? 'SANDBOX' : 'PRODUCTION',
      rechargeEnvironment: testMode ? 'SANDBOX' : 'PRODUCTION',
      updatedAt: timestamp.toISOString(),
    });

    expect(quoteCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ testMode }) });
    expect(transactionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ testMode }) });
  });

  it('keeps historical sandbox ledger account keys for delivered/refunded entries', async () => {
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'delivered-ledger' });
    const upsert = vi.fn(async ({ where }: { where: { key: string } }) => ({ id: where.key, key: where.key }));
    const findUniqueOrThrow = vi.fn(async ({ where }: { where: { key: string } }) => ({ id: where.key, key: where.key }));
    const create = vi.fn(async () => ({ id: 'ledger-transaction' }));
    const createMany = vi.fn(async () => ({ count: 3 }));
    const repository = new PrismaMobileTopUpRepository({
      $transaction: async (fn: (tx: unknown) => unknown) => fn({
        ledgerTransaction: { findUnique, create },
        ledgerAccount: { upsert, findUniqueOrThrow },
        ledgerEntry: { createMany },
      }),
    } as never);

    const sandboxRecord = {
      id: 'transaction',
      providerAmount: 5,
      totalChargeUsd: 5.99,
      feeUsd: 0.99,
      rechargeEnvironment: 'SANDBOX',
    } as MobileTopUpTransactionRecord;

    await repository.postDeliveredLedger(sandboxRecord);
    await repository.postRefundLedger(sandboxRecord);

    const upsertKeys = upsert.mock.calls.map(call => call[0].where.key);
    const refundLookupKeys = findUniqueOrThrow.mock.calls.map(call => call[0].where.key);
    expect(upsertKeys).toEqual([
      'TOPUP_TEST_PAYMENT_CLEARING_USD',
      'TOPUP_PROVIDER_SETTLEMENT_USD',
      'TOPUP_FEE_REVENUE_USD',
    ]);
    expect(refundLookupKeys).toEqual([
      'TOPUP_TEST_PAYMENT_CLEARING_USD',
      'TOPUP_PROVIDER_SETTLEMENT_USD',
      'TOPUP_FEE_REVENUE_USD',
    ]);
    expect([...upsertKeys, ...refundLookupKeys]).not.toContain('TOPUP_PRODUCTION_PAYMENT_CLEARING_USD');
    expect(createMany).toHaveBeenCalledTimes(2);
  });

  it('uses production-only ledger keys and never writes to sandbox accounts for production entries', async () => {
    const findUnique = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'delivered-ledger' });
    const upsert = vi.fn(async ({ where }: { where: { key: string } }) => ({ id: where.key, key: where.key }));
    const findUniqueOrThrow = vi.fn(async ({ where }: { where: { key: string } }) => ({ id: where.key, key: where.key }));
    const create = vi.fn(async () => ({ id: 'ledger-transaction' }));
    const createMany = vi.fn(async () => ({ count: 3 }));
    const repository = new PrismaMobileTopUpRepository({
      $transaction: async (fn: (tx: unknown) => unknown) => fn({
        ledgerTransaction: { findUnique, create },
        ledgerAccount: { upsert, findUniqueOrThrow },
        ledgerEntry: { createMany },
      }),
    } as never);

    const productionRecord = {
      id: 'transaction-production',
      providerAmount: 5,
      totalChargeUsd: 5.99,
      feeUsd: 0.99,
      rechargeEnvironment: 'PRODUCTION',
    } as MobileTopUpTransactionRecord;

    await repository.postDeliveredLedger(productionRecord);
    await repository.postRefundLedger(productionRecord);

    const keys = [
      ...upsert.mock.calls.map(call => call[0].where.key),
      ...findUniqueOrThrow.mock.calls.map(call => call[0].where.key),
    ];
    expect(keys).toContain('TOPUP_PRODUCTION_PAYMENT_CLEARING_USD');
    expect(keys).toContain('TOPUP_PRODUCTION_PROVIDER_SETTLEMENT_USD');
    expect(keys).toContain('TOPUP_PRODUCTION_FEE_REVENUE_USD');
    expect(keys).not.toContain('TOPUP_TEST_PAYMENT_CLEARING_USD');
    expect(keys).not.toContain('TOPUP_PROVIDER_SETTLEMENT_USD');
    expect(keys).not.toContain('TOPUP_FEE_REVENUE_USD');
    expect(createMany).toHaveBeenCalledTimes(2);
  });
});
