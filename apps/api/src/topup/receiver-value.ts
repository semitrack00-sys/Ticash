import { Prisma } from '@prisma/client';
import { MobileTopUpError, type MobileTopUpProduct } from './types.js';

export interface ReceiverQuote {
  amount: number;
  currency: string;
  senderAmount: number;
  senderCurrency: string;
  source: 'PROVIDER_PRODUCT' | 'RELOADLY_FX';
  quotedAt: string;
  preferredLanguage?: string;
}

export function validReceiverValue(amount: unknown, currency: unknown): amount is number {
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0 &&
    amount < 1e12 && new Prisma.Decimal(amount).decimalPlaces() <= 8 && typeof currency === 'string' && /^[A-Z]{3}$/.test(currency);
}

export function productReceiverQuote(product: MobileTopUpProduct, amount: number): ReceiverQuote {
  if (product.amountType !== 'FIXED' || product.price !== amount ||
      !validReceiverValue(product.deliveredValue, product.deliveredCurrency)) {
    throw new MobileTopUpError('RECEIVER_VALUE_UNAVAILABLE', 'The provider has not supplied a receiving value for this amount', 502);
  }
  return { amount: product.deliveredValue, currency: product.deliveredCurrency,
    senderAmount: amount, senderCurrency: product.priceCurrency,
    source: 'PROVIDER_PRODUCT', quotedAt: new Date().toISOString() };
}

export function validateReceiverQuote(value: ReceiverQuote, product: MobileTopUpProduct, amount: number) {
  if (!validReceiverValue(value.amount, value.currency) || value.currency !== product.deliveredCurrency ||
      value.senderAmount !== amount || value.senderCurrency !== product.priceCurrency ||
      !Number.isFinite(Date.parse(value.quotedAt))) {
    throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Provider receiving value does not match the selected product', 502);
  }
  return value;
}
