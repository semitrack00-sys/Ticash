import type {
  MobileTopUpConfig,
  MobileTopUpCountry,
  MobileTopUpOperator,
  MobileTopUpProvider,
  ProviderTopUpRequest,
  ProviderTopUpResult,
} from './types.js';
import { MobileTopUpError } from './types.js';
import { normalizeTopUpCountryCode } from './validation.js';

type ReloadlyDocument = Record<string, unknown> & {
  content?: unknown[];
  transactionId?: number | string;
  transaction?: unknown;
  status?: string;
};

function numericList(value: unknown): number[] {
  return Array.isArray(value)
    ? value.map(Number).filter((item) => Number.isFinite(item) && item > 0)
    : [];
}

function stringMap(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

function providerCountryCode(value: unknown): string {
  const normalized = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(normalized)) {
    throw new MobileTopUpError(
      'INVALID_PROVIDER_RESPONSE',
      'Reloadly returned an invalid recharge country',
      502,
    );
  }
  return normalized;
}

function mapCountry(raw: Record<string, unknown>): MobileTopUpCountry {
  const code = providerCountryCode(raw.isoName ?? raw.countryCode ?? raw.code);
  const name = typeof raw.name === 'string'
    ? raw.name.trim()
    : typeof raw.countryName === 'string'
      ? raw.countryName.trim()
      : code;
  return {
    code,
    name: name.slice(0, 160) || code,
  };
}

function mapOperator(raw: Record<string, unknown>): MobileTopUpOperator {
  const id = Number(raw.operatorId ?? raw.id);
  const country = raw.country && typeof raw.country === 'object' && !Array.isArray(raw.country)
    ? raw.country as Record<string, unknown>
    : undefined;
  const countryCode = providerCountryCode(country?.isoName ?? raw.countryCode ?? raw.isoName);
  if (!Number.isInteger(id) || id <= 0) {
    throw new MobileTopUpError(
      'INVALID_PROVIDER_RESPONSE',
      'Reloadly returned an invalid recharge operator',
      502,
    );
  }
  const denominationType = String(raw.denominationType ?? '').toUpperCase() === 'RANGE'
    ? 'RANGE'
    : 'FIXED';
  const minAmount = Number(raw.minAmount);
  const maxAmount = Number(raw.maxAmount);
  return {
    id,
    name: String(raw.name ?? `Operator ${id}`).slice(0, 160),
    countryCode,
    status: raw.status !== false,
    bundle: raw.bundle === true,
    denominationType,
    senderCurrencyCode: String(raw.senderCurrencyCode ?? '').toUpperCase(),
    destinationCurrencyCode: String(raw.destinationCurrencyCode ?? '').toUpperCase(),
    fixedAmounts: numericList(raw.fixedAmounts),
    localFixedAmounts: numericList(raw.localFixedAmounts),
    fixedAmountsPlanNames: stringMap(raw.fixedAmountsPlanNames),
    localFixedAmountsPlanNames: stringMap(raw.localFixedAmountsPlanNames),
    minAmount: Number.isFinite(minAmount) && minAmount > 0 ? minAmount : undefined,
    maxAmount: Number.isFinite(maxAmount) && maxAmount > 0 ? maxAmount : undefined,
  };
}

function mapTopUp(raw: ReloadlyDocument): ProviderTopUpResult {
  const nested = raw.transaction && typeof raw.transaction === 'object' && !Array.isArray(raw.transaction)
    ? raw.transaction as ReloadlyDocument
    : undefined;
  const details = nested ?? raw;
  const transactionId = raw.transactionId
    ?? details.transactionId
    ?? (typeof raw.transaction === 'string' || typeof raw.transaction === 'number'
      ? raw.transaction
      : undefined);
  const status = raw.status ?? details.status;
  if (transactionId === undefined || !status) {
    throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Reloadly omitted recharge status data', 502);
  }
  const requestedAmount = Number(details.requestedAmount ?? details.amount ?? 0);
  const deliveredAmount = Number(details.deliveredAmount);
  const fee = Number(details.fee);
  return {
    transactionId: String(transactionId),
    status: String(status).toUpperCase(),
    operatorTransactionId: details.operatorTransactionId == null
      ? undefined
      : String(details.operatorTransactionId),
    requestedAmount: Number.isFinite(requestedAmount) ? requestedAmount : 0,
    requestedAmountCurrencyCode: String(details.requestedAmountCurrencyCode ?? '').toUpperCase(),
    deliveredAmount: Number.isFinite(deliveredAmount) ? deliveredAmount : undefined,
    deliveredAmountCurrencyCode: details.deliveredAmountCurrencyCode == null
      ? undefined
      : String(details.deliveredAmountCurrencyCode).toUpperCase(),
    fee: Number.isFinite(fee) ? fee : undefined,
  };
}

export class ReloadlySandboxTopUpProvider implements MobileTopUpProvider {
  private token?: { value: string; expiresAt: number };

  constructor(
    private readonly config: MobileTopUpConfig,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) return this.token.value;
    if (!this.config.clientId || !this.config.clientSecret) {
      throw new MobileTopUpError('TOPUP_CONFIGURATION_ERROR', 'Reloadly credentials are unavailable', 503);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.authUrl, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: this.config.clientId,
          client_secret: this.config.clientSecret,
          grant_type: 'client_credentials',
          audience: this.config.airtimeBaseUrl,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new MobileTopUpError('RELOADLY_UNAVAILABLE', 'Mobile recharge authentication is unavailable', 502);
    }
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    const token = typeof body.access_token === 'string' ? body.access_token : undefined;
    const expiresIn = Number(body.expires_in);
    if (!response.ok || !token || !Number.isFinite(expiresIn)) {
      throw new MobileTopUpError('RELOADLY_AUTHENTICATION_FAILED', 'Reloadly Sandbox authentication failed', 502);
    }
    this.token = { value: token, expiresAt: Date.now() + Math.max(1, expiresIn) * 1000 };
    return token;
  }

  private async request(path: string, init: RequestInit = {}): Promise<ReloadlyDocument> {
    const token = await this.accessToken();
    const url = new URL(path, `${this.config.airtimeBaseUrl}/`);
    if (url.origin !== this.config.airtimeBaseUrl) {
      throw new MobileTopUpError('INVALID_PROVIDER_URL', 'Refusing an unexpected Reloadly URL', 500);
    }
    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        ...init,
        headers: {
          Authorization: 'Bearer ' + token,
          Accept: 'application/com.reloadly.topups-v1+json',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...init.headers,
        },
        signal: init.signal ?? AbortSignal.timeout(15_000),
      });
    } catch {
      throw new MobileTopUpError('RELOADLY_UNAVAILABLE', 'Reloadly Sandbox is temporarily unavailable', 502);
    }
    const body = await response.json().catch(() => ({})) as ReloadlyDocument;
    if (!response.ok) {
      const rawCode = typeof body.errorCode === 'string'
        ? body.errorCode
        : typeof body.code === 'string' ? body.code : 'REQUEST_FAILED';
      const code = rawCode.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80).toUpperCase();
      throw new MobileTopUpError(`RELOADLY_${code}`, 'Reloadly rejected the recharge request', response.status >= 500 ? 502 : 400);
    }
    return body;
  }

  async listCountries(): Promise<MobileTopUpCountry[]> {
    const body = await this.request('countries');
    const raw = Array.isArray(body) ? body : Array.isArray(body.content) ? body.content : [];
    return raw
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map(mapCountry);
  }

  async listOperators(countryCode: string): Promise<MobileTopUpOperator[]> {
    const normalizedCountry = normalizeTopUpCountryCode(countryCode);
    const body = await this.request(`operators/countries/${normalizedCountry}`);
    const raw = Array.isArray(body) ? body : Array.isArray(body.content) ? body.content : [];
    return raw
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map(mapOperator)
      .filter((operator) => operator.status);
  }

  async detectOperator(phone: string, countryCode: string): Promise<MobileTopUpOperator> {
    const normalizedCountry = normalizeTopUpCountryCode(countryCode);
    const providerPhone = phone.replace(/\D/g, '');
    if (!/^[1-9]\d{7,14}$/.test(providerPhone)) {
      throw new MobileTopUpError(
        'INVALID_TOPUP_PHONE',
        'Enter a valid mobile number',
        400,
      );
    }
    const body = await this.request(
      `operators/auto-detect/phone/${providerPhone}/countries/${normalizedCountry}`,
    );
    return mapOperator(body);
  }

  async getOperator(operatorId: number): Promise<MobileTopUpOperator> {
    return mapOperator(await this.request(`operators/${operatorId}`));
  }

  async submitTopUp(input: ProviderTopUpRequest): Promise<ProviderTopUpResult> {
    const senderPhone = this.config.senderPhoneCountry && this.config.senderPhoneNumber
      ? {
          countryCode: normalizeTopUpCountryCode(this.config.senderPhoneCountry),
          number: this.config.senderPhoneNumber.replace(/\D/g, ''),
        }
      : undefined;
    const recipientCountryCode = normalizeTopUpCountryCode(input.recipientCountryCode);
    const body = await this.request('topups', {
      method: 'POST',
      body: JSON.stringify({
        operatorId: input.operatorId,
        amount: input.amount,
        useLocalAmount: false,
        customIdentifier: input.customIdentifier,
        recipientPhone: {
          countryCode: recipientCountryCode,
          number: input.recipientPhone.replace(/\D/g, ''),
        },
        ...(senderPhone ? { senderPhone } : {}),
      }),
    });
    return mapTopUp(body);
  }

  async getTopUpStatus(transactionId: string): Promise<ProviderTopUpResult> {
    return mapTopUp(await this.request(`topups/${encodeURIComponent(transactionId)}/status`));
  }
}
