// Run only after building. This tool cannot call a transfer/payment/database endpoint.
import { loadDingConfig, DING_TOKEN_URL, DING_API_URL } from '../apps/api/dist/topup/ding-config.js';
import { DingUatProvider } from '../apps/api/dist/topup/ding-provider.js';

try {
  // Enable only this isolated adapter instance, not the server or .env configuration.
  const config = loadDingConfig({ ...process.env, DING_ENABLED: 'true' });
  const allowed = new Set(['GetCountries', 'GetProviders', 'GetProviderStatus', 'GetProducts']);
  const readOnlyFetch = async (url, init) => {
    const parsed = new URL(String(url));
    const token = parsed.href === DING_TOKEN_URL && init?.method === 'POST';
    const catalog = parsed.origin === new URL(DING_API_URL).origin && parsed.pathname.startsWith('/api/V1/') &&
      allowed.has(parsed.pathname.slice('/api/V1/'.length)) && init?.method === 'GET';
    if (!token && !catalog) throw new Error('Operation is not allowed in read-only Ding validation');
    return fetch(url, init);
  };
  const provider = new DingUatProvider(config, readOnlyFetch);
  const countries = await provider.listCountries();
  const summary = { provider: 'DING', environment: 'uat', countryCount: countries.length };
  const selected = process.env.DING_UAT_COUNTRY;
  if (selected) {
    if (!countries.some(country => country.code === selected)) throw new Error('Country is absent from the returned Ding catalog');
    const operators = await provider.listOperators(selected);
    const first = operators.find(operator => operator.status);
    const products = first ? await provider.listProducts(selected, first.id) : [];
    Object.assign(summary, { selectedCountry: selected, operatorCount: operators.length, eligibleProductsForFirstActiveOperator: products.length });
  }
  console.log(JSON.stringify(summary, null, 2));
} catch {
  // Do not print raw provider errors, configuration, tokens, catalog text or credentials.
  console.error('Ding read-only UAT check failed. Check Test Agent credentials, UAT configuration, account access and catalog eligibility.');
  process.exitCode = 1;
}
