import { createHash } from 'node:crypto';
import { alpha2ToAlpha3, alpha3ToAlpha2 } from 'i18n-iso-countries';
import { DTONE_PREPROD_URL, type DtOneConfig } from './dtone-config.js';
import { encodeOperatorId } from './provider-identity.js';
import { MobileTopUpError, type MobileTopUpProvider, type MobileTopUpOperator, type MobileTopUpProduct, type ProviderTopUpRequest, type ProviderTopUpResult } from './types.js';

type Doc = Record<string, unknown>;
function invalid(): never { throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'DT One returned invalid catalog or transaction data', 502); }
function doc(value: unknown): Doc { if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid(); return value as Doc; }
function positiveId(value: unknown): number { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) return invalid(); return value; }
function name(value: unknown): string { if (typeof value !== 'string' || !value.trim()) return invalid(); return value.trim().slice(0, 160); }
export function dtOneAlpha2(value: unknown): string | undefined {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/.test(value)) return invalid();
  return alpha3ToAlpha2(value);
}
export function dtOneAlpha3(value: string): string {
  const code = /^[A-Z]{2}$/.test(value) ? alpha2ToAlpha3(value) : undefined;
  if (!code) throw new MobileTopUpError('INVALID_TOPUP_COUNTRY', 'Unsupported DT One destination', 400);
  return code;
}
function mapOperator(value: unknown): MobileTopUpOperator {
  const raw = doc(value); const id = positiveId(raw.id);
  const countryCode = dtOneAlpha2(doc(raw.country).iso_code);
  if (!countryCode) return invalid();
  encodeOperatorId('DTONE', id);
  return { id, provider: 'DTONE', countryCode, name: name(raw.name), status: true,
    bundle: false, denominationType: 'FIXED', senderCurrencyCode: '', destinationCurrencyCode: '',
    fixedAmounts: [], localFixedAmounts: [], fixedAmountsPlanNames: {}, localFixedAmountsPlanNames: {} };
}
const requiredSections = ['required_additional_identifier_fields', 'required_beneficiary_fields', 'required_debit_party_identifier_fields', 'required_sender_fields', 'required_statement_identifier_fields'];
function supportsRequiredFields(raw: Doc) {
  // Explicit null/empty is accepted; absent or unknown requirements fail closed.
  if (requiredSections.some(key => !Object.hasOwn(raw, key) || !(raw[key] === null || (Array.isArray(raw[key]) && raw[key].length === 0)))) return false;
  if (Object.keys(raw).some(key => key.startsWith('required_') && ![...requiredSections, 'required_credit_party_identifier_fields'].includes(key))) return false;
  const credit = raw.required_credit_party_identifier_fields;
  return credit === null || (Array.isArray(credit) && credit.some(group => Array.isArray(group) && group.length === 1 && group[0] === 'mobile_number'));
}
export function mapDtOneProduct(value: unknown, country: string, operatorId: number): MobileTopUpProduct | undefined {
  const raw = doc(value);
  const service = doc(raw.service);
  if (service.id !== 1 || ![11, 12, 13].includes(Number(doc(service.subservice).id)) || raw.type !== 'FIXED_VALUE_RECHARGE') return undefined;
  const operator = mapOperator(raw.operator);
  if (operator.id !== operatorId || operator.countryCode !== country) return invalid();
  const id = positiveId(raw.id);
  if (id > 2_147_483_647) return invalid();
  if (!supportsRequiredFields(raw)) return undefined;
  const source = doc(raw.source);
  // No browser FX, unreviewed provider fees or lossy rounding into Decimal(18,2).
  if (source.unit_type !== 'CURRENCY' || source.unit !== 'USD' || typeof source.amount !== 'number' ||
      !Number.isFinite(source.amount) || source.amount <= 0 || Math.abs(source.amount * 100 - Math.round(source.amount * 100)) > 1e-7) return undefined;
  const wholesale = doc(doc(raw.prices).wholesale);
  if (wholesale.unit !== 'USD' || wholesale.amount !== source.amount || wholesale.fee !== 0) return undefined;
  const destination = doc(raw.destination);
  const currencyDestination = destination.unit_type === 'CURRENCY' && typeof destination.unit === 'string' && /^[A-Z]{3}$/.test(destination.unit);
  const deliveredValue = currencyDestination && typeof destination.amount === 'number' && Number.isFinite(destination.amount) && destination.amount >= 0 ? destination.amount : undefined;
  const classification = Number(doc(service.subservice).id) === 11 ? 'AIRTIME' : Number(doc(service.subservice).id) === 12 ? 'BUNDLE' : 'DATA';
  return { id: `dtone:${country}:${encodeOperatorId('DTONE', operatorId)}:product:${id}`,
    provider: 'DTONE', providerProductId: String(id), countryCode: country, operatorId,
    kind: classification === 'AIRTIME' ? 'AIRTIME' : 'DATA', classification, name: name(raw.name),
    price: source.amount, priceCurrency: 'USD', amountType: 'FIXED', deliveredValue,
    deliveredCurrency: currencyDestination ? String(destination.unit) : '' };
}
function transaction(value: unknown): ProviderTopUpResult {
  const raw = doc(value); const id = positiveId(raw.id); const status = doc(raw.status);
  const statusClass = name(doc(status.class).message).toUpperCase();
  if (!['CREATED', 'CONFIRMED', 'SUBMITTED', 'COMPLETED', 'REJECTED', 'DECLINED', 'CANCELLED', 'REVERSED'].includes(statusClass)) return invalid();
  const source = raw.source ? doc(raw.source) : undefined;
  const destination = raw.destination ? doc(raw.destination) : undefined;
  return { transactionId: String(id), status: statusClass, rawStatus: name(status.message),
    operatorTransactionId: typeof raw.operator_reference === 'string' ? raw.operator_reference : undefined,
    requestedAmount: typeof source?.amount === 'number' ? source.amount : 0,
    requestedAmountCurrencyCode: typeof source?.unit === 'string' ? source.unit : '',
    deliveredAmount: destination?.unit_type === 'CURRENCY' && typeof destination.amount === 'number' && Number.isFinite(destination.amount) ? destination.amount : undefined,
    deliveredAmountCurrencyCode: destination?.unit_type === 'CURRENCY' && typeof destination.unit === 'string' ? destination.unit : undefined };
}

export class DtOnePreproductionProvider implements MobileTopUpProvider {
  readonly name = 'DTONE' as const;
  constructor(private readonly config: DtOneConfig, private readonly fetchImpl: typeof fetch = fetch) {
    if (config.baseUrl !== DTONE_PREPROD_URL || !config.enabled || !config.apiKey || config.apiKey.includes(':') || !config.apiSecret) {
      throw new Error('DT One requires enabled pre-production configuration and credentials');
    }
  }
  private async request(path: string, body?: unknown) {
    const url = new URL(path, `${this.config.baseUrl}/`);
    if (!url.href.startsWith(`${DTONE_PREPROD_URL}/`)) throw new MobileTopUpError('INVALID_PROVIDER_URL', 'Unexpected DT One URL', 500);
    let response: Response;
    try {
      response = await this.fetchImpl(url, { method: body === undefined ? 'GET' : 'POST', redirect: 'error',
        headers: { Authorization: `Basic ${Buffer.from(`${this.config.apiKey}:${this.config.apiSecret}`).toString('base64')}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
    } catch { throw new MobileTopUpError('DTONE_UNAVAILABLE', 'DT One pre-production request requires reconciliation or retry', 502); }
    if (!response.ok) {
      // Do not echo provider documents, URLs, credentials or recipient data.
      throw new MobileTopUpError('DTONE_REQUEST_FAILED', 'DT One pre-production request was not accepted', [400, 422].includes(response.status) ? 400 : 502);
    }
    let value: unknown;
    try { value = await response.json(); } catch { return invalid(); }
    return { value, headers: response.headers };
  }
  private async pages(path: string, query: Record<string, string>, body?: unknown) {
    const values: unknown[] = []; const seen = new Set<string>();
    for (let page = 1; page <= 1000; page++) {
      const params = new URLSearchParams({ ...query, page: String(page), per_page: '100' });
      const { value, headers } = await this.request(`${path}?${params}`, body);
      if (!Array.isArray(value)) return invalid();
      const fingerprint = JSON.stringify(value);
      if (value.length && seen.has(fingerprint)) return invalid();
      seen.add(fingerprint); values.push(...value);
      const total = headers.get('x-total-pages');
      const next = headers.get('x-next-page');
      if (total !== null) {
        if (!/^\d+$/.test(total) || Number(total) > 1000 || Number(total) < page && !(page === 1 && Number(total) === 0 && value.length === 0)) return invalid();
        if (page >= Number(total)) return values;
        if (!value.length) return invalid();
      } else if (next !== null) {
        if (next === '') return values;
        if (!/^\d+$/.test(next) || Number(next) !== page + 1 || !value.length) return invalid();
      } else if (value.length < 100) return values;
    }
    throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'DT One catalog pagination limit exceeded', 502);
  }
  async listCountries() {
    const raw = await this.pages('countries', { service_id: '1' });
    const countries = raw.flatMap(value => {
      const item = doc(value); const code = dtOneAlpha2(item.iso_code); const countryName = name(item.name);
      return code ? [{ code, name: countryName }] : [];
    });
    if (raw.length && !countries.length) return invalid();
    return countries;
  }
  async listOperators(country: string) {
    const values = await this.pages('operators', { service_id: '1', country_iso_code: dtOneAlpha3(country) });
    return values.map(value => { const op = mapOperator(value); if (op.countryCode !== country) return invalid(); return op; });
  }
  async getOperator(id: number) { const op = mapOperator((await this.request(`operators/${positiveId(id)}`)).value); if (op.id !== id) return invalid(); return op; }
  async detectOperator(phone: string, country: string) {
    if (!/^\+[1-9][0-9]{6,14}$/.test(phone)) throw new MobileTopUpError('INVALID_TOPUP_PHONE', 'Invalid mobile number', 400);
    const values = await this.pages('lookup/mobile-number', {}, { mobile_number: phone });
    const matches = values.filter(value => doc(value).identified === true).map(mapOperator).filter(op => op.countryCode === country);
    if (matches.length !== 1) throw new MobileTopUpError('TOPUP_OPERATOR_UNAVAILABLE', 'Select your recharge operator manually', 404);
    return matches[0]!;
  }
  async listProducts(country: string, id: number) {
    const values = await this.pages('products', { operator_id: String(positiveId(id)), service_id: '1', country_iso_code: dtOneAlpha3(country) });
    return values.map(value => mapDtOneProduct(value, country, id)).filter((item): item is MobileTopUpProduct => item !== undefined);
  }
  async submitTopUp(input: ProviderTopUpRequest) {
    if (input.provider !== 'DTONE' || !input.providerProductId || !/^[1-9]\d*$/.test(input.providerProductId) ||
        !/^\+[1-9][0-9]{6,14}$/.test(input.recipientPhone) || !input.customIdentifier) {
      throw new MobileTopUpError('INVALID_TOPUP_REQUEST', 'DT One requires an exact quoted product and normalized recipient', 400);
    }
    // Revalidate the same product, never replace it with another denomination.
    const rawProduct = (await this.request(`products/${input.providerProductId}`)).value;
    const product = mapDtOneProduct(rawProduct, input.recipientCountryCode, input.operatorId);
    if (!product || product.providerProductId !== input.providerProductId || product.id !== input.productId ||
        product.price !== input.amount || product.priceCurrency !== input.providerCurrency) {
      throw new MobileTopUpError('TOPUP_QUOTE_CHANGED', 'The quoted product is no longer available on the same terms', 400);
    }
    // Deterministic 40-character reference; the existing Reloadly identifier is unchanged.
    const externalId = createHash('sha256').update(input.customIdentifier).digest('hex').slice(0, 40);
    const result = doc((await this.request('async/transactions', { external_id: externalId,
      product_id: Number(input.providerProductId), auto_confirm: true, credit_party_identifier: { mobile_number: input.recipientPhone } })).value);
    if (result.external_id !== externalId || doc(result.product).id !== Number(input.providerProductId)) return invalid();
    return transaction(result);
  }
  async getTopUpStatus(id: string) {
    if (!/^[1-9]\d*$/.test(id)) throw new MobileTopUpError('INVALID_TRANSACTION_REFERENCE', 'Invalid DT One transaction reference', 502);
    const result = transaction((await this.request(`transactions/${id}`)).value);
    if (result.transactionId !== id) return invalid();
    return result;
  }
}
