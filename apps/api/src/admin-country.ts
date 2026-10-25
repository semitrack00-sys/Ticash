import { Prisma } from '@prisma/client';
import isoCountries from 'i18n-iso-countries';

/** Invalid legacy profile codes must not become invented country categories. */
export function adminCountry(column: Prisma.Sql) {
  return Prisma.sql`CASE WHEN upper(trim(${column})) IN (${Prisma.join(Object.keys(isoCountries.getAlpha2Codes()))})
    THEN upper(trim(${column})) ELSE 'UNKNOWN' END`;
}
