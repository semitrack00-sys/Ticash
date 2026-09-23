import { isSupportedCountry } from 'libphonenumber-js';
import { decodeOperatorId, encodeOperatorId, decodeTransactionReference, encodeTransactionReference } from './provider-identity.js';
import { MobileTopUpError, type MobileTopUpProvider, type MobileTopUpProviderName, type MobileTopUpOperator, type MobileTopUpCountry, type ProviderTopUpRequest, type ProviderCoverage } from './types.js';

export class GlobalRechargeProviderRouter implements MobileTopUpProvider {
  readonly providerNames: MobileTopUpProviderName[];
  private readonly providers: Map<MobileTopUpProviderName, MobileTopUpProvider>;
  constructor(entries: [MobileTopUpProviderName, MobileTopUpProvider][]) {
    if (new Set(entries.map(([name]) => name)).size !== entries.length) throw new Error('Duplicate recharge provider');
    this.providers = new Map(entries);
    this.providerNames = (['RELOADLY', 'DTONE', 'DING'] as const).filter(name => this.providers.has(name));
  }
  private owning(name: MobileTopUpProviderName) {
    const provider = this.providers.get(name);
    if (!provider) throw new MobileTopUpError('TOPUP_PROVIDER_DISABLED', 'The quoted recharge provider is unavailable', 503);
    return provider;
  }
  private operator(name: MobileTopUpProviderName, value: MobileTopUpOperator, country?: string) {
    if (!value || typeof value.name !== 'string' || !value.name.trim() || !/^[A-Z]{2}$/.test(value.countryCode) ||
        typeof value.status !== 'boolean' || (country && value.countryCode !== country) || (value.provider && value.provider !== name)) {
      throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Invalid provider operator data', 502);
    }
    let id: number;
    try { id = encodeOperatorId(name, value.id); }
    catch { throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Invalid provider operator identifier', 502); }
    return { ...value, id, provider: name };
  }
  private async countryCatalog() {
    const results = await Promise.all(this.providerNames.map(async name => {
      try {
        const raw = await this.owning(name).listCountries();
        if (!Array.isArray(raw) || raw.some(country => !country || typeof country.code !== 'string' || !/^[A-Za-z]{2}$/.test(country.code) || typeof country.name !== 'string' || !country.name.trim())) {
          throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Invalid provider country catalog', 502);
        }
        const countries = new Map<string, MobileTopUpCountry>();
        for (const country of raw) countries.set(country.code.toUpperCase(), { code: country.code.toUpperCase(), name: country.name.trim().slice(0, 160) });
        return { name, countries };
      } catch (error) {
        return { name, countries: undefined, reason: error instanceof MobileTopUpError && error.code === 'INVALID_PROVIDER_RESPONSE' ? 'INVALID_PROVIDER_RESPONSE' : 'PROVIDER_UNAVAILABLE' };
      }
    }));
    if (!results.some(result => result.countries)) throw new MobileTopUpError('TOPUP_PROVIDERS_UNAVAILABLE', 'No recharge provider catalog is available', 502);
    return results;
  }
  async listCountries() {
    const merged = new Map<string, MobileTopUpCountry>();
    for (const result of await this.countryCatalog()) {
      for (const [code, country] of result.countries ?? []) if (!merged.has(code)) merged.set(code, country);
    }
    return [...merged.values()].sort((a, b) => a.code.localeCompare(b.code));
  }
  async coverage(): Promise<ProviderCoverage> {
    const results = await this.countryCatalog();
    const sets = new Map(results.map(result => [result.name, new Set([...(result.countries?.keys() ?? [])].filter(code => isSupportedCountry(code)))]));
    const all = new Set([...sets.values()].flatMap(set => [...set]));
    const reloadly = sets.get('RELOADLY') ?? new Set<string>();
    const dtone = sets.get('DTONE') ?? new Set<string>();
    if (!all.size && results.some(result => result.countries?.size)) throw new MobileTopUpError('UNSUPPORTED_CALLING_CODE', 'No provider destinations have supported calling-code metadata', 502);
    return {
      environment: 'SANDBOX', uniqueCountries: all.size,
      providers: (['RELOADLY', 'DTONE', 'DING'] as const).map(provider => {
        const result = results.find(item => item.name === provider);
        return { provider, enabled: this.providers.has(provider), countries: sets.get(provider)?.size ?? 0,
          ...(!result ? { reason: 'NOT_CONFIGURED' } : result.reason ? { reason: result.reason } : {}) };
      }),
      overlapCountries: [...reloadly].filter(code => dtone.has(code)).sort(),
      reloadlyOnlyCountries: [...reloadly].filter(code => !dtone.has(code)).sort(),
      dtoneOnlyCountries: [...dtone].filter(code => !reloadly.has(code)).sort(),
    };
  }
  async listOperators(country: string) {
    const results = await Promise.allSettled(this.providerNames.map(async name => {
      const raw = await this.owning(name).listOperators(country);
      if (!Array.isArray(raw)) throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Invalid operator catalog', 502);
      return raw.map(value => this.operator(name, value, country)).filter(value => value.status);
    }));
    if (results.every(result => result.status === 'rejected')) throw new MobileTopUpError('TOPUP_PROVIDERS_UNAVAILABLE', 'No recharge operator catalog is available', 502);
    return [...new Map(results.flatMap(result => result.status === 'fulfilled' ? result.value : []).map(op => [op.id, op])).values()].sort((a, b) => a.id - b.id);
  }
  async detectOperator(phone: string, country: string) {
    for (const name of this.providerNames) {
      try { const op = this.operator(name, await this.owning(name).detectOperator(phone, country), country); if (op.status) return op; }
      catch { /* Discovery only: retain manual selection if lookup is unavailable. */ }
    }
    throw new MobileTopUpError('TOPUP_OPERATOR_UNAVAILABLE', 'Select your recharge operator manually', 404);
  }
  async getOperator(id: number) {
    const { provider, rawId } = decodeOperatorId(id);
    const result = this.operator(provider, await this.owning(provider).getOperator(rawId));
    if (result.id !== id) throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Provider returned a different operator', 502);
    return result;
  }
  async listProducts(country: string, id: number) {
    const { provider, rawId } = decodeOperatorId(id);
    const products = await this.owning(provider).listProducts?.(country, rawId);
    if (products === undefined) {
      if (provider === 'RELOADLY') return undefined;
      throw new MobileTopUpError('TOPUP_PRODUCTS_UNAVAILABLE', 'Native product discovery is unavailable', 502);
    }
    if (!Array.isArray(products) || products.some(item => !item || item.operatorId !== rawId || item.countryCode !== country || item.provider !== provider)) {
      throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Provider returned mismatched products', 502);
    }
    return products.map(item => ({ ...item, operatorId: id }));
  }
  async submitTopUp(input: ProviderTopUpRequest) {
    const { provider, rawId } = decodeOperatorId(input.operatorId);
    if (input.provider !== provider || !input.productId?.startsWith(`${provider.toLowerCase()}:${input.recipientCountryCode}:${input.operatorId}:`)) {
      throw new MobileTopUpError('TOPUP_PROVIDER_MISMATCH', 'Quoted provider identity does not match the operator and product', 400);
    }
    const result = await this.owning(provider).submitTopUp({ ...input, operatorId: rawId });
    return { ...result, transactionId: encodeTransactionReference(provider, result.transactionId) };
  }
  async getTopUpStatus(reference: string, expectedProvider?: MobileTopUpProviderName) {
    const { provider, id } = decodeTransactionReference(reference);
    if (expectedProvider && expectedProvider !== provider) throw new MobileTopUpError('TOPUP_PROVIDER_MISMATCH', 'Stored provider reference does not match its transaction', 502);
    const result = await this.owning(provider).getTopUpStatus(id);
    if (result.transactionId !== id) throw new MobileTopUpError('INVALID_PROVIDER_RESPONSE', 'Provider returned a different transaction', 502);
    return { ...result, transactionId: encodeTransactionReference(provider, result.transactionId) };
  }
}
