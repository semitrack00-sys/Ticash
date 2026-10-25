import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import type { PrismaClient } from '@prisma/client';

/** A numbering-plan country is evidence about a phone, not verified residence. */
export function customerPhoneCountry(phone?: string | null): string | null {
  if (!phone || !/^\+[1-9][0-9\s().-]{6,25}$/.test(phone.trim())) return null;
  const number = parsePhoneNumberFromString(phone);
  if (number?.countryCallingCode === '1' && ['TOLL_FREE', 'PREMIUM_RATE', 'PERSONAL_NUMBER'].includes(number.getType() ?? '')) return null;
  return number?.isValid() && number.country ? number.country : null;
}

/** One-time release backfill. Compare the phone on update so concurrent changes win. */
export async function backfillCustomerPhoneCountries(db: PrismaClient) {
  let cursor: string | undefined;
  let updated = 0;
  for (;;) {
    const rows = await db.flupFlapCustomer.findMany({
      where: { phone: { not: null } }, select: { id: true, phone: true, phoneCountryCode: true },
      orderBy: { id: 'asc' }, take: 250, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (!rows.length) break;
    for (const row of rows) {
      const code = customerPhoneCountry(row.phone);
      if (row.phoneCountryCode === code) continue;
      const changed = await db.flupFlapCustomer.updateMany({
        where: { id: row.id, phone: row.phone, phoneCountryCode: row.phoneCountryCode },
        data: { phoneCountryCode: code },
      });
      updated += changed.count;
    }
    cursor = rows.at(-1)!.id;
  }
  return { updated };
}
