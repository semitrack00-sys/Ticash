import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';

export interface FxQuoteRecord {
  id: string;
  userId: string;
  provider: string;
  testMode: boolean;
  sendCountry: string;
  receiveCountry: string;
  sourceCurrency: string;
  targetCurrency: string;
  payoutMethod: string;
  sendAmount: Prisma.Decimal;
  exchangeRate: Prisma.Decimal;
  ticashFee: Prisma.Decimal;
  providerFee: Prisma.Decimal;
  totalCustomerCharge: Prisma.Decimal;
  recipientAmount: Prisma.Decimal;
  expiresAt: Date;
  createdAt: Date;
  consumedAt: Date | null;
  configurationVersionId?: string | null;
}

export interface FxQuoteRepository {
  create(input: Omit<FxQuoteRecord, 'id' | 'createdAt' | 'consumedAt'>): Promise<FxQuoteRecord>;
  findById(id: string): Promise<FxQuoteRecord | undefined>;
  consume(id: string, userId: string, now: Date): Promise<boolean>;
}

const memoryQuotes = new Map<string, FxQuoteRecord>();

export function resetFxQuoteStore() {
  memoryQuotes.clear();
}

export class MemoryFxQuoteRepository implements FxQuoteRepository {
  async create(input: Omit<FxQuoteRecord, 'id' | 'createdAt' | 'consumedAt'>) {
    const quote: FxQuoteRecord = {
      ...input,
      id: randomUUID(),
      createdAt: new Date(),
      consumedAt: null,
    };
    memoryQuotes.set(quote.id, quote);
    return quote;
  }

  async findById(id: string) {
    return memoryQuotes.get(id);
  }

  async consume(id: string, userId: string, now: Date) {
    const quote = memoryQuotes.get(id);
    if (!quote || quote.userId !== userId || quote.consumedAt || quote.expiresAt <= now) {
      return false;
    }
    memoryQuotes.set(id, { ...quote, consumedAt: now });
    return true;
  }
}

function quoteFromDb(row: {
  id: string;
  userId: string;
  provider: string;
  testMode: boolean;
  sendCountry: string;
  receiveCountry: string;
  sourceCurrency: string;
  targetCurrency: string;
  payoutMethod: string;
  sendAmount: Prisma.Decimal;
  exchangeRate: Prisma.Decimal;
  ticashFee: Prisma.Decimal;
  providerFee: Prisma.Decimal;
  totalCustomerCharge: Prisma.Decimal;
  recipientAmount: Prisma.Decimal;
  expiresAt: Date;
  createdAt: Date;
  consumedAt: Date | null;
  configurationVersionId?: string | null;
}): FxQuoteRecord {
  return row;
}

export class PrismaFxQuoteRepository implements FxQuoteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: Omit<FxQuoteRecord, 'id' | 'createdAt' | 'consumedAt'>) {
    return quoteFromDb(await this.prisma.fxQuote.create({ data: input }));
  }

  async findById(id: string) {
    const quote = await this.prisma.fxQuote.findUnique({ where: { id } });
    return quote ? quoteFromDb(quote) : undefined;
  }

  async consume(id: string, userId: string, now: Date) {
    const result = await this.prisma.fxQuote.updateMany({
      where: { id, userId, consumedAt: null, expiresAt: { gt: now } },
      data: { consumedAt: now },
    });
    return result.count === 1;
  }
}
