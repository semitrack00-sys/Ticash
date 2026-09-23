import { MobileTopUpError, type MobileTopUpProviderName } from './types.js';

export const SLOT_SIZE = 700_000_000;
const providers: MobileTopUpProviderName[] = ['RELOADLY', 'DTONE', 'DING'];
export function encodeOperatorId(provider: MobileTopUpProviderName, rawId: number): number {
  const slot = providers.indexOf(provider);
  if (slot < 0 || !Number.isSafeInteger(rawId) || rawId < 1 || rawId >= SLOT_SIZE) {
    throw new MobileTopUpError('INVALID_OPERATOR_ID', 'Invalid provider operator identifier', 400);
  }
  const id = slot * SLOT_SIZE + rawId;
  if (id > 2_147_483_647) throw new MobileTopUpError('INVALID_OPERATOR_ID', 'Operator identifier exceeds storage bounds', 400);
  return id;
}
export function decodeOperatorId(id: number): { provider: MobileTopUpProviderName; rawId: number } {
  const provider = providers[Math.floor(id / SLOT_SIZE)];
  const rawId = id % SLOT_SIZE;
  if (!provider || encodeOperatorId(provider, rawId) !== id) {
    throw new MobileTopUpError('INVALID_OPERATOR_ID', 'Invalid recharge operator identifier', 400);
  }
  return { provider, rawId };
}
export function encodeTransactionReference(provider: MobileTopUpProviderName, id: string) {
  if (!id || id.length > 512) throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Invalid provider transaction reference', 502);
  return `${provider}:${encodeURIComponent(id)}`;
}
export function decodeTransactionReference(reference: string) {
  const separator = reference.indexOf(':');
  // Historical Reloadly references were stored verbatim.
  if (separator < 0) return { provider: 'RELOADLY' as const, id: reference };
  const provider = reference.slice(0, separator) as MobileTopUpProviderName;
  try {
    const id = decodeURIComponent(reference.slice(separator + 1));
    if (!providers.includes(provider) || !id || id.length > 512) throw new Error();
    return { provider, id };
  } catch { throw new MobileTopUpError('INVALID_TRANSACTION_REFERENCE', 'Invalid recharge transaction reference', 502); }
}
