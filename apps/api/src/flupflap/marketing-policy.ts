import { randomBytes } from 'node:crypto';
import { z } from 'zod';

// Public campaign codes are identifiers, never credentials or customer identifiers.
export const promotionCode = z.string().trim().transform(v => v.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_-]{5,31}$/));
export const referralCode = z.string().regex(/^[a-f0-9]{32}$/);
export const newReferralCode = () => randomBytes(16).toString('hex');
export const newPromotionCode = () => randomBytes(10).toString('hex').toUpperCase();
const cents = z.number().int().min(0).max(10000);
const benefit = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NONE') }).strict(),
  z.object({ type: z.enum(['FEE_CREDIT', 'FIXED_DISCOUNT', 'REDUCED_FEE']), cents }).strict(),
  z.object({ type: z.literal('PERCENT_FEE'), basisPoints: z.number().int().min(1).max(10000) }).strict(),
  z.object({ type: z.literal('WAIVED_FEE') }).strict(),
]);
const reward = z.discriminatedUnion('type', [
  z.object({ type: z.literal('NONE') }).strict(),
  z.object({ type: z.enum(['FIXED_CUSTOMER', 'FIXED_RECHARGE']), cents }).strict(),
  z.object({ type: z.literal('PERCENT_FEE'), basisPoints: z.number().int().min(1).max(10000) }).strict(),
  z.object({ type: z.literal('MILESTONE'), cents, every: z.number().int().min(2).max(10000) }).strict(),
]);
export const campaignRules = z.object({
  countries: z.array(z.string().regex(/^[A-Z]{2}$/)).max(300).default([]),
  operators: z.array(z.number().int().positive()).max(1000).default([]),
  products: z.array(z.string().min(1).max(300)).max(1000).default([]),
  customerTypes: z.array(z.enum(['REGISTERED', 'GUEST'])).min(1).default(['REGISTERED']),
  newCustomerOnly: z.boolean().default(true),
  firstRechargeOnly: z.boolean().default(true),
  maxRedemptions: z.number().int().min(1).max(1000000),
  maxPerCustomer: z.number().int().min(1).max(100),
  // This only permits referral attribution alongside ONE campaign, never two discounts.
  allowReferralAttribution: z.boolean().default(false),
  benefit,
  reward,
}).strict();
export type CampaignRules = z.infer<typeof campaignRules>;
export const campaignInput = z.object({
  testMode: z.boolean().default(true),
  name: z.string().trim().min(2).max(120), promoterId: z.uuid(),
  code: promotionCode.optional(),
  startsAt: z.iso.datetime(), endsAt: z.iso.datetime(),
  status: z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'DISABLED', 'EXPIRED', 'REVOKED']).default('DRAFT'),
  rules: campaignRules,
  reason: z.string().trim().min(5).max(300),
}).strict().refine(v => new Date(v.endsAt) > new Date(v.startsAt), 'Expiration must follow start')
  .refine(v => v.testMode || (v.rules.benefit.type === 'NONE' && v.rules.reward.type === 'NONE'), 'Real monetary promotions are not enabled');

export class MarketingError extends Error {
  constructor(public code = 'PROMOTION_UNAVAILABLE', public statusCode = 409) {
    super(code === 'MARKETING_UNAVAILABLE' ? 'Sharing is temporarily unavailable' : 'This promotion cannot be applied');
  }
}

export function promotionEligible(rules: CampaignRules, context: {
  countryCode: string; operatorId: number; productId: string; guest: boolean;
  createdAt: Date; campaignStartsAt: Date; successfulRecharges: number;
  redemptions: number; customerRedemptions: number;
}) {
  return rules.customerTypes.includes(context.guest ? 'GUEST' : 'REGISTERED') &&
    (!rules.newCustomerOnly || context.createdAt >= context.campaignStartsAt) &&
    (!rules.firstRechargeOnly || context.successfulRecharges === 0) &&
    (!rules.countries.length || rules.countries.includes(context.countryCode)) &&
    (!rules.operators.length || rules.operators.includes(context.operatorId)) &&
    (!rules.products.length || rules.products.includes(context.productId)) &&
    context.redemptions < rules.maxRedemptions && context.customerRedemptions < rules.maxPerCustomer;
}

// All supported launch benefits reduce the FlupFlap fee ONLY. No provider principal,
// FX or delivered amount is changed. Wallet credit/principal subsidies need a separately
// approved funded ledger and are deliberately not accepted by this configuration schema.
export function promotionPrice(principalCents: number, feeCents: number, rule: CampaignRules['benefit']) {
  if (![principalCents, feeCents].every(v => Number.isSafeInteger(v) && v >= 0) || principalCents > 10000 || feeCents > 10000) {
    throw new MarketingError();
  }
  const discount = rule.type === 'NONE' ? 0 : rule.type === 'WAIVED_FEE' ? feeCents :
    rule.type === 'PERCENT_FEE' ? Math.floor(feeCents * rule.basisPoints / 10000) :
      rule.type === 'REDUCED_FEE' ? Math.max(0, feeCents - rule.cents) : rule.cents;
  const benefitCents = Math.min(feeCents, discount);
  return { principalCents, originalFeeCents: feeCents, benefitCents,
    feeCents: feeCents - benefitCents, totalCents: principalCents + feeCents - benefitCents, currency: 'USD' as const };
}

export function promoterRewardCents(feeCents: number, rule: CampaignRules['reward'], qualifyingCount: number) {
  if (!Number.isSafeInteger(feeCents) || feeCents < 0 || !Number.isSafeInteger(qualifyingCount) || qualifyingCount < 1) throw new MarketingError();
  if (rule.type === 'NONE') return 0;
  if (rule.type === 'PERCENT_FEE') return Math.floor(feeCents * rule.basisPoints / 10000);
  if (rule.type === 'MILESTONE') return qualifyingCount % rule.every === 0 ? rule.cents : 0;
  return rule.cents;
}

export function rewardTransition(from: string, to: string, reason: string) {
  if (reason.trim().length < 5) throw new MarketingError();
  const transitions: Record<string, string[]> = {
    PENDING: ['APPROVED', 'REVERSED'], APPROVED: ['PAYABLE', 'REVERSED'],
    PAYABLE: ['PAID', 'REVERSED'], PAID: ['REVERSED'], REVERSED: [],
  };
  if (!transitions[from]?.includes(to)) throw new MarketingError();
}

export function shareLink(code: string) {
  return `https://www.flupflap.com/join?r=${referralCode.parse(code)}`;
}
