import { describe, expect, it } from 'vitest';
import { approvedRechargeAmountsUsd, approvedRechargePrice, flupFlapAirtimePrice, isApprovedRechargeAmountMinorUnits, lookupRechargeFeeMinorUnits, normalizeRechargeAmountMinorUnits } from '../src/topup/recharge-fee-grid.js';

describe('FlupFlap 17 percent recharge fee', () => {
  it.each([
    [5,85], [5.02,85], [5.03,86], [5.50,94], [9.99,170], [10,170],
    [11,187], [12,204], [13,221], [14,238],
    [19.99,340], [20,340], [29.99,510], [30,510], [39.99,680], [40,680],
    [49.99,850], [50,850], [74.99,1275], [75,1275], [100,1700],
    [15,255], [25,425], [35,595], [45,765], [60,1020], [90,1530],
  ])('$%s has exactly %s cents fee', (amount, fee) => {
    const principal = Math.round(amount * 100);
    expect(flupFlapAirtimePrice(amount)).toEqual({ amountMinorUnits: principal, feeMinorUnits: fee, totalMinorUnits: principal + fee });
  });
  it('covers every cent from $5 to $100 without gaps, overlaps or floating-point totals', () => {
    for (let cents = 500; cents <= 10000; cents++) {
      const fee = Number((BigInt(cents) * 17n + 50n) / 100n);
      expect(flupFlapAirtimePrice(cents / 100)).toEqual({ amountMinorUnits: cents, feeMinorUnits: fee, totalMinorUnits: cents + fee });
    }
  });
  it.each([0.99, 1, 4.99, 100.01, 5.001, NaN, Infinity, -Infinity, 0, -1, '5', null, undefined])('rejects invalid amount %s', amount => {
    expect(() => flupFlapAirtimePrice(amount as number)).toThrow();
  });
});

describe('provider-independent server fee tiers', () => {
  it.each([
    [5, 99], [9.99, 99], [10, 125], [19.99, 125], [20, 149], [29.99, 149],
    [30, 199], [49.99, 199], [50, 249], [74.99, 249], [75, 349], [99.99, 349], [100, 449],
    [7, 99], [12, 125], [14, 125], [19, 125], [23, 149], [25, 149], [40, 199], [60, 249], [80, 349], [95, 349],
  ])('prices $%s with %s cents fee and an integer-cent total', (amount, fee) => {
    const cents = Math.round(amount * 100);
    expect(normalizeRechargeAmountMinorUnits(amount)).toBe(cents);
    expect(lookupRechargeFeeMinorUnits(cents)).toBe(fee);
    expect(approvedRechargePrice(amount)).toEqual({ amountMinorUnits: cents, feeMinorUnits: fee, totalMinorUnits: cents + fee });
  });
  it.each([4.99, 100.01, 5.001, NaN, Infinity, -Infinity, 0, -5, '12', null, undefined])('rejects invalid USD input %s', amount => {
    expect(() => approvedRechargePrice(amount as number)).toThrow();
  });
  it.each([499, 10001, 500.1, NaN, Infinity])('rejects invalid integer cents %s', cents => {
    expect(() => lookupRechargeFeeMinorUnits(cents)).toThrow();
  });
  it('retains legacy anchors without treating them as the provider catalog', () => {
    expect(approvedRechargeAmountsUsd).toEqual([5, 10, 20, 30, 50, 75, 100]);
    expect(isApprovedRechargeAmountMinorUnits(1000)).toBe(true);
    expect(isApprovedRechargeAmountMinorUnits(1200)).toBe(false);
    expect(approvedRechargePrice(12).feeMinorUnits).toBe(125);
  });
});
