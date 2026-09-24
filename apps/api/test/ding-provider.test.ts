import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp, resetStore } from '../src/app.js';
import { DING_API_URL, DING_TOKEN_URL, loadDingConfig } from '../src/topup/ding-config.js';
import { DingUatProvider, dingOperatorId, dingOperatorCode, dingDistributorReference, mapDingProduct } from '../src/topup/ding-provider.js';
import { GlobalRechargeProviderRouter } from '../src/topup/provider-router.js';
import { encodeOperatorId, decodeOperatorId } from '../src/topup/provider-identity.js';
import { MobileTopUpService } from '../src/topup/service.js';
import { MemoryMobileTopUpRepository } from '../src/topup/repository.js';
import { MockMobileTopUpPaymentProvider, type MobileTopUpConfig, type MobileTopUpOperator, type MobileTopUpProvider, type ProviderTopUpRequest } from '../src/topup/types.js';

const env = { DING_ENABLED: 'true', DING_CLIENT_ID: 'fixture-ding-client', DING_CLIENT_SECRET: 'fixture-ding-secret' };
const config = loadDingConfig(env);
const providerCode = 'JMFL';
const rawId = dingOperatorId(providerCode);
const globalId = encodeOperatorId('DING', rawId);
const rawOperator = { ProviderCode: providerCode, CountryIso: 'JM', Name: 'Fixture Jamaica mobile' };
const op: MobileTopUpOperator = { id: rawId, provider: 'DING', countryCode: 'JM', name: rawOperator.Name, status: true, bundle: false, denominationType: 'FIXED', senderCurrencyCode: '', destinationCurrencyCode: '', fixedAmounts: [], localFixedAmounts: [], fixedAmountsPlanNames: {}, localFixedAmountsPlanNames: {} };
const price = { SendValue: 5, SendCurrencyIso: 'USD', ReceiveValue: 800, ReceiveCurrencyIso: 'JMD', CustomerFee: 0, DistributorFee: 0 };
const rawProduct = { ProviderCode: providerCode, SkuCode: 'JM-FIXTURE-5', DefaultDisplayText: 'Fixture five dollar airtime', Minimum: price, Maximum: price,
  Benefits: ['Mobile', 'Minutes'], RedemptionMechanism: 'Immediate', ProcessingMode: 'Instant', SettingDefinitions: [], AdditionalInformation: null, LookupBillsRequired: false, RegionCode: null, UatNumber: '18765551234' };
const input: ProviderTopUpRequest = { provider: 'DING', operatorId: rawId, providerProductId: rawProduct.SkuCode, productId: `ding:JM:${globalId}:product:JM-FIXTURE-5`, amount: 5, providerCurrency: 'USD', recipientPhone: '+18765551234', recipientCountryCode: 'JM', customIdentifier: 'fixture-transaction-1' };
const ok = (extra: Record<string, unknown> = {}) => ({ ResultCode: 1, ErrorCodes: [], ...extra });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
function record(reference: string, state = 'Complete') { return { TransferId: { TransferRef: 'fixture-transfer-1', DistributorRef: reference }, SkuCode: rawProduct.SkuCode, AccountNumber: '18765551234', Price: price, ProcessingState: state }; }
function transport() {
  const records = new Map<string, ReturnType<typeof record>>();
  let sendCount = 0;
  const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const parsed = new URL(String(url));
    if (String(url) === DING_TOKEN_URL) return response({ access_token: 'fixture-ding-token', token_type: 'Bearer', expires_in: 100 });
    expect(parsed.origin).toBe('https://api.dingconnect.com'); expect(init?.redirect).toBe('error'); expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer fixture-ding-token' });
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    switch (parsed.pathname.split('/').pop()) {
      case 'GetCountries': return response(ok({ Items: [{ CountryIso: 'JM', CountryName: 'Jamaica' }, { CountryIso: 'XG', CountryName: 'Global' }] }));
      case 'GetProviders': return response(ok({ Items: [rawOperator] }));
      case 'GetProviderStatus': return response(ok({ Items: [{ ProviderCode: providerCode, IsProcessingTransfers: true }] }));
      case 'GetProducts': return response(ok({ Items: [rawProduct] }));
      case 'GetAccountLookup': return response(ok({ CountryIso: 'JM', AccountNumberNormalized: '18765551234', Items: [{ ProviderCode: providerCode }] }));
      case 'ListTransferRecords': return response(ok({ Items: records.has(body.DistributorRef) ? [ok({ TransferRecord: records.get(body.DistributorRef) })] : [], ThereAreMoreItems: false }));
      case 'SendTransfer': sendCount++; records.set(body.DistributorRef, record(body.DistributorRef)); return response(ok({ TransferRecord: records.get(body.DistributorRef) }));
      default: throw new Error('Unexpected fixture operation');
    }
  });
  return { fetcher, records, sends: () => sendCount };
}
const topupConfig: MobileTopUpConfig = { enabled: true, environment: 'sandbox', clientId: 'fixture', clientSecret: 'fixture', authUrl: 'https://auth.reloadly.com/oauth/token', airtimeBaseUrl: 'https://topups-sandbox.reloadly.com', billingCurrency: 'USD', feeUsd: '3.50', quoteTtlSeconds: 300, paymentMode: 'mock', productionEnabled: false, approvedForLiveUse: false };
beforeEach(() => { resetStore(); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real network forbidden'); })); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('Ding UAT configuration and identity', () => {
  it('defaults disabled, with no credentials needed', () => { expect(loadDingConfig({})).toMatchObject({ enabled: false, environment: 'uat', tokenUrl: DING_TOKEN_URL, baseUrl: DING_API_URL }); expect(() => createApp()).not.toThrow(); });
  it.each(['DING_CLIENT_ID', 'DING_CLIENT_SECRET'])('fails closed without %s', key => { expect(() => loadDingConfig({ ...env, [key]: '' })).toThrow('required'); });
  it.each([{ DING_ENVIRONMENT: 'production' }, { DING_ENVIRONMENT: 'live' }, { DING_API_BASE_URL: 'https://example.com' }, { DING_OAUTH_TOKEN_URL: 'http://idp.ding.com/connect/token' }, { DING_ENABLED: 'yes' }, { LIVE_MONEY_ENABLED: 'true' }, { MOBILE_TOPUP_PRODUCTION_ENABLED: 'true' }, { MOBILE_TOPUP_APPROVED_FOR_LIVE_USE: 'true' }, { APPROVED_FOR_LIVE_USE: 'true' }, { CHECKOUT_COM_ENABLED: 'true' }, { PAYMENTS_MODE: 'live' }, { MOBILE_TOPUP_PAYMENT_MODE: 'real' }])('rejects unsafe config %j', patch => { expect(() => loadDingConfig({ ...env, ...patch })).toThrow(); });
  it('validates direct adapter construction too', () => { expect(() => new DingUatProvider({ ...config, enabled: false })).toThrow(); expect(() => new DingUatProvider({ ...config, baseUrl: 'https://example.com' })).toThrow(); });
  it('losslessly converts provider codes within the existing DING slot', () => {
    const codes = ['JMFL', '00', 'A', 'a', 'ZZZZ', '0abcd'];
    expect(new Set(codes.map(dingOperatorId)).size).toBe(codes.length);
    for (const code of codes) expect(dingOperatorCode(decodeOperatorId(encodeOperatorId('DING', dingOperatorId(code))).rawId)).toBe(code);
    expect(encodeOperatorId('RELOADLY', 255)).toBe(255); expect(encodeOperatorId('DTONE', 255)).toBe(700000255);
    for (const code of ['', 'with-dash', 'zzzzz', 'TOOLONG']) expect(() => dingOperatorId(code)).toThrow();
  });
});
describe('Ding OAuth and catalog', () => {
  it('requests client_credentials once for concurrent calls, caches, and refreshes before expiry', async () => {
    let now = 0; const t = transport(); const provider = new DingUatProvider(config, t.fetcher, () => now);
    await Promise.all([provider.listCountries(), provider.listCountries(), provider.listCountries()]);
    const tokens = () => t.fetcher.mock.calls.filter(([url]) => String(url) === DING_TOKEN_URL);
    expect(tokens()).toHaveLength(1); expect(new URLSearchParams(String(tokens()[0]![1]?.body)).get('grant_type')).toBe('client_credentials');
    expect(new URLSearchParams(String(tokens()[0]![1]?.body)).get('client_id')).toBe(env.DING_CLIENT_ID);
    expect(new URLSearchParams(String(tokens()[0]![1]?.body)).get('client_secret')).toBe(env.DING_CLIENT_SECRET);
    now = 89_000; await provider.listCountries(); expect(tokens()).toHaveLength(1);
    now = 90_001; await provider.listCountries(); expect(tokens()).toHaveLength(2);
  });
  it.each([{ access_token: 'fixture-token', expires_in: 0, token_type: 'Bearer' }, { access_token: 'fixture-token', expires_in: Number.MAX_VALUE, token_type: 'Bearer' }, { access_token: '', expires_in: 100, token_type: 'Bearer' }, { access_token: 'fixture-token', expires_in: 100, token_type: 'Other' }])('rejects malformed OAuth metadata', async value => {
    await expect(new DingUatProvider(config, vi.fn(async () => response(value))).listCountries()).rejects.toMatchObject({ code: 'DING_AUTH_UNAVAILABLE' });
  });
  it('redacts OAuth and provider errors, clears failed auth, and rejects echoed secrets', async () => {
    const failed = vi.fn(async () => { throw new Error(env.DING_CLIENT_SECRET); }); const provider = new DingUatProvider(config, failed);
    for (let n = 0; n < 2; n++) await expect(provider.listCountries()).rejects.toMatchObject({ message: 'Ding UAT authentication failed' });
    expect(failed).toHaveBeenCalledTimes(2);
    for (const status of [200, 401, 500]) {
      const t = transport(); const fetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url) === DING_TOKEN_URL ? t.fetcher(url, init) : response(ok({ Items: [{ CountryIso: 'JM', CountryName: env.DING_CLIENT_SECRET }] }), status));
      await expect(new DingUatProvider(config, fetcher).listCountries()).rejects.not.toThrow(env.DING_CLIENT_SECRET);
    }
  });
  it('rejects credentials echoed with JSON escaping in values or object keys', async () => {
    const secret = 'fixture-secret-"-\\-suffix';
    for (const item of [{ CountryIso: 'JM', CountryName: secret }, { CountryIso: 'JM', CountryName: 'Jamaica', [secret]: true }]) {
      const t = transport();
      const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).includes('GetCountries') ? response(ok({ Items: [item] })) : t.fetcher(url, init));
      await expect(new DingUatProvider({ ...config, clientSecret: secret }, f).listCountries()).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE', message: 'Ding returned unsupported or invalid data' });
    }
  });
  it('maps actual countries/operators/SKUs and resolves account lookup', async () => {
    const t = transport(); const p = new DingUatProvider(config, t.fetcher);
    expect(await p.listCountries()).toEqual([{ code: 'JM', name: 'Jamaica' }]);
    expect(await p.listOperators('JM')).toEqual([op]); expect(await p.getOperator(rawId)).toEqual(op);
    expect(await p.detectOperator('+18765551234', 'JM')).toEqual(op);
    expect(await p.listProducts('JM', rawId)).toEqual([expect.objectContaining({ provider: 'DING', providerProductId: rawProduct.SkuCode, price: 5, deliveredCurrency: 'JMD' })]);
  });
  it('requires an exact unique lookup, never treats nearest-match suggestions as detection', async () => {
    for (const data of [ok({ Items: [], CountryIso: 'JM' }), { ...ok(), ResultCode: 2, CountryIso: 'JM', AccountNumberNormalized: '18765551234', Items: [{ ProviderCode: providerCode }] }, ok({ Items: [{ ProviderCode: providerCode }, { ProviderCode: 'OTHER' }], CountryIso: 'JM' })]) {
      const t = transport(); const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).includes('GetAccountLookup') ? response(data) : t.fetcher(url, init));
      await expect(new DingUatProvider(config, f).detectOperator('+18765551234', 'JM')).rejects.toMatchObject({ code: 'TOPUP_OPERATOR_UNAVAILABLE' });
    }
  });
  it.each([{ Maximum: { ...price, SendValue: 6 } }, { Minimum: { ...price, SendCurrencyIso: 'EUR' } }, { Minimum: { ...price, DistributorFee: 1 } }, { Minimum: { ...price, SendValue: 5.001 } }, { SettingDefinitions: [{ Name: 'ID', IsMandatory: true }] }, { LookupBillsRequired: true }, { Benefits: ['Utility'] }, { RedemptionMechanism: 'ReadReceipt' }, { ProcessingMode: 'Batch' }, { UatNumber: '' }, { RegionCode: 'unknown-region' }, { AdditionalInformation: 'custom instructions' }])('filters ambiguous/unsupported products %j', patch => { expect(mapDingProduct({ ...rawProduct, ...patch }, op)).toBeUndefined(); });
  it('honors operator availability and refuses malformed or incomplete catalog responses', async () => {
    for (const payload of [ok({ Items: [{ ProviderCode: providerCode, IsProcessingTransfers: false }] }), ok({ Items: [] })]) {
      const t = transport(); const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).includes('GetProviderStatus') ? response(payload) : t.fetcher(url, init));
      const p = new DingUatProvider(config, f); expect((await p.getOperator(rawId)).status).toBe(false); expect(await p.listProducts('JM', rawId)).toEqual([]);
      await expect(p.submitTopUp(input)).rejects.toMatchObject({ code: 'TOPUP_QUOTE_CHANGED' }); expect(t.sends()).toBe(0);
    }
    for (const payload of [ok({ Items: null }), ok({ Items: [null] }), ok({ Items: [], ThereAreMoreItems: true }), { ResultCode: 4, ErrorCodes: [] }]) {
      const t = transport(); const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).includes('GetCountries') ? response(payload) : t.fetcher(url, init));
      await expect(new DingUatProvider(config, f).listCountries()).rejects.toThrow();
    }
  });
  it('rejects wrong provider products and country mismatches', async () => {
    expect(() => mapDingProduct({ ...rawProduct, ProviderCode: 'OTHER' }, op)).toThrow();
    const t = transport(); await expect(new DingUatProvider(config, t.fetcher).listOperators('HT')).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  });
});
describe('Ding transfer and reconciliation', () => {
  it('sends exact SKU, price, UAT number and stable reference once under concurrent and repeated submission', async () => {
    const t = transport(); const p = new DingUatProvider(config, t.fetcher);
    const results = await Promise.all([p.submitTopUp(input), p.submitTopUp(input)]);
    await p.submitTopUp(input); expect(t.sends()).toBe(1); expect(results[0]).toEqual(results[1]);
    const reference = dingDistributorReference(input.customIdentifier);
    const call = t.fetcher.mock.calls.find(([url]) => String(url).endsWith('/SendTransfer'))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ SkuCode: rawProduct.SkuCode, SendValue: 5, SendCurrencyIso: 'USD', AccountNumber: rawProduct.UatNumber, DistributorRef: reference, ValidateOnly: false });
    expect(await p.getTopUpStatus(reference)).toMatchObject({ status: 'COMPLETED', rawStatus: 'Complete', operatorTransactionId: 'fixture-transfer-1' });
  });
  it('never submits to an ordinary recipient or substitutes a changed price', async () => {
    const t = transport(); const p = new DingUatProvider(config, t.fetcher);
    await expect(p.submitTopUp({ ...input, recipientPhone: '+18765559999' })).rejects.toMatchObject({ code: 'DING_UAT_NUMBER_REQUIRED' });
    await expect(p.submitTopUp({ ...input, amount: 6 })).rejects.toMatchObject({ code: 'TOPUP_QUOTE_CHANGED' });
    expect(t.sends()).toBe(0);
  });
  it('persists a lookup reference on timeout and later recovers status without a second transfer', async () => {
    const t = transport(); let attempts = 0;
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { if (String(url).endsWith('/SendTransfer')) { attempts++; throw new Error('fixture-timeout'); } return t.fetcher(url, init); });
    const p = new DingUatProvider(config, f); const ref = dingDistributorReference(input.customIdentifier);
    expect(await p.submitTopUp(input)).toMatchObject({ transactionId: ref, status: 'PROCESSING', rawStatus: 'SUBMISSION_UNKNOWN' });
    await expect(p.getTopUpStatus(ref)).rejects.toMatchObject({ code: 'DING_RECONCILIATION_REQUIRED' });
    expect(await p.submitTopUp(input)).toMatchObject({ status: 'PROCESSING' }); expect(attempts).toBe(1);
    t.records.set(ref, record(ref)); expect(await p.getTopUpStatus(ref)).toMatchObject({ status: 'COMPLETED' }); expect(attempts).toBe(1);
  });
  it('reconciles a lost successful response by reference instead of retrying', async () => {
    const t = transport(); const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { const result = await t.fetcher(url, init); if (String(url).endsWith('/SendTransfer')) throw new Error('fixture-lost-response'); return result; });
    expect(await new DingUatProvider(config, f).submitTopUp(input)).toMatchObject({ status: 'COMPLETED' }); expect(t.sends()).toBe(1);
  });
  it.each([['Submitted', 'PROCESSING'], ['Processing', 'PROCESSING'], ['Cancelling', 'PROCESSING'], ['Complete', 'COMPLETED'], ['Failed', 'FAILED'], ['Cancelled', 'FAILED']])('maps %s status safely', async (state, status) => {
    const t = transport(); const ref = dingDistributorReference('fixture-status'); t.records.set(ref, record(ref, state));
    expect(await new DingUatProvider(config, t.fetcher).getTopUpStatus(ref)).toMatchObject({ status, rawStatus: state });
  });
  it.each(['toString', 'constructor', '__proto__', 'Unexpected'])('rejects unknown processing state %s', async state => {
    const t = transport(); const ref = dingDistributorReference('fixture-status'); t.records.set(ref, record(ref, state));
    await expect(new DingUatProvider(config, t.fetcher).getTopUpStatus(ref)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
    expect(t.sends()).toBe(0);
  });
  it('rejects malformed string result codes even on a failed record', async () => {
    const t = transport(); const ref = dingDistributorReference('fixture-status');
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith('/ListTransferRecords')
      ? response(ok({ Items: [{ ResultCode: '4', ErrorCodes: [], TransferRecord: record(ref, 'Failed') }], ThereAreMoreItems: false })) : t.fetcher(url, init));
    await expect(new DingUatProvider(config, f).getTopUpStatus(ref)).rejects.toMatchObject({ code: 'DING_REQUEST_FAILED' });
    expect(t.sends()).toBe(0);
  });
  it('records provider-confirmed failure even when Ding includes error codes', async () => {
    const t = transport(); const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).endsWith('/SendTransfer')) return response({ ResultCode: 4, ErrorCodes: [{ Code: 'ProviderError' }], TransferRecord: record(dingDistributorReference(input.customIdentifier), 'Failed') });
      return t.fetcher(url, init);
    });
    expect(await new DingUatProvider(config, f).submitTopUp(input)).toMatchObject({ status: 'FAILED', rawStatus: 'Failed' });
  });
  it('invalidates a rejected bearer without automatically replaying a request', async () => {
    const t = transport(); let rejected = false;
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).includes('GetCountries') && !rejected) { rejected = true; return response({}, 401); }
      return t.fetcher(url, init);
    });
    const p = new DingUatProvider(config, f);
    await expect(p.listCountries()).rejects.toMatchObject({ code: 'DING_UNAVAILABLE' });
    await p.listCountries(); expect(t.fetcher.mock.calls.filter(([url]) => String(url) === DING_TOKEN_URL)).toHaveLength(2);
  });
  it('rejects conflicting/multiple lookup records and never resends on a lookup outage', async () => {
    const t = transport(); const ref = dingDistributorReference(input.customIdentifier);
    for (const body of [ok({ Items: [ok({ TransferRecord: record('wrong-ref') })], ThereAreMoreItems: false }), ok({ Items: [ok({ TransferRecord: record(ref) }), ok({ TransferRecord: record(ref) })], ThereAreMoreItems: false })]) {
      const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => String(url).endsWith('/ListTransferRecords') ? response(body) : t.fetcher(url, init));
      await expect(new DingUatProvider(config, f).submitTopUp(input)).rejects.toThrow(); expect(t.sends()).toBe(0);
    }
  });
});
describe('Ding router integration', () => {
  function service(t = transport()) {
    const repo = new MemoryMobileTopUpRepository(); const ding = new DingUatProvider(config, t.fetcher);
    const reloadly: MobileTopUpProvider = { ...ding, name: 'RELOADLY', listCountries: vi.fn(async () => [{ code: 'HT', name: 'Haiti' }, { code: 'JM', name: 'Jamaica' }]), listOperators: vi.fn(async () => []), getOperator: vi.fn(), detectOperator: vi.fn(), submitTopUp: vi.fn(), getTopUpStatus: vi.fn() };
    const router = new GlobalRechargeProviderRouter([['DING', ding], ['RELOADLY', reloadly]]);
    return { repo, router, reloadly, service: new MobileTopUpService(topupConfig, router, new MockMobileTopUpPaymentProvider(), repo, async () => {}) };
  }
  it('locks Ding quote/provider/SKU, preserves the $8.50 total and prevents duplicate recharge', async () => {
    const t = transport(); const s = service(t);
    const quote = await s.service.createQuote('fixture-user', { countryCode: 'JM', phone: input.recipientPhone, operatorId: globalId, productId: input.productId! });
    expect(quote).toMatchObject({ provider: 'DING', providerProductId: rawProduct.SkuCode, providerAmount: 5, feeUsd: 3.5, totalChargeUsd: 8.5 });
    const result = await s.service.purchase('fixture-user', { quoteId: quote.id }, 'fixture-idempotency');
    await s.service.purchase('fixture-user', { quoteId: quote.id }, 'fixture-idempotency');
    expect(result).toMatchObject({ provider: 'DING', providerProductId: rawProduct.SkuCode, status: 'DELIVERED' }); expect(result.providerTransactionId).toMatch(/^DING:tc-/);
    expect(t.sends()).toBe(1); expect(s.reloadly.submitTopUp).not.toHaveBeenCalled();
    expect(s.service.availability()).toMatchObject({ providers: ['RELOADLY', 'DING'], providerMode: 'MULTI_PROVIDER' });
  });
  it('keeps uncertain fulfillment durable across adapter restart without another send or provider fallback', async () => {
    const t = transport(); let sends = 0;
    const f = vi.fn(async (url: string | URL | Request, init?: RequestInit) => { if (String(url).endsWith('/SendTransfer')) { sends++; throw new Error('fixture-timeout'); } return t.fetcher(url, init); });
    const repo = new MemoryMobileTopUpRepository();
    const make = () => new MobileTopUpService(topupConfig, new GlobalRechargeProviderRouter([['DING', new DingUatProvider(config, f)]]), new MockMobileTopUpPaymentProvider(), repo, async () => {});
    const original = make(); const quote = await original.createQuote('fixture-user', { countryCode: 'JM', phone: input.recipientPhone, operatorId: globalId, productId: input.productId! });
    const pending = await original.purchase('fixture-user', { quoteId: quote.id }, 'fixture-uncertain-key');
    expect(pending).toMatchObject({ status: 'PROCESSING', providerStatus: 'SUBMISSION_UNKNOWN' });
    const restarted = make(); await restarted.purchase('fixture-user', { quoteId: quote.id }, 'fixture-uncertain-key'); expect(sends).toBe(1);
    const ref = dingDistributorReference(pending.customIdentifier); t.records.set(ref, record(ref));
    expect(await restarted.getTransaction('fixture-user', pending.id, true)).toMatchObject({ status: 'DELIVERED' }); expect(sends).toBe(1);
  });
  it('merges actual three-provider coverage, counts exclusive countries and isolates Ding outage', async () => {
    const s = service(); const dtone = { ...s.reloadly, name: 'DTONE' as const, listCountries: vi.fn(async () => [{ code: 'MX', name: 'Mexico' }]) };
    const ding = { ...s.reloadly, name: 'DING' as const, listCountries: vi.fn(async () => [{ code: 'JM', name: 'Jamaica' }, { code: 'MX', name: 'Mexico' }, { code: 'NG', name: 'Nigeria' }]) };
    const router = new GlobalRechargeProviderRouter([['DING', ding], ['DTONE', dtone], ['RELOADLY', s.reloadly]]);
    expect(router.providerNames).toEqual(['RELOADLY', 'DTONE', 'DING']);
    expect(await router.coverage()).toMatchObject({ uniqueCountries: 4, overlapCountries: ['JM', 'MX'], reloadlyOnlyCountries: ['HT'], dtoneOnlyCountries: [], dingOnlyCountries: ['NG'], providerOverlaps: { RELOADLY_DING: ['JM'], DTONE_DING: ['MX'] } });
    vi.mocked(ding.listCountries).mockRejectedValue(new Error('fixture-secret'));
    expect(await router.coverage()).toMatchObject({ uniqueCountries: 3, overlapCountries: [], providers: [{ provider: 'RELOADLY' }, { provider: 'DTONE' }, { provider: 'DING', enabled: true, countries: 0, reason: 'PROVIDER_UNAVAILABLE' }] });
  });
  it('reports Reloadly/Ding overlap with DT One disabled, through the authenticated coverage endpoint', async () => {
    const s = service();
    const app = createApp({ mobileTopUpConfig: topupConfig, mobileTopUpProvider: s.router });
    const auth = await request(app).post('/api/auth/register').send({ email: 'coverage@example.com', password: 'correct-horse-42', firstName: 'Fixture', lastName: 'User' }).expect(201);
    const result = await request(app).get('/api/mobile-topups/coverage').set('Authorization', `Bearer ${auth.body.accessToken}`).expect(200);
    expect(result.body).toMatchObject({ uniqueCountries: 2, overlapCountries: ['JM'], reloadlyOnlyCountries: ['HT'], dingOnlyCountries: [], providerOverlaps: { RELOADLY_DTONE: [], RELOADLY_DING: ['JM'], DTONE_DING: [] } });
    expect(result.body.providers).toContainEqual({ provider: 'DTONE', enabled: false, countries: 0, reason: 'NOT_CONFIGURED' });
    await request(app).get('/api/mobile-topups/coverage').expect(401);
  });
  it('deduplicates triple-provider overlap and excludes unsupported country metadata', async () => {
    const s = service();
    const countries = ['JM', 'HT', 'JM', 'AN'].map(code => ({ code, name: `Fixture ${code}` }));
    const dtone = { ...s.reloadly, name: 'DTONE' as const, listCountries: vi.fn(async () => countries) };
    const ding = { ...s.reloadly, name: 'DING' as const, listCountries: vi.fn(async () => countries) };
    const coverage = await new GlobalRechargeProviderRouter([['RELOADLY', s.reloadly], ['DTONE', dtone], ['DING', ding]]).coverage();
    expect(coverage).toMatchObject({ uniqueCountries: 2, overlapCountries: ['HT', 'JM'], reloadlyOnlyCountries: [], dtoneOnlyCountries: [], dingOnlyCountries: [], providerOverlaps: { RELOADLY_DTONE: ['HT', 'JM'], RELOADLY_DING: ['HT', 'JM'], DTONE_DING: ['HT', 'JM'] } });
  });
  it('does not invent overlaps from repeated rows in a single enabled catalog', async () => {
    const s = service();
    const ding = { ...s.reloadly, name: 'DING' as const, listCountries: vi.fn(async () => [{ code: 'JM', name: 'Jamaica' }, { code: 'JM', name: 'Jamaica' }]) };
    expect(await new GlobalRechargeProviderRouter([['DING', ding]]).coverage()).toMatchObject({ uniqueCountries: 1, overlapCountries: [], dingOnlyCountries: ['JM'], providerOverlaps: { RELOADLY_DTONE: [], RELOADLY_DING: [], DTONE_DING: [] } });
  });
  it('wires enabled Ding in createApp, while disabled Ding is absent from status', async () => {
    for (const enabled of ['false', 'true']) {
      vi.stubEnv('DING_ENABLED', enabled); vi.stubEnv('DING_CLIENT_ID', env.DING_CLIENT_ID); vi.stubEnv('DING_CLIENT_SECRET', env.DING_CLIENT_SECRET);
      const app = createApp({ mobileTopUpConfig: topupConfig });
      const auth = await request(app).post('/api/auth/register').send({ email: `ding-${enabled}@example.com`, password: 'correct-horse-42', firstName: 'Fixture', lastName: 'User' }).expect(201);
      const status = await request(app).get('/api/mobile-topups/status').set('Authorization', `Bearer ${auth.body.accessToken}`).expect(200);
      expect(status.body.providers).toEqual(enabled === 'true' ? ['RELOADLY', 'DING'] : ['RELOADLY']);
      expect(JSON.stringify(status.body)).not.toContain(env.DING_CLIENT_SECRET);
    }
  });
});
