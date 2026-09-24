export const DING_TOKEN_URL = 'https://idp.ding.com/connect/token';
export const DING_API_URL = 'https://api.dingconnect.com/api/V1';
export interface DingConfig { enabled: boolean; environment: 'uat'; clientId?: string; clientSecret?: string; tokenUrl: string; baseUrl: string }
export function loadDingConfig(env: NodeJS.ProcessEnv = process.env): DingConfig {
  if (!['true', 'false'].includes(env.DING_ENABLED ?? 'false')) throw new Error('DING_ENABLED must be true or false');
  if ((env.DING_ENVIRONMENT ?? 'uat') !== 'uat') throw new Error('Ding supports UAT only');
  const tokenUrl = env.DING_OAUTH_TOKEN_URL?.trim() || DING_TOKEN_URL;
  const baseUrl = env.DING_API_BASE_URL?.trim() || DING_API_URL;
  if (tokenUrl !== DING_TOKEN_URL || baseUrl !== DING_API_URL) throw new Error('Ding URLs must match the reviewed UAT configuration');
  const enabled = env.DING_ENABLED === 'true';
  const clientId = env.DING_CLIENT_ID?.trim(); const clientSecret = env.DING_CLIENT_SECRET?.trim();
  if (enabled && (!clientId || !clientSecret)) throw new Error('DING_CLIENT_ID and DING_CLIENT_SECRET are required when Ding is enabled');
  if (enabled && ['MOBILE_TOPUP_PRODUCTION_ENABLED', 'MOBILE_TOPUP_APPROVED_FOR_LIVE_USE', 'APPROVED_FOR_LIVE_USE', 'LIVE_MONEY_ENABLED', 'CHECKOUT_COM_ENABLED'].some(key => (env[key] ?? 'false').toLowerCase() !== 'false')) {
    throw new Error('Ding requires production, live money and Checkout.com gates disabled');
  }
  if (enabled && ['PAYMENTS_MODE', 'MOBILE_TOPUP_PAYMENT_MODE'].some(key => (env[key] ?? 'mock') !== 'mock')) throw new Error('Ding requires mock payments');
  return { enabled, environment: 'uat', clientId, clientSecret, tokenUrl, baseUrl };
}
