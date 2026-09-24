import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, resetStore } from '../src/app.js';
import { GlobalRechargeProviderRouter } from '../src/topup/provider-router.js';
import { encodeOperatorId, decodeOperatorId, SLOT_SIZE, decodeTransactionReference } from '../src/topup/provider-identity.js';
import { MobileTopUpService, productsFromOperator } from '../src/topup/service.js';
import { MemoryMobileTopUpRepository } from '../src/topup/repository.js';
import { MockMobileTopUpPaymentProvider, MobileTopUpError, type MobileTopUpConfig, type MobileTopUpProvider, type MobileTopUpOperator, type MobileTopUpProviderName } from '../src/topup/types.js';

const config: MobileTopUpConfig = { enabled: true, environment: 'sandbox', clientId: 'fixture', clientSecret: 'fixture', authUrl: 'https://auth.reloadly.com/oauth/token', airtimeBaseUrl: 'https://topups-sandbox.reloadly.com', billingCurrency: 'USD', quoteTtlSeconds: 300, paymentMode: 'mock', productionEnabled: false, approvedForLiveUse: false };
const op: MobileTopUpOperator = { id: 255, name: 'Flow Jamaica fixture', countryCode: 'JM', status: true, bundle: false, denominationType: 'FIXED', senderCurrencyCode: 'USD', destinationCurrencyCode: 'JMD', fixedAmounts: [5], localFixedAmounts: [800], fixedAmountsPlanNames: {}, localFixedAmountsPlanNames: {} };
function fixture(provider: MobileTopUpProviderName, codes: string[]): MobileTopUpProvider {
  return { name: provider, listCountries: vi.fn(async () => codes.map(code => ({ code, name: code === 'JM' ? 'Jamaica' : `Country ${code}` }))),
    listOperators: vi.fn(async country => [{ ...op, countryCode: country, provider }]), getOperator: vi.fn(async () => ({ ...op, provider })),
    detectOperator: vi.fn(async () => ({ ...op, provider })),
    submitTopUp: vi.fn(async input => ({ transactionId: '123', status: 'SUCCESSFUL', requestedAmount: input.amount, requestedAmountCurrencyCode: 'USD' })),
    getTopUpStatus: vi.fn(async () => ({ transactionId: '123', status: 'SUCCESSFUL', requestedAmount: 5, requestedAmountCurrencyCode: 'USD' })),
    ...(provider === 'DTONE' ? { listProducts: vi.fn(async (country: string, id: number) => [{ id: `dtone:${country}:${encodeOperatorId('DTONE', id)}:product:56876`, provider, providerProductId: '56876', countryCode: country, operatorId: id, kind: 'AIRTIME' as const, name: 'Exact product', price: 5, priceCurrency: 'USD', deliveredCurrency: 'JMD', amountType: 'FIXED' as const }]) } : {}) };
}
beforeEach(() => { resetStore(); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Unexpected real network request'); })); });
afterEach(() => vi.unstubAllGlobals());
describe('global recharge identity', () => {
  it('preserves Reloadly IDs and separates every provider namespace', () => {
    expect(encodeOperatorId('RELOADLY', 255)).toBe(255);
    expect(encodeOperatorId('DTONE', 255)).toBe(700000255);
    expect(encodeOperatorId('DING', 255)).toBe(1400000255);
    for (const provider of ['RELOADLY', 'DTONE', 'DING'] as const) for (const id of [1, 255, SLOT_SIZE - 1]) {
      expect(decodeOperatorId(encodeOperatorId(provider, id))).toEqual({ provider, rawId: id });
    }
  });
  it.each([0, -1, 1.5, NaN, Infinity, 700000000, 1400000000, 2100000000, 2147483647, Number.MAX_SAFE_INTEGER])('rejects invalid global operator ID %s', id => {
    expect(() => decodeOperatorId(id)).toThrow(MobileTopUpError);
  });
  it.each([0, -1, 1.2, NaN, Infinity, SLOT_SIZE])('rejects invalid raw operator ID %s', id => expect(() => encodeOperatorId('DTONE', id)).toThrow(MobileTopUpError));
});
describe('provider catalog routing', () => {
  it.each(['RELOADLY', 'DING'] as const)('preserves %s carrier logos through global mapping and detection', async provider => {
    const logoUrl = 'https://cdn.example.test/carrier.png';
    const carrier = { ...op, provider, logoUrl };
    const adapter = fixture(provider, ['JM']);
    vi.mocked(adapter.listOperators).mockResolvedValue([carrier]);
    vi.mocked(adapter.getOperator).mockResolvedValue(carrier);
    vi.mocked(adapter.detectOperator).mockResolvedValue(carrier);
    const router = new GlobalRechargeProviderRouter([[provider, adapter]]);
    const id = encodeOperatorId(provider, op.id);
    for (const mapped of [(await router.listOperators('JM'))[0]!, await router.getOperator(id), await router.detectOperator('+18765551234', 'JM')]) {
      expect(mapped).toMatchObject({ id, provider, name: op.name, logoUrl });
    }
    expect(adapter.submitTopUp).not.toHaveBeenCalled();
  });

  it('unions actual countries without duplicates and reports overlap and disabled providers', async () => {
    const router = new GlobalRechargeProviderRouter([['RELOADLY', fixture('RELOADLY', ['HT', 'JM', 'MX', 'MX'])], ['DTONE', fixture('DTONE', ['MX', 'GH', 'NG'])]]);
    expect((await router.listCountries()).map(c => c.code)).toEqual(['GH', 'HT', 'JM', 'MX', 'NG']);
    expect(await router.coverage()).toMatchObject({ uniqueCountries: 5, overlapCountries: ['MX'], reloadlyOnlyCountries: ['HT', 'JM'], dtoneOnlyCountries: ['GH', 'NG'], providers: [{ provider: 'RELOADLY', countries: 3 }, { provider: 'DTONE', countries: 3 }, { provider: 'DING', enabled: false, countries: 0 }] });
  });
  it('uses a healthy provider after discovery failure, but fails when all fail', async () => {
    const reloadly = fixture('RELOADLY', ['JM']); const dtone = fixture('DTONE', ['GH']);
    vi.mocked(reloadly.listCountries).mockRejectedValue(new Error('DO_NOT_EXPOSE_SECRET'));
    const router = new GlobalRechargeProviderRouter([['RELOADLY', reloadly], ['DTONE', dtone]]);
    expect((await router.listCountries()).map(c => c.code)).toEqual(['GH']);
    expect(JSON.stringify(await router.coverage())).not.toContain('DO_NOT_EXPOSE_SECRET');
    vi.mocked(dtone.listCountries).mockRejectedValue(new Error());
    await expect(router.listCountries()).rejects.toMatchObject({ code: 'TOPUP_PROVIDERS_UNAVAILABLE', statusCode: 502 });
  });
  it('rejects malformed catalogs without leaking or advertising invalid data', async () => {
    const bad = fixture('RELOADLY', []); vi.mocked(bad.listCountries).mockResolvedValue([{ code: 'USA', name: 'invalid' }]);
    const router = new GlobalRechargeProviderRouter([['RELOADLY', bad], ['DTONE', fixture('DTONE', ['GH'])]]);
    expect((await router.listCountries()).map(c => c.code)).toEqual(['GH']);
    expect((await router.coverage()).providers[0]).toMatchObject({ countries: 0, reason: 'INVALID_PROVIDER_RESPONSE' });
    await expect(new GlobalRechargeProviderRouter([['RELOADLY', bad]]).listCountries()).rejects.toMatchObject({ statusCode: 502 });
  });
  it('excludes unsupported phone destinations from coverage just as the public country catalog does', async () => {
    const router = new GlobalRechargeProviderRouter([['RELOADLY', fixture('RELOADLY', ['JM', 'AN'])]]);
    expect((await router.coverage()).uniqueCountries).toBe(1);
    const service = new MobileTopUpService(config, router, new MockMobileTopUpPaymentProvider(), new MemoryMobileTopUpRepository(), async () => {});
    expect(await service.listCountries()).toEqual([{ code: 'JM', name: 'Jamaica', callingCode: '+1' }]);
  });
  it('namespaces duplicate raw operator IDs and calls only the decoded owner', async () => {
    const reloadly = fixture('RELOADLY', ['JM']); const dtone = fixture('DTONE', ['JM']);
    const router = new GlobalRechargeProviderRouter([['DTONE', dtone], ['RELOADLY', reloadly]]);
    expect((await router.listOperators('JM')).map(o => o.id)).toEqual([255, 700000255]);
    await router.getOperator(700000255); expect(dtone.getOperator).toHaveBeenCalledWith(255); expect(reloadly.getOperator).not.toHaveBeenCalled();
    expect((await router.detectOperator('+18765551234', 'JM')).provider).toBe('RELOADLY');
    vi.mocked(reloadly.detectOperator).mockRejectedValue(new Error());
    expect((await router.detectOperator('+18765551234', 'JM')).provider).toBe('DTONE');
  });
  it('does not mix operators from the wrong country or silently accept changed lookup IDs', async () => {
    const provider = fixture('RELOADLY', ['JM']); vi.mocked(provider.listOperators).mockResolvedValue([{ ...op, countryCode: 'HT' }]);
    const router = new GlobalRechargeProviderRouter([['RELOADLY', provider]]);
    await expect(router.listOperators('JM')).rejects.toMatchObject({ statusCode: 502 });
    await expect(router.getOperator(256)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  });
  it('routes legacy Reloadly references and validates namespaced provider references', async () => {
    const reloadly = fixture('RELOADLY', ['JM']); const dtone = fixture('DTONE', ['JM']);
    const router = new GlobalRechargeProviderRouter([['RELOADLY', reloadly], ['DTONE', dtone]]);
    await router.getTopUpStatus('123', 'RELOADLY'); expect(reloadly.getTopUpStatus).toHaveBeenCalledWith('123');
    await router.getTopUpStatus('DTONE:123', 'DTONE'); expect(dtone.getTopUpStatus).toHaveBeenCalledWith('123');
    await expect(router.getTopUpStatus('DTONE:123', 'RELOADLY')).rejects.toMatchObject({ code: 'TOPUP_PROVIDER_MISMATCH' });
    expect(() => decodeTransactionReference('OTHER:123')).toThrow();
  });
});
describe('immutable quote and payment routing', () => {
  it.each(['RELOADLY', 'DTONE'] as const)('persists and submits %s quote, transaction and recipient to the same provider', async provider => {
    const reloadly = fixture('RELOADLY', ['JM']); const dtone = fixture('DTONE', ['JM']);
    const router = new GlobalRechargeProviderRouter([['RELOADLY', reloadly], ['DTONE', dtone]]);
    const repository = new MemoryMobileTopUpRepository();
    const service = new MobileTopUpService(config, router, new MockMobileTopUpPaymentProvider(), repository, async () => {});
    const operatorId = encodeOperatorId(provider, 255); const { products } = await service.products('JM', operatorId);
    const recipient = await service.saveRecipient('user', { nickname: 'Fixture', countryCode: 'JM', phone: '+18765551234', operatorId });
    expect(recipient.provider).toBe(provider);
    const quote = await service.createQuote('user', { countryCode: 'JM', phone: '+18765551234', operatorId, productId: products[0]!.id });
    expect(quote).toMatchObject({ provider, providerAmount: 5, feeUsd: 0.99, totalChargeUsd: 5.99 });
    if (provider === 'DTONE') expect(quote.providerProductId).toBe('56876');
    else expect(quote.productId).toBe('reloadly:JM:255:airtime:5.00');
    const result = await service.purchase('user', { quoteId: quote.id, recipientId: recipient.id }, 'idempotency-123');
    expect(result).toMatchObject({ provider, status: 'DELIVERED', providerTransactionId: `${provider}:123` });
    const owner = provider === 'DTONE' ? dtone : reloadly; const other = provider === 'DTONE' ? reloadly : dtone;
    expect(owner.submitTopUp).toHaveBeenCalledWith(expect.objectContaining({ operatorId: 255, productId: quote.productId, provider, amount: 5 }));
    expect(other.submitTopUp).not.toHaveBeenCalled();
    await service.purchase('user', { quoteId: quote.id, recipientId: recipient.id }, 'idempotency-123');
    expect(owner.submitTopUp).toHaveBeenCalledTimes(1);
  });
  it.each([['CREATED', 'PENDING'], ['CONFIRMED', 'PROCESSING'], ['SUBMITTED', 'PROCESSING'], ['COMPLETED', 'DELIVERED'], ['REJECTED', 'FAILED'], ['DECLINED', 'FAILED'], ['CANCELLED', 'FAILED'], ['REVERSED', 'REFUNDED']])('maps DT One %s to %s and retains raw status', async (providerStatus, expected) => {
    const dtone = fixture('DTONE', ['JM']);
    vi.mocked(dtone.submitTopUp).mockResolvedValue({ transactionId: '123', status: providerStatus!, rawStatus: 'PROVIDER_DETAIL', requestedAmount: 5, requestedAmountCurrencyCode: 'USD' });
    const service = new MobileTopUpService(config, new GlobalRechargeProviderRouter([['DTONE', dtone]]), new MockMobileTopUpPaymentProvider(), new MemoryMobileTopUpRepository(), async () => {});
    const quote = await service.createQuote('user', { countryCode: 'JM', phone: '+18765551234', operatorId: 700000255, productId: 'dtone:JM:700000255:product:56876' });
    const result = await service.purchase('user', { quoteId: quote.id }, 'idempotency-123');
    expect(result).toMatchObject({ status: expected, providerStatus: 'PROVIDER_DETAIL', providerTransactionId: 'DTONE:123' });
  });
  it('rejects malformed native product catalogs with a controlled error', async () => {
    const dtone = fixture('DTONE', ['JM']);
    vi.mocked(dtone.listProducts!).mockResolvedValue([null] as never);
    const service = new MobileTopUpService(config, new GlobalRechargeProviderRouter([['DTONE', dtone]]), new MockMobileTopUpPaymentProvider(), new MemoryMobileTopUpRepository(), async () => {});
    await expect(service.products('JM', 700000255)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE', statusCode: 502 });
  });
  it('never falls back after payment and retains reconciliation state on uncertain submission', async () => {
    const reloadly = fixture('RELOADLY', ['JM']); const dtone = fixture('DTONE', ['JM']);
    vi.mocked(dtone.submitTopUp).mockRejectedValue(new MobileTopUpError('DTONE_UNAVAILABLE', 'unavailable', 502));
    const repository = new MemoryMobileTopUpRepository();
    const service = new MobileTopUpService(config, new GlobalRechargeProviderRouter([['RELOADLY', reloadly], ['DTONE', dtone]]), new MockMobileTopUpPaymentProvider(), repository, async () => {});
    const quote = await service.createQuote('user', { countryCode: 'JM', phone: '+18765551234', operatorId: 700000255, productId: 'dtone:JM:700000255:product:56876' });
    await expect(service.purchase('user', { quoteId: quote.id }, 'idempotency-123')).rejects.toMatchObject({ code: 'TOPUP_SUBMISSION_UNKNOWN' });
    expect(reloadly.submitTopUp).not.toHaveBeenCalled();
    expect((await repository.listTransactions('user'))[0]).toMatchObject({ provider: 'DTONE', paymentRecoveryCode: 'FULFILLMENT_RECONCILIATION_REQUIRED' });
  });
  it('rejects a mismatched provider before any submission and preserves old Reloadly product discovery', async () => {
    const reloadly = fixture('RELOADLY', ['JM']); const router = new GlobalRechargeProviderRouter([['RELOADLY', reloadly]]);
    expect(await router.listProducts('JM', 255)).toBeUndefined();
    expect(productsFromOperator(op)[0]!.id).toBe('reloadly:JM:255:airtime:5.00');
    await expect(router.submitTopUp({ provider: 'DTONE', operatorId: 255, productId: 'dtone:JM:255:product:5', amount: 5, recipientPhone: '+18765551234', recipientCountryCode: 'JM', customIdentifier: 'fixture' })).rejects.toMatchObject({ code: 'TOPUP_PROVIDER_MISMATCH' });
    expect(reloadly.submitTopUp).not.toHaveBeenCalled();
  });
  it('exposes authenticated coverage and actual enabled providers without credentials', async () => {
    const app = createApp({ mobileTopUpConfig: config, mobileTopUpProvider: new GlobalRechargeProviderRouter([['RELOADLY', fixture('RELOADLY', ['JM'])]]) });
    await request(app).get('/api/mobile-topups/coverage').expect(401);
    const auth = await request(app).post('/api/auth/register').send({ email: 'routing@example.com', password: 'correct-horse-42', firstName: 'Ti', lastName: 'Cash' }).expect(201);
    const headers = { Authorization: `Bearer ${auth.body.accessToken}` };
    const coverage = await request(app).get('/api/mobile-topups/coverage').set(headers).expect(200);
    expect(coverage.body.uniqueCountries).toBe(1); expect(coverage.body.providers[1]).toMatchObject({ provider: 'DTONE', enabled: false, reason: 'NOT_CONFIGURED' });
    const status = await request(app).get('/api/mobile-topups/status').set(headers).expect(200);
    expect(status.body).toMatchObject({ providers: ['RELOADLY'], providerMode: 'SINGLE_PROVIDER', productionEnabled: false, liveRechargeEnabled: false });
    expect(JSON.stringify([coverage.body, status.body])).not.toMatch(/clientSecret|apiSecret|apiKey/);
  });
});
