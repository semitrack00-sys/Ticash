import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { PrismaMobileTopUpRepository } from '../src/topup/repository.js';

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
    expect(quote).not.toHaveProperty('countryCode');
    expect(quote).toMatchObject({
      id: 'quote-id',
      providerAmount: 4,
      feeUsd: 0,
      totalChargeUsd: 4,
    });
  });
});
