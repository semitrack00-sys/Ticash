import { describe, it, expect } from 'vitest';
import { transactionBuyerLookup } from '../src/flupflap/transaction-buyer.js';
import type { FlupFlapIdentityRepository } from '../src/flupflap/repository.js';

const repository = (customer: unknown, calls: string[] = []) => ({
  customer: async (id: string) => { calls.push(id); return customer; },
}) as Pick<FlupFlapIdentityRepository, 'customer'>;

describe('transaction buyer identity', () => {
  it('returns only buyer identity fields, trimming names', async () => {
    const lookup = transactionBuyerLookup(repository({
      firstName: ' Marie ', lastName: ' Jean ', email: 'buyer@example.test',
      phone: '+15005550001', passwordHash: 'secret', authVersion: 4,
    }), true);
    expect(await lookup('buyer')).toEqual({
      buyerName: 'Marie Jean', buyerEmail: 'buyer@example.test', buyerPhone: '+15005550001',
    });
  });
  it('does not fetch or expose identities without customer permission', async () => {
    const calls: string[] = [];
    expect(await transactionBuyerLookup(repository({}, calls), false)('buyer')).toEqual({});
    expect(calls).toEqual([]);
  });
  it('deduplicates simultaneous lookups for repeated purchases', async () => {
    const calls: string[] = [];
    const lookup = transactionBuyerLookup(repository({ firstName: 'Marie' }, calls), true);
    await Promise.all([lookup('buyer'), lookup('buyer'), lookup('other')]);
    expect(calls).toEqual(['buyer', 'other']);
  });
  it('labels legacy profiles and guests without inventing names', async () => {
    expect((await transactionBuyerLookup(repository({}), true)('buyer')).buyerName).toBe('Name not provided');
    expect((await transactionBuyerLookup(repository({guestExpiresAt: new Date()}), true)('buyer')).buyerName).toBe('Guest customer');
  });
  it('keeps transactions readable when the linked profile is missing', async () => {
    const lookup = transactionBuyerLookup(repository(null), true);
    expect(await lookup('missing')).toEqual({buyerName: 'Customer unavailable', buyerEmail: null, buyerPhone: null});
    expect(await lookup(undefined)).toEqual({buyerName: 'Customer unavailable', buyerEmail: null, buyerPhone: null});
  });
  it('does not reuse profile values across requests', async () => {
    expect((await transactionBuyerLookup(repository({firstName:'Old'}), true)('buyer')).buyerName).toBe('Old');
    expect((await transactionBuyerLookup(repository({firstName:'New'}), true)('buyer')).buyerName).toBe('New');
  });
});
