import { MobileTopUpError } from '../topup/types.js';
const prefix = 'flupflap:';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function flupFlapOwner(customerId: string): string {
  if (!uuid.test(customerId)) throw new MobileTopUpError('INVALID_OWNER', 'Invalid service identity', 500);
  return prefix + customerId;
}
export function flupFlapCustomerId(owner: string): string | undefined {
  if (!owner.startsWith(prefix)) return undefined;
  const id = owner.slice(prefix.length);
  if (!uuid.test(id)) throw new MobileTopUpError('INVALID_OWNER', 'Invalid service identity', 500);
  return id;
}
export function ownerWhere(owner: string) {
  const id = flupFlapCustomerId(owner);
  return id ? { flupFlapCustomerId: id } : { userId: owner };
}
export function ownerData(owner: string) {
  const id = flupFlapCustomerId(owner);
  return id ? { userId: null, flupFlapCustomerId: id } : { userId: owner };
}
export function ownerFromDb(record: { userId: string | null; flupFlapCustomerId?: string | null }): string {
  if (Boolean(record.userId) === Boolean(record.flupFlapCustomerId)) throw new MobileTopUpError('INVALID_OWNER', 'Invalid recharge ownership', 500);
  return record.flupFlapCustomerId ? flupFlapOwner(record.flupFlapCustomerId) : record.userId!;
}
export function transactionOwnerKey(owner: string, idempotencyKey: string) {
  const id = flupFlapCustomerId(owner);
  return id ? { flupFlapCustomerId_idempotencyKey: { flupFlapCustomerId: id, idempotencyKey } }
    : { userId_idempotencyKey: { userId: owner, idempotencyKey } };
}
export function recipientOwnerKey(owner: string, phone: string, countryCode: string) {
  const id = flupFlapCustomerId(owner);
  return id ? { flupFlapCustomerId_phone_countryCode: { flupFlapCustomerId: id, phone, countryCode } }
    : { userId_phone_countryCode: { userId: owner, phone, countryCode } };
}
