import { createHash } from 'node:crypto';
import { providerLogoUrl } from './logo-url.js';
import { DING_API_URL, DING_TOKEN_URL, type DingConfig } from './ding-config.js';
import { encodeOperatorId, SLOT_SIZE } from './provider-identity.js';
import { MobileTopUpError, type MobileTopUpOperator, type MobileTopUpProduct, type MobileTopUpProvider, type ProviderTopUpRequest, type ProviderTopUpResult } from './types.js';

type Doc = Record<string, unknown>;
function invalid(): never { throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Ding returned unsupported or invalid data', 502); }
function doc(value: unknown): Doc { if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(); return value as Doc; }
function text(value: unknown, max = 160): string { if (typeof value !== 'string' || !value.trim() || value.length > max || [...value].some(char => char.charCodeAt(0) < 32)) return invalid(); return value; }
function country(value: unknown): string { if (typeof value !== 'string' || !/^[A-Z]{2}$/.test(value)) return invalid(); return value; }
function items(value: Doc): unknown[] { if (!Array.isArray(value.Items)) return invalid(); return value.Items; }
function account(value: unknown): string | undefined { return typeof value === 'string' && /^\+?[1-9][0-9]{6,14}$/.test(value) ? value.replace(/^\+/, '') : undefined; }
function envelope(value: Doc) { if (value.ResultCode !== 1 || !Array.isArray(value.ErrorCodes) || value.ErrorCodes.length) throw new MobileTopUpError('DING_REQUEST_FAILED', 'Ding could not complete the request', 502); return value; }
// Lossless raw-code conversion, not a new global namespace or a collision-prone hash.
// Unsupported codes are omitted; all public IDs still use encodeOperatorId('DING', rawId).
const alphabet = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
export function dingOperatorId(code: string): number {
  if (!/^[A-Za-z0-9]{1,5}$/.test(code)) return invalid();
  let id = 0;
  for (const char of code) id = id * 63 + alphabet.indexOf(char) + 1;
  if (id >= SLOT_SIZE) return invalid();
  return id;
}
export function dingOperatorCode(id: number): string {
  if (!Number.isSafeInteger(id) || id < 1 || id >= SLOT_SIZE) return invalid();
  let code = '';
  for (let rest = id; rest > 0; rest = Math.floor(rest / 63)) {
    const digit = rest % 63; if (!digit) return invalid(); code = alphabet[digit - 1] + code;
  }
  if (dingOperatorId(code) !== id) return invalid();
  return code;
}
function operator(raw: Doc): MobileTopUpOperator {
  return { id: dingOperatorId(text(raw.ProviderCode)), provider: 'DING', countryCode: country(raw.CountryIso), name: text(raw.Name), logoUrl: providerLogoUrl(raw.LogoUrl), status: true,
    bundle: false, denominationType: 'FIXED', senderCurrencyCode: '', destinationCurrencyCode: '', fixedAmounts: [], localFixedAmounts: [], fixedAmountsPlanNames: {}, localFixedAmountsPlanNames: {} };
}
function fixedPrice(value: unknown): Doc | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const price = doc(value); const amount = price.SendValue;
  if (price.SendCurrencyIso !== 'USD' || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 1e9 ||
      Math.abs(amount * 100 - Math.round(amount * 100)) > 1e-7 || price.CustomerFee !== 0 || price.DistributorFee !== 0 ||
      typeof price.ReceiveValue !== 'number' || !Number.isFinite(price.ReceiveValue) || price.ReceiveValue < 0 ||
      typeof price.ReceiveCurrencyIso !== 'string' || !/^[A-Z]{3}$/.test(price.ReceiveCurrencyIso)) return undefined;
  return price;
}
export function mapDingProduct(value: unknown, op: MobileTopUpOperator): MobileTopUpProduct | undefined {
  const raw = doc(value);
  if (raw.ProviderCode !== dingOperatorCode(op.id)) return invalid();
  // Require explicit safe semantics; never infer denominations from SKU names.
  if (raw.RedemptionMechanism !== 'Immediate' || raw.ProcessingMode !== 'Instant' || raw.LookupBillsRequired !== false ||
      !Array.isArray(raw.SettingDefinitions) || raw.SettingDefinitions.length || (raw.AdditionalInformation !== null && raw.AdditionalInformation !== '') ||
      !Array.isArray(raw.Benefits) || !raw.Benefits.includes('Mobile') || !raw.Benefits.some(v => v === 'Minutes' || v === 'Data') ||
      raw.Benefits.some(v => !['Mobile', 'Minutes', 'Data', 'SMS'].includes(String(v))) ||
      !account(raw.UatNumber) || (raw.RegionCode !== null && raw.RegionCode !== '')) return undefined;
  const min = fixedPrice(raw.Minimum); const max = fixedPrice(raw.Maximum);
  if (!min || !max || ['SendValue', 'SendCurrencyIso', 'ReceiveValue', 'ReceiveCurrencyIso'].some(key => min[key] !== max[key])) return undefined;
  const sku = text(raw.SkuCode, 140); const name = text(raw.DefaultDisplayText);
  const id = `ding:${op.countryCode}:${encodeOperatorId('DING', op.id)}:product:${encodeURIComponent(sku)}`;
  if (id.length > 240) return undefined;
  const classification = raw.Benefits.includes('Data') ? raw.Benefits.includes('Minutes') ? 'BUNDLE' : 'DATA' : 'AIRTIME';
  return { id, provider: 'DING', providerProductId: sku,
    operatorId: op.id, countryCode: op.countryCode, name, classification, kind: classification === 'AIRTIME' ? 'AIRTIME' : 'DATA',
    amountType: 'FIXED', price: min.SendValue as number, priceCurrency: 'USD', deliveredValue: min.ReceiveValue as number, deliveredCurrency: min.ReceiveCurrencyIso as string };
}
export function dingDistributorReference(identifier: string) { return `tc-${createHash('sha256').update(identifier).digest('hex').slice(0, 32)}`; }
function transfer(raw: Doc, reference: string, input?: ProviderTopUpRequest): ProviderTopUpResult {
  const id = doc(raw.TransferId); const price = doc(raw.Price);
  if (id.DistributorRef !== reference) return invalid();
  const transferRef = text(id.TransferRef); text(raw.SkuCode);
  const states: Record<string, string> = { Complete: 'COMPLETED', Completed: 'COMPLETED', Submitted: 'PROCESSING', Processing: 'PROCESSING', Cancelling: 'PROCESSING', Failed: 'FAILED', Cancelled: 'FAILED' };
  const state = text(raw.ProcessingState); if (!Object.prototype.hasOwnProperty.call(states, state)) return invalid();
  if (typeof price.SendValue !== 'number' || !Number.isFinite(price.SendValue) || price.SendValue <= 0 || price.SendCurrencyIso !== 'USD') return invalid();
  if (input && (raw.SkuCode !== input.providerProductId || account(raw.AccountNumber) !== account(input.recipientPhone) || price.SendValue !== input.amount || price.SendCurrencyIso !== input.providerCurrency)) return invalid();
  return { transactionId: reference, operatorTransactionId: transferRef, status: states[state]!, rawStatus: state,
    requestedAmount: price.SendValue, requestedAmountCurrencyCode: 'USD',
    ...(typeof price.ReceiveValue === 'number' && Number.isFinite(price.ReceiveValue) && price.ReceiveValue >= 0 && typeof price.ReceiveCurrencyIso === 'string' && /^[A-Z]{3}$/.test(price.ReceiveCurrencyIso)
      ? { deliveredAmount: price.ReceiveValue, deliveredAmountCurrencyCode: price.ReceiveCurrencyIso } : {}) };
}

function recordResponse(value: Doc, reference: string, input?: ProviderTopUpRequest) {
  const record = doc(value.TransferRecord);
  if (!(['Failed', 'Cancelled'].includes(String(record.ProcessingState)) && (value.ResultCode === 1 || value.ResultCode === 4) && Array.isArray(value.ErrorCodes))) envelope(value);
  return transfer(record, reference, input);
}

export class DingUatProvider implements MobileTopUpProvider {
  readonly name = 'DING' as const;
  private token?: { value: string; refreshAt: number };
  private tokenRequest?: Promise<string>;
  private attempted = new Set<string>();
  private submissions = new Map<string, { fingerprint: string; result: Promise<ProviderTopUpResult> }>();
  constructor(private readonly config: DingConfig, private readonly fetchImpl: typeof fetch = fetch, private readonly now: () => number = Date.now) {
    if (!config.enabled || config.environment !== 'uat' || !config.clientId || !config.clientSecret || config.tokenUrl !== DING_TOKEN_URL || config.baseUrl !== DING_API_URL) throw new Error('Ding requires enabled UAT configuration and credentials');
  }
  private async bearer(): Promise<string> {
    if (this.token && this.now() < this.token.refreshAt) return this.token.value;
    if (this.tokenRequest) return this.tokenRequest;
    this.tokenRequest = (async () => {
      try {
        const started = this.now();
        const response = await this.fetchImpl(this.config.tokenUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: new URLSearchParams({ grant_type: 'client_credentials', client_id: this.config.clientId!, client_secret: this.config.clientSecret! }).toString() });
        if (!response.ok) throw new Error();
        const data = doc(await response.json());
        if (typeof data.access_token !== 'string' || !data.access_token || /\s/.test(data.access_token) || data.token_type !== 'Bearer' || typeof data.expires_in !== 'number' || !Number.isFinite(data.expires_in) || data.expires_in <= 0) throw new Error();
        const ttl = data.expires_in * 1000;
        const refreshAt = started + ttl - Math.min(30_000, ttl / 10);
        if (!Number.isSafeInteger(Math.ceil(refreshAt))) throw new Error();
        this.token = { value: data.access_token, refreshAt };
        if (this.now() >= this.token.refreshAt) throw new Error();
        return this.token.value;
      } catch { this.token = undefined; throw new MobileTopUpError('DING_AUTH_UNAVAILABLE', 'Ding UAT authentication failed', 502); }
    })();
    try { return await this.tokenRequest; } finally { this.tokenRequest = undefined; }
  }
  private async request(method: string, query: Record<string, string> = {}, body?: unknown): Promise<Doc> {
    const token = await this.bearer();
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.config.baseUrl}/${method}${Object.keys(query).length ? `?${new URLSearchParams(query)}` : ''}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(method === 'SendTransfer' ? 95_000 : 15_000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new MobileTopUpError('DING_UNAVAILABLE', 'Ding UAT request requires reconciliation or retry', 502); }
    if (response.status === 401) this.token = undefined;
    if (!response.ok) throw new MobileTopUpError('DING_UNAVAILABLE', 'Ding UAT request was not accepted', 502);
    try {
      const value: unknown = await response.json();
      // Inspect decoded strings and keys so JSON escaping cannot hide an echoed credential.
      const secrets = [this.config.clientSecret!, this.config.clientId!, token];
      const pending: unknown[] = [value];
      while (pending.length) {
        const current = pending.pop();
        if (typeof current === 'string' && secrets.some(secret => current.includes(secret))) return invalid();
        if (current && typeof current === 'object') {
          for (const [key, nested] of Object.entries(current)) pending.push(key, nested);
        }
      }
      return doc(value);
    } catch { return invalid(); }
  }
  private async catalog(method: string, query: Record<string, string> = {}) {
    const value = envelope(await this.request(method, query));
    // These reference-data endpoints are unpaged. Never silently truncate an unexpected page.
    if (value.ThereAreMoreItems !== undefined && value.ThereAreMoreItems !== false) return invalid();
    return items(value);
  }
  async listCountries() {
    return (await this.catalog('GetCountries')).map(value => { const raw = doc(value); return { code: country(raw.CountryIso), name: text(raw.CountryName) }; }).filter(value => value.code !== 'XG');
  }
  private async statuses(code?: string) {
    const values = await this.catalog('GetProviderStatus', code ? { providerCodes: code } : {});
    const result = new Map<string, boolean>();
    for (const value of values) {
      const raw = doc(value); const key = text(raw.ProviderCode);
      if (typeof raw.IsProcessingTransfers !== 'boolean' || result.has(key)) return invalid();
      result.set(key, raw.IsProcessingTransfers);
    }
    return result;
  }
  async listOperators(code: string) {
    const values = await this.catalog('GetProviders', { countryIsos: country(code) });
    const statuses = await this.statuses();
    const result: MobileTopUpOperator[] = [];
    for (const value of values) {
      const raw = doc(value);
      if (country(raw.CountryIso) !== code) return invalid();
      const providerCode = text(raw.ProviderCode);
      try { dingOperatorId(providerCode); } catch { continue; }
      result.push({ ...operator(raw), status: statuses.get(providerCode) === true });
    }
    return result;
  }
  async getOperator(id: number) {
    const code = dingOperatorCode(id); const values = await this.catalog('GetProviders', { providerCodes: code });
    if (values.length !== 1 || doc(values[0]).ProviderCode !== code) return invalid();
    return { ...operator(doc(values[0])), status: (await this.statuses(code)).get(code) === true };
  }
  async detectOperator(phone: string, code: string) {
    const number = account(phone); if (!number) throw new MobileTopUpError('INVALID_TOPUP_PHONE', 'Invalid mobile number', 400);
    const raw = await this.request('GetAccountLookup', { accountNumber: number });
    if (raw.ResultCode !== 1 || raw.CountryIso !== code || account(raw.AccountNumberNormalized) !== number || !Array.isArray(raw.Items) || raw.Items.length !== 1) {
      throw new MobileTopUpError('TOPUP_OPERATOR_UNAVAILABLE', 'Select your recharge operator manually', 404);
    }
    envelope(raw);
    const op = await this.getOperator(dingOperatorId(text(doc(raw.Items[0]).ProviderCode)));
    if (op.countryCode !== code) return invalid();
    if (!op.status) throw new MobileTopUpError('TOPUP_OPERATOR_UNAVAILABLE', 'Select your recharge operator manually', 404);
    return op;
  }
  private async products(code: string, id: number, sku?: string) {
    const op = await this.getOperator(id); if (op.countryCode !== code) return invalid();
    if (!op.status) return [];
    const raw = await this.catalog('GetProducts', { countryIsos: code, providerCodes: dingOperatorCode(id), benefits: 'Mobile', ...(sku ? { skuCodes: sku } : {}) });
    return raw.map(value => ({ raw: doc(value), product: mapDingProduct(value, op) }));
  }
  async listProducts(code: string, id: number) { return (await this.products(code, id)).flatMap(value => value.product ? [value.product] : []); }
  private async lookup(reference: string, input?: ProviderTopUpRequest): Promise<ProviderTopUpResult | undefined> {
    const found: ProviderTopUpResult[] = [];
    for (let skip = 0; skip <= 500; skip += 100) {
      const response = envelope(await this.request('ListTransferRecords', {}, { DistributorRef: reference, Skip: skip, Take: 100 }));
      const rows = items(response);
      for (const value of rows) { const row = doc(value); found.push(recordResponse(row, reference, input)); }
      if (found.length > 1) return invalid(); // A reused distributor reference must never select an arbitrary transfer.
      if (response.ThereAreMoreItems === false) return found[0];
      if (response.ThereAreMoreItems !== true || !rows.length) return invalid();
    }
    return invalid();
  }
  async getTopUpStatus(reference: string) {
    if (!/^tc-[a-f0-9]{32}$/.test(reference)) return invalid();
    const result = await this.lookup(reference);
    if (!result) throw new MobileTopUpError('DING_RECONCILIATION_REQUIRED', 'Ding transfer is not yet visible; do not resubmit', 502);
    return result;
  }
  async submitTopUp(input: ProviderTopUpRequest): Promise<ProviderTopUpResult> {
    if (input.provider !== 'DING' || !input.customIdentifier || !input.providerProductId || input.providerCurrency !== 'USD' || !/^\+[1-9][0-9]{6,14}$/.test(input.recipientPhone)) throw new MobileTopUpError('INVALID_TOPUP_REQUEST', 'Ding requires an exact quote and normalized recipient', 400);
    const reference = dingDistributorReference(input.customIdentifier); const fingerprint = JSON.stringify(input);
    const existing = this.submissions.get(reference);
    if (existing) { if (existing.fingerprint !== fingerprint) throw new MobileTopUpError('IDEMPOTENCY_CONFLICT', 'Ding reference is already in use', 409); return existing.result; }
    const result = this.send(input, reference); this.submissions.set(reference, { fingerprint, result });
    try { return await result; } finally { this.submissions.delete(reference); }
  }
  private uncertain(reference: string, input: ProviderTopUpRequest): ProviderTopUpResult {
    return { transactionId: reference, status: 'PROCESSING', rawStatus: 'SUBMISSION_UNKNOWN', requestedAmount: input.amount, requestedAmountCurrencyCode: 'USD' };
  }
  private async send(input: ProviderTopUpRequest, reference: string): Promise<ProviderTopUpResult> {
    const previous = await this.lookup(reference, input); if (previous) return previous;
    if (this.attempted.has(reference)) return this.uncertain(reference, input);
    const matches = (await this.products(input.recipientCountryCode, input.operatorId, input.providerProductId)).filter(value => value.raw.SkuCode === input.providerProductId);
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match?.product || match.product.id !== input.productId || match.product.price !== input.amount || match.product.priceCurrency !== input.providerCurrency) throw new MobileTopUpError('TOPUP_QUOTE_CHANGED', 'The quoted Ding product is no longer available on the same terms', 400);
    // Ding shares UAT/live hosts. Enforce the provider's exact non-billable UAT number even if credentials were misconfigured.
    if (account(match.raw.UatNumber) !== account(input.recipientPhone)) throw new MobileTopUpError('DING_UAT_NUMBER_REQUIRED', 'Only the exact product UAT number is allowed', 400);
    this.attempted.add(reference);
    try {
      const response = await this.request('SendTransfer', {}, { SkuCode: input.providerProductId, SendValue: input.amount, SendCurrencyIso: 'USD',
        AccountNumber: account(input.recipientPhone), DistributorRef: reference, ValidateOnly: false });
      return recordResponse(response, reference, input);
    } catch {
      try { const reconciled = await this.lookup(reference, input); if (reconciled) return reconciled; } catch { /* Preserve durable lookup identity; never resend. */ }
      return this.uncertain(reference, input);
    }
  }
}
