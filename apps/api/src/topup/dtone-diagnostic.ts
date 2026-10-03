import { isSupportedCountry } from 'libphonenumber-js';
import { loadDtOneConfig, DTONE_PREPROD_URL } from './dtone-config.js';
import { DtOnePreproductionProvider } from './dtone-provider.js';
import { MobileTopUpError, type MobileTopUpCountry } from './types.js';

export const diagnosticCountries = ['HT', 'DO', 'JM', 'US', 'FR', 'BR'] as const;
const safeErrors = new Set(['DTONE_UNAVAILABLE', 'DTONE_REQUEST_FAILED', 'INVALID_PROVIDER_RESPONSE', 'DIAGNOSTIC_READ_ONLY_REQUIRED', 'DIAGNOSTIC_REQUEST_LIMIT']);
export function diagnosticError(error: unknown): string {
  return error instanceof MobileTopUpError && safeErrors.has(error.code) ? error.code : 'DIAGNOSTIC_FAILED';
}
function failure(code: string): never { throw new MobileTopUpError(code, 'DT One diagnostic could not complete', 502); }

/** Defense in depth: even an adapter regression cannot submit through this transport. */
export function dtOneReadOnlyTransport(fetchImpl: typeof fetch, counts: Map<string, number>): typeof fetch {
  let requests = 0;
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const method = init?.method ?? (input instanceof Request ? input.method : 'GET');
    if (method !== 'GET' || init?.body != null || input instanceof Request && input.body != null ||
        url.origin !== new URL(DTONE_PREPROD_URL).origin || url.username || url.password || url.hash ||
        !['/v1/countries', '/v1/operators', '/v1/products'].includes(url.pathname) ||
        [...url.searchParams.keys()].some(key => !['page', 'per_page', 'service_id', 'country_iso_code', 'operator_id'].includes(key))) {
      return failure('DIAGNOSTIC_READ_ONLY_REQUIRED');
    }
    if (++requests > 250) return failure('DIAGNOSTIC_REQUEST_LIMIT');
    const response = await fetchImpl(input, { ...init, redirect: 'error' });
    if (response.ok) {
      try {
        const rows: unknown = await response.clone().json();
        if (Array.isArray(rows)) counts.set(url.pathname, (counts.get(url.pathname) ?? 0) + rows.length);
      } catch { /* The adapter validates JSON and returns a local sanitized error. */ }
    }
    return response;
  };
}

export interface DtOneDiagnostic {
  provider: 'DTONE'; environment: 'PREPRODUCTION'; connected: boolean; complete: boolean;
  countryCount: number | null; validCountryCount: number | null;
  samples: { country: string; inCountryCatalog: boolean; operatorCount?: number; sampleProductCount?: number;
    sampleEligibleProductCount?: number; errorCode?: string }[];
  comparison: { available: boolean; reloadlyCountryCount?: number; overlapCountryCount?: number;
    dtOneOnlyCountryCount?: number; errorCode?: string };
  errorCode?: string;
}

export async function verifyDtOnePreproduction(
  env: NodeJS.ProcessEnv,
  options: { coverage?: boolean; country?: string; reloadlyCountries?: () => Promise<MobileTopUpCountry[]> } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<DtOneDiagnostic> {
  const summary: DtOneDiagnostic = { provider: 'DTONE', environment: 'PREPRODUCTION', connected: false, complete: false,
    countryCount: null, validCountryCount: null, samples: [], comparison: { available: false, errorCode: 'NOT_REQUESTED' } };
  const fail = (errorCode: string) => ({ ...summary, errorCode });
  if (env.MOBILE_TOPUP_ENABLED !== 'true') return fail('TOPUP_DISABLED');
  if (env.DTONE_ENABLED !== 'true') return fail('DTONE_DISABLED');
  if (!env.DTONE_API_KEY?.trim() || !env.DTONE_API_SECRET?.trim()) return fail('CREDENTIALS_NOT_CONFIGURED');
  if ((env.RELOADLY_ENVIRONMENT ?? 'sandbox').toLowerCase() !== 'sandbox' ||
      ['MOBILE_TOPUP_PRODUCTION_ENABLED', 'MOBILE_TOPUP_APPROVED_FOR_LIVE_USE', 'APPROVED_FOR_LIVE_USE', 'LIVE_MONEY_ENABLED']
        .some(key => (env[key] ?? 'false').toLowerCase() !== 'false')) return fail('PREPRODUCTION_REQUIRED');
  const selected = options.coverage ? [...diagnosticCountries] : [options.country ?? 'HT'];
  if (selected.some(country => !/^[A-Z]{2}$/.test(country) || !isSupportedCountry(country))) return fail('INVALID_TEST_COUNTRY');
  let provider: DtOnePreproductionProvider;
  const counts = new Map<string, number>();
  try { provider = new DtOnePreproductionProvider(loadDtOneConfig(env), dtOneReadOnlyTransport(fetchImpl, counts)); }
  catch { return fail('INVALID_CONFIGURATION'); }
  let valid: Set<string>;
  try {
    // The authenticated countries request is the connectivity/authentication test.
    const countries = await provider.listCountries();
    valid = new Set(countries.map(country => country.code).filter(code => isSupportedCountry(code)));
    summary.connected = true;
    summary.countryCount = counts.get('/v1/countries') ?? 0;
    summary.validCountryCount = valid.size;
  } catch (error) { return fail(diagnosticError(error)); }
  for (const country of selected) {
    const sample: DtOneDiagnostic['samples'][number] = { country, inCountryCatalog: valid.has(country) };
    summary.samples.push(sample);
    if (!sample.inCountryCatalog) continue;
    try {
      const operators = await provider.listOperators(country);
      sample.operatorCount = operators.length;
      // A single deterministic sample per country, not a claim about every operator.
      const operator = operators.sort((a, b) => a.id - b.id)[0];
      if (operator) {
        const previous = counts.get('/v1/products') ?? 0;
        const products = await provider.listProducts(country, operator.id);
        sample.sampleProductCount = (counts.get('/v1/products') ?? 0) - previous;
        sample.sampleEligibleProductCount = products.length;
      }
    } catch (error) { sample.errorCode = diagnosticError(error); }
  }
  if (options.reloadlyCountries) {
    try {
      const rows = await options.reloadlyCountries();
      if (!Array.isArray(rows) || rows.some(row => !row || typeof row.code !== 'string' || !/^[A-Z]{2}$/.test(row.code))) throw new Error();
      const reloadly = new Set<string>(rows.map(row => row.code).filter(code => isSupportedCountry(code)));
      summary.comparison = { available: true, reloadlyCountryCount: reloadly.size,
        overlapCountryCount: [...valid].filter(code => reloadly.has(code)).length,
        dtOneOnlyCountryCount: [...valid].filter(code => !reloadly.has(code)).length };
    } catch { summary.comparison = { available: false, errorCode: 'RELOADLY_COMPARISON_UNAVAILABLE' }; }
  }
  summary.complete = summary.samples.every(sample => !sample.errorCode) && (!options.reloadlyCountries || summary.comparison.available);
  if (!summary.complete) summary.errorCode = 'DIAGNOSTIC_INCOMPLETE';
  return summary;
}
