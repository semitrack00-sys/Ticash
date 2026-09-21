import { describe, expect, it, vi } from 'vitest';
import { ReloadlySandboxTopUpProvider } from '../src/topup/reloadly-provider.js';
import type { MobileTopUpConfig } from '../src/topup/types.js';

const config: MobileTopUpConfig = {
  enabled: true,
  environment: 'sandbox',
  clientId: 'sandbox-id',
  clientSecret: 'sandbox-secret',
  authUrl: 'https://auth.reloadly.com/oauth/token',
  airtimeBaseUrl: 'https://topups-sandbox.reloadly.com',
  billingCurrency: 'USD',
  feeUsd: '0.00',
  quoteTtlSeconds: 300,
  paymentMode: 'mock',
  productionEnabled: false,
  approvedForLiveUse: false,
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Reloadly Sandbox top-up provider', () => {
  it('uses server-side OAuth and provider-returned operator country data', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(json([{ operatorId: 12, name: 'Sandbox Jamaica Mobile', status: true,
        country: { isoName: 'JM' }, denominationType: 'FIXED', senderCurrencyCode: 'USD',
        destinationCurrencyCode: 'JMD', fixedAmounts: [5], localFixedAmounts: [780] }]));
    const provider = new ReloadlySandboxTopUpProvider(config, fetchMock);
    const operators = await provider.listOperators('jm');
    expect(operators).toHaveLength(1);
    expect(operators[0]).toMatchObject({ id: 12, countryCode: 'JM', fixedAmounts: [5] });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(config.authUrl);
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      client_id: 'sandbox-id', grant_type: 'client_credentials', audience: config.airtimeBaseUrl,
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(`${config.airtimeBaseUrl}/operators/countries/JM`);
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('authorization')).toBe('******');
  });

  it('lists provider-backed supported countries', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(json([
        { isoName: 'HT', name: 'Haiti' },
        { isoName: 'JM', name: 'Jamaica' },
      ]));
    const provider = new ReloadlySandboxTopUpProvider(config, fetchMock);

    await expect(provider.listCountries()).resolves.toEqual([
      { code: 'HT', name: 'Haiti' },
      { code: 'JM', name: 'Jamaica' },
    ]);
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(`${config.airtimeBaseUrl}/countries`);
  });

  it('submits a provider purchase without exposing credentials in its body', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(json({ transactionId: 44, status: 'PROCESSING', requestedAmount: 5,
        requestedAmountCurrencyCode: 'USD' }));
    const provider = new ReloadlySandboxTopUpProvider(config, fetchMock);
    await provider.submitTopUp({ operatorId: 12, amount: 5, recipientPhone: '+18765551234',
      recipientCountryCode: 'JM', customIdentifier: 'ticash-topup-test' });
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(body).toMatchObject({ operatorId: 12, amount: 5, useLocalAmount: false,
      recipientPhone: { countryCode: 'JM', number: '18765551234' } });
    expect(body.client_secret).toBeUndefined();
  });

  it('accepts the current Reloadly status response transaction field', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(json({
        transaction: {
          transactionId: 179204,
          status: 'SUCCESSFUL',
          requestedAmount: 4,
          requestedAmountCurrencyCode: 'USD',
          deliveredAmount: 523.57,
          deliveredAmountCurrencyCode: 'JMD',
        },
        status: 'SUCCESSFUL',
        code: 'TOPUP_SUCCESSFUL',
        message: 'The top-up was completed',
      }));
    const provider = new ReloadlySandboxTopUpProvider(config, fetchMock);

    await expect(provider.getTopUpStatus('179204')).resolves.toMatchObject({
      transactionId: '179204',
      status: 'SUCCESSFUL',
      requestedAmount: 4,
      deliveredAmount: 523.57,
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      `${config.airtimeBaseUrl}/topups/179204/status`,
    );
  });
});
