import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MobileTopUpError, type MobileTopUpProduct, type MobileTopUpOperator } from './types.js';
const cents = z.number().finite().positive().refine(n => Math.abs(n * 100 - Math.round(n * 100)) < 1e-7);
const text = z.string().trim().min(1).max(1000);
const schema = z.object({
  id: z.string().min(1).max(240), provider: z.enum(['RELOADLY', 'DTONE', 'DING']),
  providerProductId: z.string().min(1).max(140).optional(), classification: z.enum(['AIRTIME', 'DATA', 'BUNDLE']),
  countryCode: z.string().regex(/^[A-Z]{2}$/), operatorId: z.number().int().positive(),
  kind: z.enum(['AIRTIME', 'DATA']), name: text, description: text.optional(), price: cents, priceCurrency: z.literal('USD'),
  deliveredValue: z.number().finite().nonnegative().optional(), deliveredCurrency: z.string().regex(/^(?:[A-Z]{3})?$/),
  amountType: z.enum(['FIXED', 'RANGE']), minimumAmount: cents.optional(), maximumAmount: cents.optional(),
  benefits: z.array(z.object({ type: z.enum(['DATA', 'MINUTES', 'SMS']), amount: z.number().finite().refine(n => n >= 0 || n === -1), unit: z.string().regex(/^[A-Z_]{1,24}$/) })).max(20).optional(),
  validity: z.object({ quantity: z.number().int().refine(n => n > 0 || n === -1), unit: z.enum(['HOUR', 'DAY', 'WEEK', 'MONTH', 'YEAR']), semantics: z.enum(['SERVICE', 'REDEMPTION']) }).optional(),
  redemptionPeriodIso: z.string().regex(/^P(?=.+)(?:\d+Y)?(?:\d+M)?(?:\d+D)?(?:T(?=.+)(?:\d+H)?(?:\d+M)?(?:\d+S)?)?$/).optional(),
});
export function normalizeProduct(value: MobileTopUpProduct): MobileTopUpProduct {
  const parsed = schema.safeParse({ ...value, classification: value.classification ?? value.kind });
  if (!parsed.success) throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Invalid provider product metadata', 502);
  const p = parsed.data;
  if ((p.provider !== 'RELOADLY' && !p.providerProductId) || p.kind !== (p.classification === 'AIRTIME' ? 'AIRTIME' : 'DATA') ||
      (p.amountType === 'RANGE' && (p.classification !== 'AIRTIME' || p.provider !== 'RELOADLY' || !p.minimumAmount || !p.maximumAmount || p.minimumAmount > p.maximumAmount))) {
    throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Unsupported provider product semantics', 502);
  }
  return { ...p, catalogVersion: createHash('sha256').update(JSON.stringify(p)).digest('hex') };
}
export function assertSameProduct(expected: MobileTopUpProduct, current: MobileTopUpProduct) {
  if (normalizeProduct(expected).catalogVersion !== normalizeProduct(current).catalogVersion) {
    throw new MobileTopUpError('TOPUP_QUOTE_CHANGED', 'The product changed. Request and review a new quote', 400);
  }
}
export function reloadlyProducts(operator: MobileTopUpOperator): MobileTopUpProduct[] {
  if (operator.provider && operator.provider !== 'RELOADLY') return [];
  if (operator.senderCurrencyCode !== 'USD' || !/^[A-Z]{3}$/.test(operator.destinationCurrencyCode)) return [];
  const classification = operator.bundle || operator.combo ? 'BUNDLE' : operator.data ? 'DATA' : 'AIRTIME';
  const kind = classification === 'AIRTIME' ? 'AIRTIME' : 'DATA';
  const base = { provider: 'RELOADLY' as const, countryCode: operator.countryCode, operatorId: operator.id, classification, kind,
    priceCurrency: 'USD', deliveredCurrency: operator.destinationCurrencyCode } as const;
  if (operator.denominationType === 'RANGE') {
    if (classification !== 'AIRTIME') return [];
    if (!Number.isFinite(operator.minAmount) || !Number.isFinite(operator.maxAmount) || operator.minAmount! <= 0 || operator.maxAmount! < operator.minAmount!) {
      throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Missing provider range limits', 502);
    }
    const minimumAmount = Math.max(5, operator.minAmount!); const maximumAmount = Math.min(100, operator.maxAmount!);
    if (minimumAmount > maximumAmount) return [];
    return [{ ...base, id: `reloadly:${operator.countryCode}:${operator.id}:airtime:range`, name: operator.name,
      price: minimumAmount, amountType: 'RANGE', minimumAmount, maximumAmount }];
  }
  return operator.fixedAmounts.flatMap((amount, index) => {
    const plan = [String(amount), amount.toFixed(2), amount.toFixed(1)].map(key => operator.fixedAmountsPlanNames[key]).find(Boolean);
    // A provider-labelled plan on an operator lacking explicit type metadata is ambiguous.
    if (plan && classification === 'AIRTIME' || classification !== 'AIRTIME' && !plan) return [];
    const delivered = operator.localFixedAmounts[index];
    return [{ ...base, id: `reloadly:${operator.countryCode}:${operator.id}:${kind.toLowerCase()}:${amount.toFixed(2)}`,
      name: plan ?? `${operator.name} ${amount.toFixed(2)} USD`, price: amount, amountType: 'FIXED' as const,
      ...(typeof delivered === 'number' && Number.isFinite(delivered) && delivered > 0 ? { deliveredValue: delivered } : {}) }];
  });
}
