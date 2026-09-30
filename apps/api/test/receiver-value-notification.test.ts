import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { MemoryMobileTopUpRepository, resetMobileTopUpStore } from '../src/topup/repository.js';
import { MobileTopUpService } from '../src/topup/service.js';
import { MockMobileTopUpPaymentProvider, type MobileTopUpConfig, type MobileTopUpOperator, type MobileTopUpProvider } from '../src/topup/types.js';
import { ReceiverNotificationService, receiverLanguage, receiverMessage } from '../src/topup/receiver-notification.js';
import { ReloadlySandboxTopUpProvider } from '../src/topup/reloadly-provider.js';
import { GlobalRechargeProviderRouter } from '../src/topup/provider-router.js';
import { reloadlyProducts } from '../src/topup/product-catalog.js';

const config: MobileTopUpConfig = { enabled: true, environment: 'sandbox', clientId: 'fixture', clientSecret: 'fixture',
  authUrl: 'https://auth.reloadly.com/oauth/token', airtimeBaseUrl: 'https://topups-sandbox.reloadly.com',
  billingCurrency: 'USD', quoteTtlSeconds: 300, paymentMode: 'mock', productionEnabled: false, approvedForLiveUse: false };
const operator: MobileTopUpOperator = { id: 173, name: 'Fixture carrier', countryCode: 'HT', status: true, bundle: false,
  denominationType: 'FIXED', senderCurrencyCode: 'USD', destinationCurrencyCode: 'HTG', fixedAmounts: [5], localFixedAmounts: [650],
  fixedAmountsPlanNames: {}, localFixedAmountsPlanNames: {} };
const input = { countryCode: 'HT', phone: '+50937123456', operatorId: 173, productId: 'reloadly:HT:173:airtime:5.00' };
function fixture(status = 'SUCCESSFUL', amount: number | undefined = 655, currency: string | undefined = 'HTG') {
  const result = { transactionId: 'provider-fixture', status, requestedAmount: 5, requestedAmountCurrencyCode: 'USD',
    deliveredAmount: amount, deliveredAmountCurrencyCode: currency };
  const submit = vi.fn(async () => result);
  const provider: MobileTopUpProvider = { listCountries: async () => [{ code: 'HT', name: 'Haiti' }],
    listOperators: async () => [operator], getOperator: async () => operator, detectOperator: async () => operator,
    submitTopUp: submit, getTopUpStatus: vi.fn(async () => result) };
  const repository = new MemoryMobileTopUpRepository();
  const service = new MobileTopUpService(config, provider, new MockMobileTopUpPaymentProvider(), repository, async () => {});
  return { provider, repository, service, submit, result };
}
beforeEach(() => { resetMobileTopUpStore(); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network forbidden'); })); });
afterEach(() => vi.unstubAllGlobals());

describe('authoritative receiver values and outbox', () => {
  it('keeps immutable quote, sender values and actual delivery separately; replay creates one notification', async () => {
    const f = fixture();
    const quote = await f.service.createQuote('customer', input);
    expect(quote.receiverQuote).toMatchObject({ amount: 650, currency: 'HTG', senderAmount: 5, senderCurrency: 'USD', source: 'PROVIDER_PRODUCT' });
    expect(quote.totalChargeUsd).toBe(5.99);
    const tx = await f.service.purchase('customer', { quoteId: quote.id }, 'receiver-test-key');
    expect(tx).toMatchObject({ deliveredValue: 655, deliveredCurrency: 'HTG', receiverDiscrepancy: true, status: 'DELIVERED', providerAmount: 5 });
    expect(tx.receiverQuote).toEqual(quote.receiverQuote);
    const first = await f.repository.getNotification(tx.id);
    expect(first).toMatchObject({ amount: 655, currency: 'HTG', language: 'ht', attempts: 0, status: 'PENDING' });
    await f.service.purchase('customer', { quoteId: quote.id }, 'receiver-test-key');
    await Promise.all([f.service.getTransaction('customer', tx.id, true), f.service.getTransaction('customer', tx.id, true)]);
    expect(await f.repository.getNotification(tx.id)).toEqual(first);
    expect(f.submit).toHaveBeenCalledTimes(1);
    f.result.deliveredAmount = 999;
    expect((await f.service.getTransaction('customer', tx.id, true)).deliveredValue).toBe(655);
    expect((await f.repository.getQuote('customer', quote.id))?.receiverQuote).toEqual(quote.receiverQuote);
  });
  it.each(['PENDING', 'PROCESSING', 'FAILED', 'UNKNOWN'])('%s never creates a success notification or claims an actual value', async status => {
    const f = fixture(status); const quote = await f.service.createQuote('customer', input);
    const tx = await f.service.purchase('customer', { quoteId: quote.id }, 'status-test-key');
    expect(await f.repository.getNotification(tx.id)).toBeUndefined();
    expect(tx.deliveredValue).toBeUndefined();
  });
  it('missing actual delivery records a discrepancy and never substitutes the quote into SMS', async () => {
    const f = fixture(); f.result.deliveredAmount = undefined;
    const quote = await f.service.createQuote('customer', input);
    const tx = await f.service.purchase('customer', { quoteId: quote.id }, 'missing-actual-key');
    expect(tx).toMatchObject({ status: 'DELIVERED', receiverDiscrepancy: true });
    expect(tx.deliveredValue).toBeUndefined();
    expect(await f.repository.getNotification(tx.id)).toBeUndefined();
    f.result.deliveredAmount = 650;
    await f.service.getTransaction('customer', tx.id, true);
    expect(await f.repository.getNotification(tx.id)).toMatchObject({ amount: 650 });
  });
  it('rejects mismatched phone/country, fabricated denomination and absent receiving metadata', async () => {
    const f = fixture();
    await expect(f.service.createQuote('customer', { ...input, countryCode: 'JM' })).rejects.toMatchObject({ code: 'INVALID_TOPUP_PHONE' });
    await expect(f.service.createQuote('customer', { ...input, productId: 'reloadly:HT:173:airtime:12.00' })).rejects.toMatchObject({ code: 'TOPUP_PRODUCT_UNAVAILABLE' });
    f.provider.getOperator = async () => ({ ...operator, localFixedAmounts: [] });
    await expect(f.service.createQuote('customer', input)).rejects.toMatchObject({ code: 'RECEIVER_VALUE_UNAVAILABLE' });
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('locks saved supported receiver preference without changing country or monetary data', async () => {
    const f = fixture();
    const recipient = await f.service.saveRecipient('customer', { nickname: 'Family', phone: input.phone, countryCode: 'HT', language: 'fr' });
    const quote = await f.service.createQuote('customer', input);
    const tx = await f.service.purchase('customer', { quoteId: quote.id, recipientId: recipient.id }, 'saved-language-key');
    expect(await f.repository.getNotification(tx.id)).toMatchObject({ language: 'fr', amount: 655, currency: 'HTG' });
  });
  it('unknown SMS acceptance cannot be retried, and never changes recharge or ledger state', async () => {
    const f = fixture(); const q = await f.service.createQuote('customer', input);
    const tx = await f.service.purchase('customer', { quoteId: q.id }, 'sms-failure-key');
    const send = vi.fn(async () => { throw new Error('sensitive provider response'); });
    const notifications = new ReceiverNotificationService(f.repository, { send });
    await notifications.retry(tx.id); await notifications.retry(tx.id);
    expect(send).toHaveBeenCalledTimes(1);
    expect(await f.repository.getNotification(tx.id)).toMatchObject({ status: 'FAILED', lastErrorCategory: 'SMS_OUTCOME_UNKNOWN', attempts: 1 });
    expect(await f.repository.getTransactionById(tx.id)).toEqual(tx);
    expect(JSON.stringify(await f.repository.getNotification(tx.id))).not.toContain('sensitive');
  });
  it('safe rejection retry reuses one record/key; concurrent retries and delivered replay never duplicate SMS', async () => {
    const f = fixture(); const q = await f.service.createQuote('customer', input);
    const tx = await f.service.purchase('customer', { quoteId: q.id }, 'sms-retry-key');
    const disabled = new ReceiverNotificationService(f.repository);
    await disabled.retry(tx.id);
    expect(await f.repository.getNotification(tx.id)).toMatchObject({ status: 'FAILED', lastErrorCategory: 'SMS_NOT_CONFIGURED' });
    const send = vi.fn(async () => ({ status: 'DELIVERED' as const, messageId: 'message-fixture' }));
    const notifications = new ReceiverNotificationService(f.repository, { send });
    await Promise.all([notifications.retry(tx.id), notifications.retry(tx.id), notifications.retry(tx.id)]);
    await notifications.retry(tx.id);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]).toEqual([{ to: input.phone, message: expect.stringContaining('655 HTG'), idempotencyKey: `recharge-receiver:${tx.id}` }]);
    expect(await f.repository.getNotification(tx.id)).toMatchObject({ status: 'DELIVERED', attempts: 2 });
  });
  it('never sends a queued success message after the provider subsequently reverses delivery', async () => {
    const f = fixture(); const q = await f.service.createQuote('customer', input);
    const tx = await f.service.purchase('customer', { quoteId: q.id }, 'sms-reversal-key');
    await f.repository.updateTransaction(tx.id, { status: 'REFUNDED' });
    const send = vi.fn(async () => ({ status: 'DELIVERED' as const, messageId: 'never' }));
    await new ReceiverNotificationService(f.repository, { send }).retry(tx.id);
    expect(send).not.toHaveBeenCalled();
  });
  it('does not round away precision in a provider receiving quote', async () => {
    const f = fixture();
    f.provider.getOperator = async () => ({ ...operator, localFixedAmounts: [650.123456789] });
    await expect(f.service.createQuote('customer', input)).rejects.toMatchObject({ code: 'RECEIVER_VALUE_UNAVAILABLE' });
    expect(f.submit).not.toHaveBeenCalled();
  });
  it('rejects anonymous arbitrary notification attempts', async () => {
    const app = createApp();
    await request(app).post('/api/admin/flupflap/transactions/00000000-0000-4000-8000-000000000001/receiver-notification/retry')
      .send({ to: '+15555555555', message: 'arbitrary' }).expect(401);
  });
});

describe('receiver localization', () => {
  it.each([['HT', 'ht'], ['BR', 'pt'], ['DO', 'es'], ['MX', 'es'], ['FR', 'fr'], ['SN', 'fr'], ['CI', 'fr'],
    ['JM', 'en'], ['US', 'en'], ['NG', 'en'], ['GH', 'en'], ['KE', 'en'], ['TZ', 'en'], ['CA', 'en'], ['ZZ', 'en']])('%s defaults to %s', (country, language) => {
    expect(receiverLanguage(country)).toBe(language);
    expect(receiverMessage({ language, amount: 1320, currency: 'HTG' })).toContain('1320 HTG');
  });
  it('preference then operator preference precede default, unsupported preferences fall back', () => {
    expect(receiverLanguage('HT', 'fr', 'es')).toBe('fr');
    expect(receiverLanguage('KE', undefined, 'sw')).toBe('sw');
    expect(receiverLanguage('CA', 'fr')).toBe('fr');
    expect(receiverLanguage('HT', 'invalid', 'invalid')).toBe('ht');
    expect(receiverMessage({ language: 'invalid', amount: 500, currency: 'DOP' })).toContain('was successful');
    expect(receiverMessage({ language: 'ht', amount: 650, currency: 'HTG' })).not.toContain('USD');
  });
});

describe('Reloadly receiver quote contract (mock transport only)', () => {
  it('uses exact per-amount provider FX output through the provider router, not a USD multiplier', async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'fixture', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 173, fxRate: 922.56789, currencyCode: 'HTG' })));
    const provider = new ReloadlySandboxTopUpProvider(config, transport);
    const router = new GlobalRechargeProviderRouter([['RELOADLY', provider]]);
    const product = reloadlyProducts({ ...operator, denominationType: 'RANGE', minAmount: 5, maxAmount: 20 })[0]!;
    const value = await router.quoteReceiverValue(product, 7);
    expect(value).toMatchObject({ amount: 922.56789, currency: 'HTG', senderAmount: 7, source: 'RELOADLY_FX' });
    expect(String(transport.mock.calls[1]![0])).toBe('https://topups-sandbox.reloadly.com/operators/fx-rate');
    expect(JSON.parse(String(transport.mock.calls[1]![1]!.body))).toEqual({ operatorId: 173, amount: 7 });
  });
  it.each([{ id: 999, fxRate: 650, currencyCode: 'HTG' }, { id: 173, fxRate: 650, currencyCode: 'USD' },
    { id: 173, fxRate: -1, currencyCode: 'HTG' }, { id: 173, currencyCode: 'HTG' }])('fails closed on malformed/mismatched FX %j', async body => {
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'fixture', expires_in: 3600 })))
      .mockResolvedValueOnce(new Response(JSON.stringify(body)));
    const provider = new ReloadlySandboxTopUpProvider(config, transport);
    const product = reloadlyProducts({ ...operator, denominationType: 'RANGE', minAmount: 5, maxAmount: 20 })[0]!;
    await expect(provider.quoteReceiverValue(product, 7)).rejects.toMatchObject({ code: 'INVALID_PROVIDER_RESPONSE' });
  });
});
