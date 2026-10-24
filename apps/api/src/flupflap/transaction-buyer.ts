import type { FlupFlapIdentityRepository } from './repository.js';

// Request-scoped cache: no stale identity data across requests and one lookup per buyer.
export function transactionBuyerLookup(identities: Pick<FlupFlapIdentityRepository, 'customer'>, canViewCustomers: boolean) {
  const cache = new Map<string, Promise<{ buyerName: string; buyerEmail: string | null; buyerPhone: string | null }>>();
  return (customerId: string | undefined): Promise<{ buyerName?: string; buyerEmail?: string | null; buyerPhone?: string | null }> => {
    if (!canViewCustomers) return Promise.resolve({});
    if (!customerId) return Promise.resolve({ buyerName: 'Customer unavailable', buyerEmail: null, buyerPhone: null });
    let pending = cache.get(customerId);
    if (!pending) {
      pending = identities.customer(customerId).then(customer => ({
        buyerName: customer
          ? [customer.firstName?.trim(), customer.lastName?.trim()].filter(Boolean).join(' ')
            || (customer.guestExpiresAt ? 'Guest customer' : 'Name not provided')
          : 'Customer unavailable',
        buyerEmail: customer?.email ?? null,
        buyerPhone: customer?.phone ?? null,
      }));
      cache.set(customerId, pending);
    }
    return pending;
  };
}
