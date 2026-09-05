import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  DwollaCustomer,
  DwollaCustomerInput,
  DwollaFundingProvider,
  DwollaFundingSource,
  DwollaFundingSourceInput,
  DwollaTransfer,
  FundingConfig,
  FundingSourceStatus,
} from './types.js';
import { FundingError } from './types.js';

type HalDocument = {
  id?: string;
  status?: string;
  name?: string;
  bankAccountType?: string;
  code?: string;
  message?: string;
  _links?: Record<string, { href?: string }>;
  _embedded?: Record<string, HalDocument[]>;
};

type TokenResponse = { access_token?: string; expires_in?: number };

function idFromUrl(url: string): string {
  const id = new URL(url).pathname.split('/').filter(Boolean).at(-1);
  if (!id) throw new FundingError('INVALID_PROVIDER_RESPONSE', 'Dwolla omitted a resource identifier', 502);
  return id;
}

function sourceStatus(status: string | undefined): FundingSourceStatus {
  switch (status?.toLowerCase()) {
    case 'verified':
      return 'VERIFIED';
    case 'removed':
      return 'REMOVED';
    default:
      return 'UNVERIFIED';
  }
}

export class DwollaRestFundingProvider implements DwollaFundingProvider {
  private token?: { value: string; expiresAt: number };
  private readonly baseUrl: string;

  constructor(
    private readonly config: FundingConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = config.environment === 'sandbox'
      ? 'https://api-sandbox.dwolla.com'
      : 'https://api.dwolla.com';
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new FundingError('FUNDING_CONFIGURATION_ERROR', 'Dwolla credentials are unavailable', 503);
    }
    const basic = Buffer.from(`${this.config.clientId}:${this.config.clientSecret}`).toString('base64');
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/token`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: 'grant_type=client_credentials',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new FundingError('DWOLLA_UNAVAILABLE', 'Dwolla authentication is temporarily unavailable', 502);
    }
    const body = await response.json().catch(() => ({})) as TokenResponse;
    if (!response.ok || !body.access_token || !body.expires_in) {
      throw new FundingError('DWOLLA_AUTHENTICATION_FAILED', 'Dwolla authentication failed', 502);
    }
    this.token = {
      value: body.access_token,
      expiresAt: Date.now() + Math.max(1, body.expires_in) * 1000,
    };
    return this.token.value;
  }

  private async request(
    pathOrUrl: string,
    init: RequestInit = {},
  ): Promise<{ response: Response; body?: HalDocument }> {
    const token = await this.accessToken();
    const url = pathOrUrl.startsWith('https://') ? pathOrUrl : `${this.baseUrl}${pathOrUrl}`;
    if (!url.startsWith(`${this.baseUrl}/`)) {
      throw new FundingError('INVALID_PROVIDER_URL', 'Refusing an unexpected Dwolla resource URL');
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.dwolla.v1.hal+json',
          ...(init.body ? { 'Content-Type': 'application/vnd.dwolla.v1.hal+json' } : {}),
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(15_000),
      });
    } catch {
      throw new FundingError('DWOLLA_UNAVAILABLE', 'Dwolla is temporarily unavailable', 502);
    }
    const body = response.status === 204
      ? undefined
      : await response.json().catch(() => undefined) as HalDocument | undefined;
    if (!response.ok) {
      const providerCode = body?.code?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
      const rateLimited = response.status === 429;
      throw new FundingError(
        providerCode ? `DWOLLA_${providerCode.toUpperCase()}` : 'DWOLLA_REQUEST_FAILED',
        rateLimited
          ? 'Dwolla is rate limiting requests; retry later'
          : response.status >= 500
            ? 'Dwolla is temporarily unavailable'
            : 'Dwolla rejected the request',
        rateLimited ? 503 : response.status >= 500 ? 502 : 400,
      );
    }
    return { response, body };
  }

  private async getFundingSource(url: string): Promise<DwollaFundingSource> {
    const { body } = await this.request(url);
    return {
      id: body?.id ?? idFromUrl(url),
      url,
      name: body?.name ?? 'Bank account',
      bankAccountType: body?.bankAccountType ?? 'unknown',
      status: sourceStatus(body?.status),
    };
  }

  async createCustomer(input: DwollaCustomerInput): Promise<DwollaCustomer> {
    const { response } = await this.request('/customers', {
      method: 'POST',
      body: JSON.stringify({ ...input, type: 'personal' }),
    });
    const url = response.headers.get('location');
    if (!url) throw new FundingError('INVALID_PROVIDER_RESPONSE', 'Dwolla omitted the customer URL', 502);
    return this.getCustomer(url);
  }

  async getCustomer(customerUrl: string): Promise<DwollaCustomer> {
    const { body } = await this.request(customerUrl);
    return {
      id: body?.id ?? idFromUrl(customerUrl),
      url: customerUrl,
      status: body?.status ?? 'unverified',
    };
  }

  async createFundingSource(input: DwollaFundingSourceInput): Promise<DwollaFundingSource> {
    const { response } = await this.request(`${input.customerUrl}/funding-sources`, {
      method: 'POST',
      body: JSON.stringify({
        routingNumber: input.routingNumber,
        accountNumber: input.accountNumber,
        bankAccountType: input.bankAccountType,
        name: input.name,
      }),
    });
    const url = response.headers.get('location');
    if (!url) throw new FundingError('INVALID_PROVIDER_RESPONSE', 'Dwolla omitted the funding-source URL', 502);
    return this.getFundingSource(url);
  }

  async listFundingSources(customerUrl: string): Promise<DwollaFundingSource[]> {
    const { body } = await this.request(`${customerUrl}/funding-sources?removed=false`);
    const sources = body?._embedded?.['funding-sources'] ?? [];
    return sources.map((source) => {
      const url = source._links?.self?.href;
      if (!url) throw new FundingError('INVALID_PROVIDER_RESPONSE', 'Dwolla omitted a funding-source URL', 502);
      return {
        id: source.id ?? idFromUrl(url),
        url,
        name: source.name ?? 'Bank account',
        bankAccountType: source.bankAccountType ?? 'unknown',
        status: sourceStatus(source.status),
      };
    });
  }

  async initiateMicroDeposits(fundingSourceUrl: string): Promise<void> {
    await this.request(`${fundingSourceUrl}/micro-deposits`, { method: 'POST' });
  }

  async verifyMicroDeposits(
    fundingSourceUrl: string,
    amount1: string,
    amount2: string,
  ): Promise<DwollaFundingSource> {
    await this.request(`${fundingSourceUrl}/micro-deposits`, {
      method: 'POST',
      body: JSON.stringify({ amount1: { value: amount1, currency: 'USD' }, amount2: { value: amount2, currency: 'USD' } }),
    });
    return this.getFundingSource(fundingSourceUrl);
  }

  async initiateTransfer(input: {
    sourceUrl: string;
    destinationUrl: string;
    amount: string;
    currency: 'USD';
    correlationId: string;
    idempotencyKey: string;
  }): Promise<DwollaTransfer> {
    const { response } = await this.request('/transfers', {
      method: 'POST',
      headers: { 'Idempotency-Key': input.idempotencyKey },
      body: JSON.stringify({
        _links: {
          source: { href: input.sourceUrl },
          destination: { href: input.destinationUrl },
        },
        amount: { currency: input.currency, value: input.amount },
        correlationId: input.correlationId,
      }),
    });
    const url = response.headers.get('location');
    if (!url) throw new FundingError('INVALID_PROVIDER_RESPONSE', 'Dwolla omitted the transfer URL', 502);
    return this.getTransfer(url);
  }

  async getTransfer(transferUrl: string): Promise<DwollaTransfer> {
    const { body } = await this.request(transferUrl);
    const status = body?.status ?? 'pending';
    let failureCode: string | undefined;
    const failureUrl = body?._links?.failure?.href;
    if (status.toLowerCase() === 'failed' && failureUrl) {
      const failure = await this.request(failureUrl);
      failureCode = failure.body?.code?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80);
    }
    return {
      id: body?.id ?? idFromUrl(transferUrl),
      url: transferUrl,
      status,
      failureCode,
    };
  }

  async cancelTransfer(transferUrl: string): Promise<DwollaTransfer> {
    await this.request(transferUrl, {
      method: 'POST',
      body: JSON.stringify({ status: 'cancelled' }),
    });
    return this.getTransfer(transferUrl);
  }
}

export function verifyDwollaWebhookSignature(
  rawBody: Buffer,
  signature: string | undefined,
  secret: string | undefined,
): boolean {
  if (!signature || !secret || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(signature, 'hex');
  return expected.length === received.length && timingSafeEqual(expected, received);
}
