import { Prisma } from '@prisma/client';
import isoCountries from 'i18n-iso-countries';

/** Invalid legacy profile codes must not become invented country categories. */
export function adminCountry(column: Prisma.Sql) {
  return Prisma.sql`CASE WHEN upper(trim(${column})) IN (${Prisma.join(Object.keys(isoCountries.getAlpha2Codes()))})
    THEN upper(trim(${column})) ELSE 'UNKNOWN' END`;
}

/** Reporting preference only; never changes the saved billing country. */
export function adminClientCountry(phoneCountry: Prisma.Sql, profileCountry: Prisma.Sql) {
  return Prisma.sql`COALESCE(NULLIF(${adminCountry(phoneCountry)}, 'UNKNOWN'), ${adminCountry(profileCountry)})`;
}
