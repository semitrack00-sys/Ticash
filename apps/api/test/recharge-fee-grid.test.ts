import { describe, expect, it } from 'vitest';
import { approvedRechargeAmountsUsd, approvedRechargePrice, flupFlapAirtimePrice, isApprovedRechargeAmountMinorUnits, lookupRechargeFeeMinorUnits, normalizeRechargeAmountMinorUnits } from '../src/topup/recharge-fee-grid.js';

describe('final FlupFlap airtime fee schedule', () => {
  it.each([
    [9.99,99], [10,164], [19.99,164], [20,234], [29.99,234],
    [30,284], [39.99,284], [40,334], [49.99,334], [50,384], [74.99,384], [75,484], [100,484],
    [5,99], [15,164], [25,234], [35,284], [45,334], [60,384], [90,484],
  ])('$%s has exactly %s cents fee', (amount, fee) => {
    const principal = Math.round(amount * 100);
    expect(flupFlapAirtimePrice(amount)).toEqual({ amountMinorUnits: principal, feeMinorUnits: fee, totalMinorUnits: principal + fee });
  });
  it('covers every cent from $5 to $100 without gaps, overlaps or floating-point totals', () => {
    for (let cents = 500; cents <= 10000; cents++) {
      const fee = cents < 1000 ? 99 : cents < 2000 ? 164 : cents < 3000 ? 234 : cents < 4000 ? 284 : cents < 5000 ? 334 : cents < 7500 ? 384 : 484;
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
