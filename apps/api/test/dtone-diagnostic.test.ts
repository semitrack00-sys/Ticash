import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dtOneReadOnlyTransport, verifyDtOnePreproduction } from '../src/topup/dtone-diagnostic.js';
import { DTONE_PREPROD_URL } from '../src/topup/dtone-config.js';

const env = { MOBILE_TOPUP_ENABLED: 'true', DTONE_ENABLED: 'true', DTONE_API_KEY: 'never-print-key', DTONE_API_SECRET: 'never-print-secret' };
const countries = ['HTI', 'DOM', 'JAM', 'USA', 'FRA', 'BRA', 'ATA'];
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'X-Total-Pages': '1' } });
function fixture() {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    expect(init?.method).toBe('GET');
    expect(init?.redirect).toBe('error');
    expect(init?.body).toBeUndefined();
    expect(url.origin).toBe('https://preprod-dvs-api.dtone.com');
    const operator = { id: 255, name: 'Raw provider name never printed', country: { iso_code: url.searchParams.get('country_iso_code') } };
    if (url.pathname === '/v1/countries') return response(countries.map(iso_code => ({ iso_code, name: 'Raw country name never printed' })));
    if (url.pathname === '/v1/operators') return response([operator]);
    if (url.pathname !== '/v1/products') throw new Error('Forbidden real operation');
    return response([{ id: 77, operator, name: 'Raw product name never printed', type: 'FIXED_VALUE_RECHARGE', service: { id: 1, subservice: { id: 11 } },
      source: { amount: 5, unit: 'USD', unit_type: 'CURRENCY' }, destination: { amount: 800, unit: 'HTG', unit_type: 'CURRENCY' },
      prices: { wholesale: { amount: 5, unit: 'USD', unit_type: 'CURRENCY', fee: 0 } },
      required_credit_party_identifier_fields: [['mobile_number']], required_debit_party_identifier_fields: null, required_sender_fields: null,
      required_beneficiary_fields: null, required_statement_identifier_fields: null, required_additional_identifier_fields: null },
    { type: 'RANGED_VALUE_RECHARGE', service: { id: 1, subservice: { id: 11 } } }]);
  });
}
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); })));
afterEach(() => vi.unstubAllGlobals());

describe('read-only DT One verification', () => {
  it('authenticates using country discovery and fetches one operator/product catalog by default', async () => {
    const fetcher = fixture();
    const result = await verifyDtOnePreproduction(env, {}, fetcher);
    expect(result).toEqual({ provider: 'DTONE', environment: 'PREPRODUCTION', connected: true, complete: true,
      countryCount: 7, validCountryCount: 6,
      samples: [{ country: 'HT', inCountryCatalog: true, operatorCount: 1, sampleProductCount: 2, sampleEligibleProductCount: 1 }],
      comparison: { available: false, errorCode: 'NOT_REQUESTED' } });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toMatch(/never.print|Authorization|mobile_number|Raw provider|Raw country|Raw product/);
  });
  it('reports all six sample countries and overlap from actual catalogs, without dumping catalogs', async () => {
    const result = await verifyDtOnePreproduction(env, { coverage: true, reloadlyCountries: async () => [
      { code: 'HT', name: 'Haiti' }, { code: 'US', name: 'United States' }, { code: 'US', name: 'Duplicate' },
    ] }, fixture());
    expect(result.samples.map(sample => sample.country)).toEqual(['HT', 'DO', 'JM', 'US', 'FR', 'BR']);
    expect(result.comparison).toEqual({ available: true, reloadlyCountryCount: 2, overlapCountryCount: 2, dtOneOnlyCountryCount: 4 });
  });
  it('does not invent unsupported country coverage or query its operators', async () => {
    const fetcher = vi.fn(async () => response([{ iso_code: 'HTI', name: 'Haiti' }]));
    const result = await verifyDtOnePreproduction(env, { country: 'FR' }, fetcher);
    expect(result.samples).toEqual([{ country: 'FR', inCountryCatalog: false }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('retains DT One success when optional Reloadly comparison is unavailable, without claiming exclusivity', async () => {
    const result = await verifyDtOnePreproduction(env, { reloadlyCountries: async () => { throw new Error('never-print-secret'); } }, fixture());
    expect(result).toMatchObject({ connected: true, complete: false, errorCode: 'DIAGNOSTIC_INCOMPLETE',
      comparison: { available: false, errorCode: 'RELOADLY_COMPARISON_UNAVAILABLE' } });
    expect(result.comparison.dtOneOnlyCountryCount).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain('never-print');
  });
  it.each([
    [{ MOBILE_TOPUP_ENABLED: 'false' }, 'TOPUP_DISABLED'], [{ DTONE_ENABLED: 'false' }, 'DTONE_DISABLED'],
    [{ DTONE_API_SECRET: '' }, 'CREDENTIALS_NOT_CONFIGURED'], [{ DTONE_BASE_URL: 'https://dvs-api.dtone.com/v1' }, 'INVALID_CONFIGURATION'],
    [{ RELOADLY_ENVIRONMENT: 'production' }, 'PREPRODUCTION_REQUIRED'],
    ...['MOBILE_TOPUP_PRODUCTION_ENABLED', 'MOBILE_TOPUP_APPROVED_FOR_LIVE_USE', 'APPROVED_FOR_LIVE_USE', 'LIVE_MONEY_ENABLED'].map(key => [{ [key]: 'true' }, 'PREPRODUCTION_REQUIRED']),
  ] as const)('refuses unsafe or incomplete configuration before networking: %j', async (patch, code) => {
    const fetcher = fixture();
    expect(await verifyDtOnePreproduction({ ...env, ...patch }, {}, fetcher)).toMatchObject({ connected: false, complete: false, errorCode: code, countryCount: null });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('sanitizes provider error bodies and network exceptions', async () => {
    for (const fetcher of [vi.fn(async () => new Response('never-print-secret +18095551234', { status: 401 })),
      vi.fn(async () => { throw new Error('never-print-key Authorization Basic +18095551234'); })]) {
      const result = await verifyDtOnePreproduction(env, {}, fetcher);
      expect(result).toMatchObject({ connected: false, complete: false, countryCount: null });
      expect(JSON.stringify(result)).not.toMatch(/never.print|Authorization|18095551234/);
    }
  });
  it('reports a failed product catalog without publishing partial product counts', async () => {
    const valid = fixture();
    const fetcher: typeof fetch = (input, init) => String(input).includes('/products') ? Promise.resolve(new Response('secret', { status: 503 })) : valid(input, init);
    expect((await verifyDtOnePreproduction(env, {}, fetcher)).samples[0]).toEqual({ country: 'HT', inCountryCatalog: true, operatorCount: 1, errorCode: 'DTONE_REQUEST_FAILED' });
  });
  it.each([
    [`${DTONE_PREPROD_URL}/async/transactions`, 'POST'], [`${DTONE_PREPROD_URL}/transactions`, 'GET'],
    [`${DTONE_PREPROD_URL}/lookup/mobile-number`, 'POST'], ['https://dvs-api.dtone.com/v1/countries', 'GET'],
    [`${DTONE_PREPROD_URL}/countries?phone=secret`, 'GET'],
  ])('transport rejects operations outside the catalog allowlist: %s', async (url, method) => {
    const fetcher = fixture();
    await expect(dtOneReadOnlyTransport(fetcher, new Map())(url!, { method })).rejects.toMatchObject({ code: 'DIAGNOSTIC_READ_ONLY_REQUIRED' });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
