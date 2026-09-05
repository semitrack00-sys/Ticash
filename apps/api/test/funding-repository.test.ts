import { Prisma, type PrismaClient } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PrismaFundingRepository } from '../src/funding/repository.js';

type LedgerPosting = {
  accountId: string;
  direction: 'DEBIT' | 'CREDIT';
  amount: Prisma.Decimal;
  currency: string;
};

describe('Dwolla funding ledger reconciliation', () => {
  it('posts balanced, idempotent settlement and ACH-return reversal entries', async () => {
    const ledgerTransactions = new Map<string, {
      id: string;
      reference: string;
      entries: LedgerPosting[];
    }>();
    const now = new Date();
    const funding = {
      id: 'funding-1',
      userId: 'user-1',
      fundingSourceId: 'source-1',
      provider: 'DWOLLA' as const,
      amount: new Prisma.Decimal('25.00'),
      currency: 'USD',
      status: 'PROCESSING' as string,
      idempotencyKey: 'funding-key-1',
      requestHash: 'request-hash',
      providerTransferId: 'provider-transfer-1',
      providerTransferUrl: 'https://api-sandbox.dwolla.com/transfers/provider-transfer-1',
      failureCode: null as string | null,
      createdAt: now,
      updatedAt: now,
      completedAt: null as Date | null,
      cancelledAt: null as Date | null,
      reversedAt: null as Date | null,
    };
    const transactionClient = {
      fundingTransaction: {
        findUnique: async () => funding,
        update: async (input: {
          data: {
            status: string;
            failureCode?: string;
            completedAt?: Date | null;
            cancelledAt?: Date | null;
            reversedAt?: Date | null;
          };
        }) => {
          funding.status = input.data.status;
          funding.failureCode = input.data.failureCode ?? null;
          funding.completedAt = input.data.completedAt ?? funding.completedAt;
          funding.cancelledAt = input.data.cancelledAt ?? funding.cancelledAt;
          funding.reversedAt = input.data.reversedAt ?? funding.reversedAt;
          funding.updatedAt = new Date();
          return funding;
        },
      },
      ledgerTransaction: {
        findUnique: async (input: { where: { reference: string } }) =>
          ledgerTransactions.get(input.where.reference),
        create: async (input: {
          data: {
            reference: string;
            entries: { create: LedgerPosting[] };
          };
        }) => {
          const row = {
            id: `ledger-${ledgerTransactions.size + 1}`,
            reference: input.data.reference,
            entries: input.data.entries.create,
          };
          ledgerTransactions.set(row.reference, row);
          return row;
        },
      },
      ledgerAccount: {
        upsert: async (input: { where: { key: string } }) => ({
          id: input.where.key,
          key: input.where.key,
        }),
      },
    };
    const prisma = {
      $transaction: async <T>(callback: (client: typeof transactionClient) => Promise<T>) =>
        callback(transactionClient),
    } as unknown as PrismaClient;
    const repository = new PrismaFundingRepository(prisma);

    const settled = await repository.applyProviderStatus('funding-1', 'COMPLETED');
    expect(settled.status).toBe('COMPLETED');
    await repository.applyProviderStatus('funding-1', 'COMPLETED');
    expect(ledgerTransactions.size).toBe(1);

    const reversed = await repository.applyProviderStatus('funding-1', 'FAILED', 'R01');
    expect(reversed).toMatchObject({ status: 'REVERSED', failureCode: 'R01' });
    await repository.applyProviderStatus('funding-1', 'FAILED', 'R01');
    expect(ledgerTransactions.size).toBe(2);

    for (const transaction of ledgerTransactions.values()) {
      const debits = transaction.entries
        .filter((entry) => entry.direction === 'DEBIT')
        .reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));
      const credits = transaction.entries
        .filter((entry) => entry.direction === 'CREDIT')
        .reduce((sum, entry) => sum.plus(entry.amount), new Prisma.Decimal(0));
      expect(debits.equals(credits)).toBe(true);
      expect(transaction.entries.every((entry) => entry.currency === 'USD')).toBe(true);
    }
  });
});
