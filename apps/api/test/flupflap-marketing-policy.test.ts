import { describe, expect, it } from 'vitest';
import { campaignInput, campaignRules, newPromotionCode, newReferralCode, promotionCode, promotionEligible,
  promotionPrice, promoterRewardCents, rewardTransition, shareLink } from '../src/flupflap/marketing-policy.js';

export const rules = campaignRules.parse({ maxRedemptions: 10, maxPerCustomer: 1,
  benefit: { type: 'FIXED_DISCOUNT', cents: 50 }, reward: { type: 'FIXED_CUSTOMER', cents: 25 } });
const context = { countryCode: 'HT', operatorId: 7, productId: 'provider-backed-product', guest: false,
  createdAt: new Date('2026-09-30'), campaignStartsAt: new Date('2026-09-29'), successfulRecharges: 0,
  redemptions: 0, customerRedemptions: 0 };

describe('FlupFlap campaign policy', () => {
  it('generates opaque, nonsequential, URL-safe codes without customer input', () => {
    const codes = Array.from({ length: 100 }, newReferralCode);
    expect(new Set(codes).size).toBe(100);
    expect(codes.every(c => /^[a-f0-9]{32}$/.test(c))).toBe(true);
    expect(shareLink(codes[0])).toBe(`https://www.flupflap.com/join?r=${codes[0]}`);
    expect(promotionCode.parse(newPromotionCode())).toMatch(/^[A-F0-9]{20}$/);
  });
  it('normalizes manual codes but rejects malicious, oversized and ambiguous inputs', () => {
    expect(promotionCode.parse(' jean20 ')).toBe('JEAN20');
    for (const v of ['//evil', '<script>', 'A'.repeat(33), 'éééééé', 'abc def', 'https://evil']) expect(promotionCode.safeParse(v).success).toBe(false);
  });
  it('accepts an eligible first recharge with explicit server context', () => expect(promotionEligible(rules, context)).toBe(true));
  it.each([
    { guest: true }, { redemptions: 10 }, { customerRedemptions: 1 }, { successfulRecharges: 1 },
    { createdAt: new Date('2020-01-01') },
  ])('rejects ineligible customer/caps/first recharge %j', change => expect(promotionEligible(rules, { ...context, ...change })).toBe(false));
  it.each([
    { countries: ['JM'] }, { operators: [8] }, { products: ['invented'] },
  ])('enforces provider-backed country/operator/product restrictions %j', change => expect(promotionEligible({ ...rules, ...change }, context)).toBe(false));
  it.each([
    [{ type: 'NONE' }, 0], [{ type: 'FIXED_DISCOUNT', cents: 50 }, 50], [{ type: 'FEE_CREDIT', cents: 9999 }, 179],
    [{ type: 'PERCENT_FEE', basisPoints: 2500 }, 44], [{ type: 'REDUCED_FEE', cents: 100 }, 79], [{ type: 'WAIVED_FEE' }, 179],
  ] as const)('uses integer cents and never discounts provider principal: %j', (benefit, discount) => {
    expect(promotionPrice(1500, 179, benefit)).toEqual({ principalCents: 1500, originalFeeCents: 179,
      benefitCents: discount, feeCents: 179 - discount, totalCents: 1679 - discount, currency: 'USD' });
  });
  it.each([NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects invalid money %s', value => expect(() => promotionPrice(value, 99, rules.benefit)).toThrow());
  it('does not accept browser amounts, unknown benefit types, payout or principal subsidies', () => {
    for (const extra of [{ fee: 0 }, { rewardCents: 999 }, { principalSubsidy: true }, { allowStacking: true }]) expect(campaignRules.safeParse({ ...rules, ...extra }).success).toBe(false);
    expect(campaignRules.safeParse({ ...rules, benefit: { type: 'UNLIMITED_WALLET_CREDIT' } }).success).toBe(false);
  });
  it('cannot activate monetary campaigns in production', () => {
    const input = { name: 'Campaign', promoterId: 'f52b903f-0e75-46fb-a448-4dc0ad975001',
      startsAt: '2026-09-29T00:00:00Z', endsAt: '2026-10-29T00:00:00Z', rules, reason: 'Approved test campaign' };
    expect(campaignInput.parse(input).testMode).toBe(true);
    expect(campaignInput.safeParse({ ...input, testMode: false, status: 'ACTIVE' }).success).toBe(false);
    expect(campaignInput.safeParse({ ...input, testMode: false, rules: { ...rules, benefit: { type: 'NONE' }, reward: { type: 'NONE' } } }).success).toBe(true);
  });
  it('calculates compensation separately from customer benefits using fee revenue only', () => {
    expect(promoterRewardCents(129, { type: 'PERCENT_FEE', basisPoints: 2000 }, 1)).toBe(25);
    expect(promoterRewardCents(129, { type: 'MILESTONE', every: 3, cents: 250 }, 2)).toBe(0);
    expect(promoterRewardCents(129, { type: 'MILESTONE', every: 3, cents: 250 }, 3)).toBe(250);
  });
  it('requires ordered, justified ledger transitions; reversed is terminal', () => {
    for (const [a,b] of [['PENDING','APPROVED'],['APPROVED','PAYABLE'],['PAYABLE','PAID'],['PAID','REVERSED']]) expect(() => rewardTransition(a,b,'Verified evidence')).not.toThrow();
    for (const [a,b] of [['PENDING','PAID'],['REVERSED','APPROVED'],['PAID','PENDING']]) expect(() => rewardTransition(a,b,'Verified evidence')).toThrow();
    expect(() => rewardTransition('PENDING','APPROVED','')).toThrow();
  });
});
