import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDtOneConfig, DTONE_PREPROD_URL } from '../src/topup/dtone-config.js';
import { DtOnePreproductionProvider, dtOneAlpha2, dtOneAlpha3, mapDtOneProduct } from '../src/topup/dtone-provider.js';
import type { ProviderTopUpRequest } from '../src/topup/types.js';

const config = { enabled: true, baseUrl: DTONE_PREPROD_URL, apiKey: 'fixture-key', apiSecret: 'fixture-secret' };
const operator = { id: 255, name: 'Test Jamaica operator', country: { iso_code: 'JAM', name: 'Jamaica' } };
function product() { return { id: 56876, name: 'Fixed fixture product', type: 'FIXED_VALUE_RECHARGE', operator,
  service: { id: 1, subservice: { id: 11 } }, source: { amount: 5, unit: 'USD', unit_type: 'CURRENCY' },
  destination: { amount: 800, unit: 'JMD', unit_type: 'CURRENCY' }, prices: { wholesale: { amount: 5, fee: 0, unit: 'USD' } },
  required_credit_party_identifier_fields: [['mobile_number']], required_additional_identifier_fields: null,
  required_beneficiary_fields: null, required_debit_party_identifier_fields: null, required_sender_fields: null, required_statement_identifier_fields: null }; }
function result(status = 'COMPLETED') { return { id: 1234567890, status: { class: { message: status }, message: status }, source: { amount: 5, unit: 'USD' }, product: { id: 56876 } }; }
function response(value: unknown, headers: Record<string, string> = {}) { return new Response(JSON.stringify(value), { status: 200, headers }); }
const input: ProviderTopUpRequest = { provider: 'DTONE', providerProductId: '56876', productId: 'dtone:JM:700000255:product:56876', operatorId: 255, amount: 5, providerCurrency: 'USD', recipientPhone: '+18765551234', recipientCountryCode: 'JM', customIdentifier: 'ticash-topup-11111111-1111-4111-8111-111111111111' };
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden during DT One tests'); })));
afterEach(() => vi.unstubAllGlobals());

describe('DT One pre-production contract', () => {
  it('starts disabled without credentials and never leaks credentials in configuration errors', () => {
    expect(loadDtOneConfig({})).toMatchObject({ enabled: false, baseUrl: DTONE_PREPROD_URL });
    expect(() => loadDtOneConfig({ DTONE_ENABLED: 'true' })).toThrow('credentials');
    expect(() => loadDtOneConfig({ DTONE_ENABLED: 'yes' })).toThrow();
  });
  it.each(['https://dvs-api.dtone.com/v1', 'http://preprod-dvs-api.dtone.com/v1', `${DTONE_PREPROD_URL}/`, `${DTONE_PREPROD_URL}?token=fixture`])('rejects unapproved base URL %s even while disabled', url => {
    expect(() => loadDtOneConfig({ DTONE_BASE_URL: url })).toThrow('pre-production');
    expect(() => new DtOnePreproductionProvider({ ...config, baseUrl: url })).toThrow();
  });
  it.each(['MOBILE_TOPUP_PRODUCTION_ENABLED', 'MOBILE_TOPUP_APPROVED_FOR_LIVE_USE', 'APPROVED_FOR_LIVE_USE', 'LIVE_MONEY_ENABLED'])('rejects live gate %s', key => {
    expect(() => loadDtOneConfig({ DTONE_ENABLED: 'true', DTONE_API_KEY: 'fixture', DTONE_API_SECRET: 'fixture', [key]: 'true' })).toThrow('live money');
  });
  it('converts country codes without guessing names or inventing destinations', () => {
    expect(dtOneAlpha2('JAM')).toBe('JM'); expect(dtOneAlpha3('JM')).toBe('JAM');
    expect(dtOneAlpha2('MEX')).toBe('MX'); expect(dtOneAlpha2('GHA')).toBe('GH'); expect(dtOneAlpha2('NGA')).toBe('NG');
    expect(dtOneAlpha2('XXX')).toBeUndefined(); expect(() => dtOneAlpha2('Jamaica')).toThrow(); expect(() => dtOneAlpha3('ZZ')).toThrow();
  });
  it('uses Basic auth, pre-production only, and all country pages', async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      const parsed = new URL(String(url)); expect(parsed.origin).toBe('https://preprod-dvs-api.dtone.com');
      expect(parsed.searchParams.get('service_id')).toBe('1'); expect(parsed.searchParams.get('per_page')).toBe('100');
      expect(init?.headers).toMatchObject({ Authorization: `Basic ${Buffer.from('fixture-key:fixture-secret').toString('base64')}` }); expect(init?.redirect).toBe('error');
      return response([{ iso_code: parsed.searchParams.get('page') === '1' ? 'JAM' : 'MEX', name: 'Provider country' }], { 'X-Total-Pages': '2' });
    });
    const countries = await new DtOnePreproductionProvider(config, fetcher).listCountries();
    expect(countries.map(c => c.code)).toEqual(['JM', 'MX']); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('paginates operators and products and applies service/operator/country filters', async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo) => {
      const parsed = new URL(String(url)); const page = Number(parsed.searchParams.get('page'));
      expect(parsed.searchParams.get('country_iso_code')).toBe('JAM'); expect(parsed.searchParams.get('service_id')).toBe('1');
      if (parsed.pathname.endsWith('/operators')) return response([{ ...operator, id: 254 + page }], { 'X-Total-Pages': '2' });
      expect(parsed.searchParams.get('operator_id')).toBe('255');
      return response([{ ...product(), id: 56875 + page }], { 'X-Total-Pages': '2' });
    });
    const provider = new DtOnePreproductionProvider(config, fetcher);
    expect((await provider.listOperators('JM')).map(op => op.id)).toEqual([255, 256]);
    expect((await provider.listProducts('JM', 255)).map(p => p.providerProductId)).toEqual(['56876', '56877']);
  });
  it('rejects repeated pages, malformed catalogs and wrong-country operators', async () => {
    await expect(new DtOnePreproductionProvider(config, vi.fn(async () => response([{ iso_code: 'JAM', name: 'Jamaica' }], { 'X-Total-Pages': '2' }))).listCountries()).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    await expect(new DtOnePreproductionProvider(config, vi.fn(async () => response({}))).listCountries()).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    await expect(new DtOnePreproductionProvider(config, vi.fn(async () => response([operator]))).listOperators('MX')).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  });
  it('maps the exact fixed product and distinguishes bundle/data classification', () => {
    expect(mapDtOneProduct(product(), 'JM', 255)).toMatchObject({ id: 'dtone:JM:700000255:product:56876', provider: 'DTONE', providerProductId: '56876', price: 5, priceCurrency: 'USD', deliveredValue: 800, deliveredCurrency: 'JMD', classification: 'AIRTIME' });
    expect(mapDtOneProduct({ ...product(), service: { id: 1, subservice: { id: 12 } } }, 'JM', 255)?.classification).toBe('BUNDLE');
    expect(mapDtOneProduct({ ...product(), service: { id: 1, subservice: { id: 13 } } }, 'JM', 255)?.classification).toBe('DATA');
  });
  it.each(['required_sender_fields', 'required_beneficiary_fields', 'required_debit_party_identifier_fields', 'required_statement_identifier_fields', 'required_additional_identifier_fields'])('hides unsupported field requirement %s', field => {
    expect(mapDtOneProduct({ ...product(), [field]: [['unsupported']] }, 'JM', 255)).toBeUndefined();
  });
  it('hides ranged, unsupported recipient requirements, missing declarations and unsupported prices', () => {
    for (const patch of [{ type: 'RANGED_VALUE_RECHARGE' }, { required_credit_party_identifier_fields: [['account_number']] }, { required_sender_fields: undefined },
      { required_compliance_fields: [['document']] }, { source: { amount: 5, unit: 'EUR', unit_type: 'CURRENCY' } },
      { source: { amount: 5.001, unit: 'USD', unit_type: 'CURRENCY' } }, { prices: { wholesale: { amount: 5, fee: 1, unit: 'USD' } } }]) {
      expect(mapDtOneProduct({ ...product(), ...patch }, 'JM', 255)).toBeUndefined();
    }
  });
  it('looks up only an explicitly identified operator, preserving manual selection otherwise', async () => {
    const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({ mobile_number: '+18765551234' }); return response([{ ...operator, identified: true }]);
    });
    expect((await new DtOnePreproductionProvider(config, fetcher).detectOperator('+18765551234', 'JM')).id).toBe(255);
    await expect(new DtOnePreproductionProvider(config, vi.fn(async () => response([{ ...operator, identified: false }]))).detectOperator('+18765551234', 'JM')).rejects.toMatchObject({ code: 'TOPUP_OPERATOR_UNAVAILABLE' });
  });
  it('submits the quoted product and E.164 number with a deterministic <=40-character external ID', async () => {
    const expectedId = createHash('sha256').update(input.customIdentifier).digest('hex').slice(0, 40);
    const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      if (String(url).endsWith('/products/56876')) return response(product());
      expect(String(url)).toBe(`${DTONE_PREPROD_URL}/async/transactions`);
      expect(JSON.parse(String(init?.body))).toEqual({ external_id: expectedId, product_id: 56876, auto_confirm: true, credit_party_identifier: { mobile_number: input.recipientPhone } });
      return response({ ...result(), external_id: expectedId });
    });
    expect(await new DtOnePreproductionProvider(config, fetcher).submitTopUp(input)).toMatchObject({ transactionId: '1234567890', status: 'COMPLETED' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not submit a changed product or price and never searches for replacements', async () => {
    for (const value of [{ ...product(), id: 56877 }, { ...product(), source: { amount: 6, unit: 'USD', unit_type: 'CURRENCY' } }, { ...product(), required_sender_fields: [['name']] }]) {
      const fetcher = vi.fn(async () => response(value));
      await expect(new DtOnePreproductionProvider(config, fetcher).submitTopUp(input)).rejects.toMatchObject({ code: 'TOPUP_QUOTE_CHANGED', statusCode: 400 });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it.each(['CREATED', 'CONFIRMED', 'SUBMITTED', 'COMPLETED', 'REJECTED', 'DECLINED', 'CANCELLED', 'REVERSED'])('preserves %s status for service mapping', async status => {
    const provider = new DtOnePreproductionProvider(config, vi.fn(async () => response(result(status))));
    expect(await provider.getTopUpStatus('1234567890')).toMatchObject({ status, rawStatus: status });
  });
  it('fails safely on unknown status, wrong transaction ID, redirect/network errors and provider secrets', async () => {
    await expect(new DtOnePreproductionProvider(config, vi.fn(async () => response(result('UNKNOWN')))).getTopUpStatus('1234567890')).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    await expect(new DtOnePreproductionProvider(config, vi.fn(async () => response(result()))).getTopUpStatus('123')).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    for (const fetcher of [vi.fn(async () => { throw new Error('fixture-secret'); }), vi.fn(async () => new Response('fixture-secret', { status: 503 }))]) {
      await expect(new DtOnePreproductionProvider(config, fetcher).listCountries()).rejects.not.toThrow('fixture-secret');
    }
  });
});
