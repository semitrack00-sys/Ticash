import { describe, expect, it } from 'vitest';
import { approvedRechargeAmountsUsd, approvedRechargePrice, isApprovedRechargeAmountMinorUnits, lookupRechargeFeeMinorUnits, normalizeRechargeAmountMinorUnits } from '../src/topup/recharge-fee-grid.js';

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
