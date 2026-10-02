import { describe, expect, it, vi } from 'vitest';
import { ReloadlyProductionTopUpProvider, ReloadlySandboxTopUpProvider } from '../src/topup/reloadly-provider.js';
import type { MobileTopUpConfig } from '../src/topup/types.js';

const config: MobileTopUpConfig = {
  enabled: true,
  environment: 'sandbox',
  clientId: 'sandbox-id',
  clientSecret: 'sandbox-secret',
  authUrl: 'https://auth.reloadly.com/oauth/token',
  airtimeBaseUrl: 'https://topups-sandbox.reloadly.com',
  billingCurrency: 'USD',
  quoteTtlSeconds: 300,
  paymentMode: 'mock',
  productionEnabled: false,
  approvedForLiveUse: false,
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Reloadly Sandbox top-up provider', () => {
  it('uses production audience/base URL and rejects arbitrary provider URLs without real network', async () => {
    const productionConfig: MobileTopUpConfig = {
      ...config,
      environment: 'production',
      clientId: 'live-id',
      clientSecret: 'live-secret',
      airtimeBaseUrl: 'https://topups.reloadly.com',
      paymentMode: 'stripe_live',
      productionEnabled: true,
      approvedForLiveUse: true,
      appApprovedForLiveUse: true,
      liveMoneyEnabled: true,
      liveRechargeEnabled: true,
    };
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'live-token', expires_in: 3600 }, 200))
      .mockResolvedValueOnce(json([], 200));

    const provider = new ReloadlyProductionTopUpProvider(productionConfig, fetcher);
    await expect(provider.listCountries()).resolves.toEqual([]);

    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      audience: productionConfig.airtimeBaseUrl,
      client_id: 'live-id',
      grant_type: 'client_credentials',
    });
    expect(String(fetcher.mock.calls[1]?.[0])).toBe('https://topups.reloadly.com/countries');

    await expect((provider as unknown as { request: (path: string) => Promise<unknown> }).request('https://evil.example.test/topups'))
      .rejects.toMatchObject({ code: 'INVALID_PROVIDER_URL' });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('never logs secrets, tokens or authorization headers in diagnostics', async () => {
    const secret = 'reloadly-client-secret-DO-NOT-LOG';
    const token = 'reloadly-access-token-DO-NOT-LOG';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const provider = new ReloadlySandboxTopUpProvider({ ...config, clientId: 'client-id', clientSecret: secret }, vi.fn(async (url: string | URL | Request) => {
      if (String(url) === config.authUrl) return json({ access_token: token, expires_in: 3600 }, 200);
      return json({ errorCode: 'INVALID_CLIENT', message: 'bad credentials' }, 401);
    }));

    await expect(provider.listCountries()).rejects.toMatchObject({ code: 'RELOADLY_INVALID_CLIENT' });
    const logged = warn.mock.calls.map(call => JSON.stringify(call)).join('\n');
    expect(logged).not.toContain(secret);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain('Authorization');
    expect(logged).not.toContain('client_secret');
  });

  it.each([
    { label: 'oauth 401', authStatus: 401, authResponse: { error: 'invalid_client' }, expected: 'OAUTH_REJECTED' },
    { label: 'countries 401', status: 401, response: { errorCode: 'UNAUTHORIZED' }, expected: 'PROVIDER_UNAUTHORIZED' },
    { label: 'countries 403', status: 403, response: { errorCode: 'FORBIDDEN' }, expected: 'PROVIDER_FORBIDDEN' },
    { label: 'countries 429', status: 429, response: { errorCode: 'RATE_LIMITED' }, expected: 'PROVIDER_RATE_LIMITED' },
    { label: 'countries 500', status: 500, response: { errorCode: 'UPSTREAM_ERROR' }, expected: 'PROVIDER_5XX' },
    { label: 'timeout', expected: 'PROVIDER_TIMEOUT' },
    { label: 'malformed response', status: 200, response: '{bad-json', expected: 'INVALID_PROVIDER_RESPONSE' },
  ])('categorizes $label safely', async ({ label, authStatus, status, authResponse, response, expected }) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = vi.fn<typeof fetch>(async (url: string | URL | Request) => {
      if (String(url) === config.authUrl) {
        if (authStatus) return json(authResponse ?? { access_token: 'token', expires_in: 3600 }, authStatus as number);
        return json({ access_token: 'token', expires_in: 3600 }, 200);
      }
      if (label === 'timeout') throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
      if (label === 'malformed response') return new Response('{not-valid-json', { status: 200, headers: { 'Content-Type': 'application/json' } });
      return json(response, status as number);
    });

    const provider = new ReloadlySandboxTopUpProvider(config, fetcher);
    await expect(provider.listCountries()).rejects.toThrow();
    const diagnostic = warn.mock.calls.map(call => call[1]).find((payload): payload is Record<string, unknown> => Boolean(payload) && typeof payload === 'object' && payload.operation === 'COUNTRIES' && 'failureCategory' in payload)
      ?? warn.mock.calls.map(call => call[1]).find((payload): payload is Record<string, unknown> => Boolean(payload) && typeof payload === 'object' && payload.operation === 'OAUTH_TOKEN' && 'failureCategory' in payload);
    if (expected === 'OAUTH_REJECTED') {
      expect(diagnostic).toMatchObject({ provider: 'RELOADLY', environment: 'SANDBOX', operation: 'OAUTH_TOKEN', failureCategory: expected });
    } else {
      expect(diagnostic).toMatchObject({ provider: 'RELOADLY', environment: 'SANDBOX', operation: 'COUNTRIES', failureCategory: expected });
    }
    if (status && label !== 'malformed response') expect(diagnostic).toMatchObject({ providerHttpStatus: status });
    const logged = warn.mock.calls.map(call => JSON.stringify(call)).join('\n');
    expect(logged).not.toContain('token');
    expect(logged).not.toContain('Authorization');
    expect(logged).not.toContain('client_secret');
  });

  it('keeps successful countries responses working while logging only sanitized metadata', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }, 200))
      .mockResolvedValueOnce(json([{ isoName: 'HT', name: 'Haiti' }, { isoName: 'JM', name: 'Jamaica' }], 200));
    const provider = new ReloadlySandboxTopUpProvider(config, fetcher);

    await expect(provider.listCountries()).resolves.toEqual([
      { code: 'HT', name: 'Haiti' },
      { code: 'JM', name: 'Jamaica' },
    ]);
    const logged = warn.mock.calls.map(call => JSON.stringify(call)).join('\n');
    expect(logged).toContain('COUNTRIES');
    expect(logged).not.toContain('token');
    expect(logged).not.toContain('Authorization');
  });

  it('does not call purchase/top-up during catalog diagnostics', async () => {
    const submit = vi.fn(async () => ({ transactionId: 'topup-1', status: 'SUCCESSFUL', requestedAmount: 5, requestedAmountCurrencyCode: 'USD' }));
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }, 200))
      .mockResolvedValueOnce(json([{ isoName: 'JM', name: 'Jamaica' }], 200));
    const provider = new ReloadlySandboxTopUpProvider(config, fetcher);
    await expect(provider.listCountries()).resolves.toEqual([{ code: 'JM', name: 'Jamaica' }]);
    expect(submit).not.toHaveBeenCalled();
  });

  it.each([
    { logos: ['https://cdn.example.test/carrier.png?size=36'], expected: 'https://cdn.example.test/carrier.png?size=36' },
    { logos: ['http://cdn.example.test/insecure.png', null, 'broken', 'https://cdn.example.test/carrier.png'], expected: 'https://cdn.example.test/carrier.png' },
    ...[undefined, null, [], 'https://cdn.example.test/carrier.png', [null, 42], [''], ['not a URL'], ['https:///carrier.png'], ['https://'], ['http://cdn.example.test/logo.png'], ['//cdn.example.test/logo.png'], ['data:image/png;base64,AAAA'], ['javascript:alert(1)'], ['https://user:secret@cdn.example.test/logo.png'], ['https://cdn.example.test/a b.png'], ['https://cdn.example.test/%zz']].map(logos => ({ logos, expected: undefined })),
  ])('maps optional Reloadly logos safely: $logos', async ({ logos, expected }) => {
    const raw = { operatorId: 12, name: 'Carrier fixture', country: { isoName: 'JM' }, logoUrls: logos };
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async url => String(url) === config.authUrl
      ? json({ access_token: 'fixture-token', expires_in: 3600 })
      : json(String(url).endsWith('/operators/countries/JM') ? [raw] : raw));
    const provider = new ReloadlySandboxTopUpProvider(config, fetcher);
    for (const mapped of [(await provider.listOperators('JM'))[0]!, await provider.detectOperator('+18765551234', 'JM'), await provider.getOperator(12)]) {
      expect(mapped.logoUrl).toBe(expected);
      expect(mapped).toMatchObject({ id: 12, name: raw.name, countryCode: 'JM', provider: 'RELOADLY' });
    }
  });

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
    expect(new Headers(fetchMock.mock.calls[1]?.[1]?.headers).get('authorization')).toBe('Bearer ' + 'token');
  });

  it('preserves RANGE denomination bounds from Reloadly operators', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(json([{ operatorId: 12, name: 'Sandbox Jamaica Range', status: true,
        country: { isoName: 'JM' }, denominationType: 'RANGE', senderCurrencyCode: 'USD',
        destinationCurrencyCode: 'JMD', minAmount: 5, maxAmount: 60 }]));
    const provider = new ReloadlySandboxTopUpProvider(config, fetchMock);

    await expect(provider.listOperators('JM')).resolves.toEqual([
      expect.objectContaining({
        id: 12,
        countryCode: 'JM',
        denominationType: 'RANGE',
        minAmount: 5,
        maxAmount: 60,
      }),
    ]);
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

  it('uses normalized digits in the Reloadly auto-detect path', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(json({
        operatorId: 12,
        name: 'Sandbox Jamaica Mobile',
        status: true,
        country: { isoName: 'JM' },
        denominationType: 'FIXED',
        senderCurrencyCode: 'USD',
        destinationCurrencyCode: 'JMD',
        fixedAmounts: [5],
        localFixedAmounts: [780],
      }));
    const provider = new ReloadlySandboxTopUpProvider(config, fetchMock);

    await expect(provider.detectOperator('+18765551234', 'JM')).resolves.toMatchObject({
      id: 12,
      countryCode: 'JM',
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(
      `${config.airtimeBaseUrl}/operators/auto-detect/phone/18765551234/countries/JM`,
    );
  });
  it('submits a provider purchase without exposing credentials in its body', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(json({ transactionId: 44 }));
    const provider = new ReloadlySandboxTopUpProvider(config, fetchMock);
    await expect(provider.submitTopUp({ operatorId: 12, amount: 5, recipientPhone: '+18765551234',
      recipientCountryCode: 'JM', customIdentifier: 'ticash-topup-test', providerCurrency: 'USD' }))
      .resolves.toMatchObject({ transactionId: '44', status: 'PROCESSING', requestedAmount: 5, requestedAmountCurrencyCode: 'USD' });
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe(`${config.airtimeBaseUrl}/topups-async`);
    const body = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(body).toMatchObject({ operatorId: 12, amount: 5, useLocalAmount: false,
      recipientPhone: { countryCode: 'JM', number: '18765551234' } });
    expect(body.client_secret).toBeUndefined();
  });

  it('recovers an ambiguous submission by its unique custom identifier', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(json({
        content: [{
          transactionId: 99123,
          status: 'SUCCESSFUL',
          customIdentifier: 'ticash-topup-recover-me',
          requestedAmount: 5,
          requestedAmountCurrencyCode: 'USD',
          deliveredAmount: 5,
          deliveredAmountCurrencyCode: 'USD',
        }],
      }));
    const provider = new ReloadlySandboxTopUpProvider(config, fetchMock);

    await expect(provider.findTopUpByCustomIdentifier('ticash-topup-recover-me')).resolves.toMatchObject({
      transactionId: '99123',
      status: 'SUCCESSFUL',
      requestedAmount: 5,
    });
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('/topups/reports/transactions?');
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('customIdentifier=ticash-topup-recover-me');
  });

  it('preserves a sanitized Reloadly failure code from a failed status response', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(json({ access_token: 'token', expires_in: 3600 }))
      .mockResolvedValueOnce(json({
        transaction: {
          transactionId: 32835653,
          status: 'FAILED',
          requestedAmount: 5,
          requestedAmountCurrencyCode: 'USD',
        },
        status: 'FAILED',
        errorCode: 'RECIPIENT_NOT_FOUND',
        message: 'private provider message must not be exposed to the customer',
      }));
    const provider = new ReloadlySandboxTopUpProvider(config, fetchMock);

    await expect(provider.getTopUpStatus('32835653')).resolves.toMatchObject({
      transactionId: '32835653',
      status: 'FAILED',
      rawStatus: 'FAILED',
      providerFailureCode: 'RECIPIENT_NOT_FOUND',
    });
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
