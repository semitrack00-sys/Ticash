export const DTONE_PREPROD_URL = 'https://preprod-dvs-api.dtone.com/v1';
export interface DtOneConfig { enabled: boolean; apiKey?: string; apiSecret?: string; baseUrl: string }
export function loadDtOneConfig(env: NodeJS.ProcessEnv = process.env): DtOneConfig {
  const enabledValue = env.DTONE_ENABLED ?? 'false';
  if (!['true', 'false'].includes(enabledValue)) throw new Error('DTONE_ENABLED must be true or false');
  const config = { enabled: enabledValue === 'true', apiKey: env.DTONE_API_KEY?.trim(), apiSecret: env.DTONE_API_SECRET?.trim(), baseUrl: env.DTONE_BASE_URL?.trim() || DTONE_PREPROD_URL };
  if (config.baseUrl !== DTONE_PREPROD_URL) throw new Error('DTONE_BASE_URL must use the reviewed pre-production URL');
  if (config.enabled && (!config.apiKey || !config.apiSecret || config.apiKey.includes(':'))) {
    throw new Error('DT One pre-production credentials are required when enabled');
  }
  if (config.enabled && ['MOBILE_TOPUP_PRODUCTION_ENABLED', 'MOBILE_TOPUP_APPROVED_FOR_LIVE_USE', 'APPROVED_FOR_LIVE_USE', 'LIVE_MONEY_ENABLED'].some(key => env[key]?.toLowerCase() === 'true')) {
    throw new Error('DT One production and live money activation are unavailable');
  }
  return config;
}
