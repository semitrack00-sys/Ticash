import { z } from 'zod';

// Registration scope only. Activation also requires an explicitly enabled country.
export const storeCountries = new Set(('US CA MX GT BZ SV HN NI CR PA CU HT DO JM BS BB TT AG DM GD KN LC VC ' +
  'AR BO BR CL CO EC GY PY PE SR UY VE GF GP MQ PR VI AI AW BQ CW KY MS TC VG BM FK GL GG JE IM FO GI AX BL MF PM SX ' +
  'AL AD AT BY BE BA BG HR CY CZ DK EE FI FR DE GR HU IS IE IT LV LI LT LU MT MD MC ME NL MK NO PL PT RO RU SM RS SK SI ES SE CH TR UA GB VA XK').split(' '));
export const storeApplication = z.object({
  name: z.string().trim().min(2).max(120),
  contactName: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/),
  address: z.string().trim().min(5).max(250),
  country: z.string().toUpperCase().refine(value => storeCountries.has(value)),
}).strict();
export const storeFunding = z.object({
  amountCents: z.number().int().min(100).max(1_000_000),
  reference: z.string().trim().min(5).max(120),
}).strict();
export const storeBalanceReturn = storeFunding.extend({ amountCents: z.number().int().min(1).max(1_000_000) });
export const storeReview = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED', 'REJECTED']),
  commissionBps: z.number().int().min(0).max(5000).optional(),
  reason: z.string().trim().min(5).max(250),
}).strict();
export function storeCommission(feeCents: number, commissionBps = 2000) {
  if (!Number.isSafeInteger(feeCents) || feeCents < 0 || !Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > 5000) {
    throw new Error('INVALID_STORE_COMMISSION');
  }
  return Math.floor((feeCents * commissionBps + 5000) / 10000);
}
export function storeLaunchCountries(env: NodeJS.ProcessEnv = process.env) {
  return new Set((env.FLUPFLAP_STORE_COUNTRIES ?? '').split(',').map(value => value.trim().toUpperCase()).filter(value => storeCountries.has(value)));
}
