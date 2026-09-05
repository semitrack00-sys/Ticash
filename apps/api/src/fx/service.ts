import { Prisma } from '@prisma/client';
import type { FxQuoteRecord, FxQuoteRepository } from './repository.js';
import { FxError, type FxConfig, type FxCorridor, type FxProvider } from './types.js';

export interface QuoteRequest {
  sendCountry: string;
  receiveCountry: string;
  sourceCurrency: string;
  targetCurrency: string;
  payoutMethod: string;
  sendAmount: number;
  amountCurrency?: 'USD' | 'HTG';
}

export interface PublicFxQuote {
  quoteId: string;
  provider: string;
  testMode: boolean;
  corridor: FxCorridor;
  payoutMethod: string;
  sendAmount: number;
  exchangeRate: number;
  ticashFee: number;
  providerFundingFee: number;
  totalCustomerCharge: number;
  recipientAmount: number;
  expiresAt: string;
  configurationVersionId?: string;
}

export interface QuotePricingConfiguration {
  configurationVersionId?: string;
  ticashFeePercent: string;
  ticashMinimumFeeUsd: string;
  providerFundingFeeUsd: string;
}

const supportedCorridor: FxCorridor = {
  sendCountry: 'US',
  receiveCountry: 'HT',
  sourceCurrency: 'USD',
  targetCurrency: 'HTG',
};

function money(value: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(value).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

function publicQuote(quote: FxQuoteRecord): PublicFxQuote {
  return {
    quoteId: quote.id,
    provider: quote.provider,
    testMode: quote.testMode,
    corridor: {
      sendCountry: quote.sendCountry,
      receiveCountry: quote.receiveCountry,
      sourceCurrency: quote.sourceCurrency,
      targetCurrency: quote.targetCurrency,
    },
    payoutMethod: quote.payoutMethod,
    sendAmount: quote.sendAmount.toNumber(),
    exchangeRate: quote.exchangeRate.toNumber(),
    ticashFee: quote.ticashFee.toNumber(),
    providerFundingFee: quote.providerFee.toNumber(),
    totalCustomerCharge: quote.totalCustomerCharge.toNumber(),
    recipientAmount: quote.recipientAmount.toNumber(),
    expiresAt: quote.expiresAt.toISOString(),
    configurationVersionId: quote.configurationVersionId ?? undefined,
  };
}

export class FxService {
  constructor(
    private readonly config: FxConfig,
    private readonly repository: FxQuoteRepository,
    private readonly provider?: FxProvider,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  availability() {
    return {
      mode: this.config.mode,
      provider: this.config.mode === 'mock' ? 'mock_test_fx' : null,
      testMode: this.config.mode === 'mock',
      corridor: supportedCorridor,
    };
  }

  private assertSupported(input: QuoteRequest) {
    if (
      input.sendCountry !== supportedCorridor.sendCountry ||
      input.receiveCountry !== supportedCorridor.receiveCountry ||
      input.sourceCurrency !== supportedCorridor.sourceCurrency ||
      input.targetCurrency !== supportedCorridor.targetCurrency
    ) {
      throw new FxError('UNSUPPORTED_CORRIDOR', 'Only the U.S. to Haiti USD/HTG corridor is available', 422);
    }
  }

  async createQuote(userId: string, input: QuoteRequest, pricing?: QuotePricingConfiguration): Promise<PublicFxQuote> {
    this.assertSupported(input);
    if (this.config.mode === 'disabled' || !this.provider) {
      throw new FxError('FX_UNAVAILABLE', 'FX quoting is not configured', 503);
    }
    const now = this.clock();
    const enteredAmount = money(input.sendAmount.toString());
    if (!enteredAmount.equals(new Prisma.Decimal(input.sendAmount.toString()))) {
      throw new FxError('INVALID_SEND_AMOUNT', 'Amount must have no more than two decimal places', 400);
    }
    const rateResult = await this.provider.getRate({
      corridor: supportedCorridor,
      sendAmount: (input.amountCurrency ?? 'USD') === 'USD' ? enteredAmount.toFixed(2) : '1.00',
      requestedAt: now,
    });
    const exchangeRate = new Prisma.Decimal(rateResult.rate)
      .toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP);
    if (!exchangeRate.isPositive()) {
      throw new FxError('INVALID_FX_RATE', 'FX provider returned an invalid exchange rate', 502);
    }
    const sendAmount = (input.amountCurrency ?? 'USD') === 'HTG'
      ? enteredAmount.div(exchangeRate).toDecimalPlaces(2, Prisma.Decimal.ROUND_CEIL)
      : enteredAmount;
    if (sendAmount.greaterThan(5000)) throw new FxError('SEND_LIMIT_EXCEEDED', 'Send amount exceeds the $5,000 sandbox limit', 422);
    const percentageFee = sendAmount
      .mul(pricing?.ticashFeePercent ?? this.config.ticashFeePercent)
      .div(100);
    const ticashFee = money(Prisma.Decimal.max(
      percentageFee,
      new Prisma.Decimal(pricing?.ticashMinimumFeeUsd ?? this.config.ticashMinimumFeeUsd),
    ));
    const providerFee = money(pricing?.providerFundingFeeUsd ?? this.config.providerFundingFeeUsd);
    const recipientAmount = (input.amountCurrency ?? 'USD') === 'HTG' ? enteredAmount : money(sendAmount.mul(exchangeRate));
    const totalCustomerCharge = money(sendAmount.plus(ticashFee).plus(providerFee));
    const configuredExpiry = new Date(now.getTime() + this.config.quoteTtlSeconds * 1000);
    const expiresAt = rateResult.expiresAt && rateResult.expiresAt < configuredExpiry
      ? rateResult.expiresAt
      : configuredExpiry;
    const stored = await this.repository.create({
      userId,
      provider: rateResult.provider,
      testMode: rateResult.testMode,
      ...supportedCorridor,
      payoutMethod: input.payoutMethod,
      sendAmount,
      exchangeRate,
      ticashFee,
      providerFee,
      totalCustomerCharge,
      recipientAmount,
      expiresAt,
      configurationVersionId: pricing?.configurationVersionId ?? null,
    });
    return publicQuote(stored);
  }

  async consumeQuote(userId: string, quoteId: string, input: QuoteRequest): Promise<FxQuoteRecord> {
    this.assertSupported(input);
    const quote = await this.repository.findById(quoteId);
    if (!quote || quote.userId !== userId) {
      throw new FxError('QUOTE_NOT_FOUND', 'Quote was not found', 404);
    }
    const now = this.clock();
    if (quote.expiresAt <= now) {
      throw new FxError('QUOTE_EXPIRED', 'Quote has expired; request a new quote', 410);
    }
    if (quote.consumedAt) {
      throw new FxError('QUOTE_ALREADY_USED', 'Quote has already been submitted', 409);
    }
    const rawRequestedAmount = new Prisma.Decimal(input.sendAmount.toString());
    const requestedAmount = money(rawRequestedAmount);
    if (!requestedAmount.equals(rawRequestedAmount)) {
      throw new FxError('INVALID_SEND_AMOUNT', 'Send amount must have no more than two decimal places', 400);
    }
    const matches = quote.sendCountry === input.sendCountry &&
      quote.receiveCountry === input.receiveCountry &&
      quote.sourceCurrency === input.sourceCurrency &&
      quote.targetCurrency === input.targetCurrency &&
      quote.payoutMethod === input.payoutMethod &&
      ((input.amountCurrency ?? 'USD') === 'HTG'
        ? quote.recipientAmount.equals(requestedAmount)
        : quote.sendAmount.equals(requestedAmount));
    if (!matches) {
      throw new FxError('QUOTE_MISMATCH', 'Submitted transfer does not match the server quote', 409);
    }
    if (!await this.repository.consume(quote.id, userId, now)) {
      const latest = await this.repository.findById(quote.id);
      if (latest?.expiresAt && latest.expiresAt <= now) {
        throw new FxError('QUOTE_EXPIRED', 'Quote has expired; request a new quote', 410);
      }
      throw new FxError('QUOTE_ALREADY_USED', 'Quote has already been submitted', 409);
    }
    return quote;
  }
}
