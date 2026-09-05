import type { PrismaClient } from '@prisma/client';

export interface ReconciliationEntry {
  direction: 'DEBIT' | 'CREDIT';
  amount: number;
  currency: string;
}

export interface ReconciliationTransaction {
  id: string;
  reference: string;
  entries: ReconciliationEntry[];
}

export interface ReconciliationDiscrepancy {
  code: string;
  entity: string;
  entityId?: string;
  expected?: string;
  actual?: string;
}

export interface ProviderReconciliationRecord {
  providerTransactionId: string;
  status: string;
  amount: number;
  currency: string;
}

export interface ProviderReconciliationSource {
  listRecords(input: { from: Date; to: Date }): Promise<ProviderReconciliationRecord[]>;
}

export function detectLedgerImbalances(transactions: ReconciliationTransaction[]): ReconciliationDiscrepancy[] {
  const discrepancies: ReconciliationDiscrepancy[] = [];
  for (const transaction of transactions) {
    const currencies = new Set(transaction.entries.map((entry) => entry.currency));
    for (const currency of currencies) {
      const entries = transaction.entries.filter((entry) => entry.currency === currency);
      const debits = entries.filter((entry) => entry.direction === 'DEBIT').reduce((sum, entry) => sum + entry.amount, 0);
      const credits = entries.filter((entry) => entry.direction === 'CREDIT').reduce((sum, entry) => sum + entry.amount, 0);
      if (Math.abs(debits - credits) > 0.0001) {
        discrepancies.push({
          code: 'LEDGER_TRANSACTION_IMBALANCE',
          entity: 'LedgerTransaction',
          entityId: transaction.id,
          expected: `${debits.toFixed(2)} ${currency} credits`,
          actual: `${credits.toFixed(2)} ${currency} credits`,
        });
      }
    }
  }
  return discrepancies;
}

export async function runPrismaReconciliation(
  prisma: PrismaClient,
  createdByUserId?: string,
  providerSource?: ProviderReconciliationSource,
) {
  const startedAt = new Date();
  const [ledgerRows, fundingRows] = await Promise.all([
    prisma.ledgerTransaction.findMany({ include: { entries: true } }),
    prisma.fundingTransaction.findMany({ select: {
      id: true, status: true, providerTransferId: true, amount: true, currency: true,
    } }),
  ]);
  const discrepancies = detectLedgerImbalances(ledgerRows.map((row) => ({
    id: row.id,
    reference: row.reference,
    entries: row.entries.map((entry) => ({
      direction: entry.direction,
      amount: Number(entry.amount),
      currency: entry.currency,
    })),
  })));
  const references = new Set(ledgerRows.map((row) => row.reference));
  for (const funding of fundingRows) {
    if (funding.status === 'COMPLETED' && !references.has(`dwolla-funding:${funding.id}:settled`)) {
      discrepancies.push({
        code: 'MISSING_FUNDING_SETTLEMENT_LEDGER',
        entity: 'FundingTransaction', entityId: funding.id,
        expected: 'settlement ledger transaction', actual: 'missing',
      });
    }
  }
  if (!providerSource) {
    discrepancies.push({
      code: 'PROVIDER_RECONCILIATION_NOT_CONFIGURED',
      entity: 'FundingProvider',
      expected: 'authoritative provider settlement records',
      actual: 'provider reconciliation source unavailable',
    });
  } else {
    const records = await providerSource.listRecords({ from: new Date(0), to: new Date() });
    const byProviderId = new Map(records.map((record) => [record.providerTransactionId, record]));
    for (const funding of fundingRows.filter((row) => row.providerTransferId)) {
      const remote = byProviderId.get(funding.providerTransferId!);
      if (!remote) {
        discrepancies.push({ code: 'PROVIDER_RECORD_MISSING', entity: 'FundingTransaction', entityId: funding.id });
        continue;
      }
      if (remote.currency !== funding.currency || Math.abs(remote.amount - Number(funding.amount)) > 0.0001) {
        discrepancies.push({
          code: 'PROVIDER_AMOUNT_MISMATCH', entity: 'FundingTransaction', entityId: funding.id,
          expected: `${Number(funding.amount).toFixed(2)} ${funding.currency}`,
          actual: `${remote.amount.toFixed(2)} ${remote.currency}`,
        });
      }
      if (remote.status !== funding.status) {
        discrepancies.push({
          code: 'PROVIDER_STATUS_MISMATCH', entity: 'FundingTransaction', entityId: funding.id,
          expected: funding.status, actual: remote.status,
        });
      }
    }
  }
  const run = await prisma.reconciliationRun.create({
    data: {
      provider: 'INTERNAL_LEDGER_WITH_PROVIDER_CHECK',
      status: discrepancies.length ? 'DISCREPANCIES_FOUND' : 'PASS',
      discrepancyCount: discrepancies.length,
      completedAt: new Date(),
      createdByUserId,
      summary: { startedAt: startedAt.toISOString(), autoCorrected: false },
      discrepancies: { create: discrepancies },
    },
    include: { discrepancies: true },
  });
  return run;
}
