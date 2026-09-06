import { z } from 'zod';
import type { MobileTopUpConfig } from './types.js';

const booleanValue = z.enum(['true', 'false']).transform((value) => value === 'true');

function optional(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function exactSandboxUrl(value: string | undefined, expected: string, name: string): string {
  const result = value?.trim() || expected;
  if (result !== expected) throw new Error(`${name} must use the reviewed Reloadly Sandbox URL`);
  return result;
}

export function loadMobileTopUpConfig(env: NodeJS.ProcessEnv = process.env): MobileTopUpConfig {
  const enabled = booleanValue.parse((env.MOBILE_TOPUP_ENABLED ?? 'false').toLowerCase());
  const environment = z.literal('sandbox').parse((env.RELOADLY_ENVIRONMENT ?? 'sandbox').toLowerCase());
  const productionEnabled = booleanValue.parse(
    (env.MOBILE_TOPUP_PRODUCTION_ENABLED ?? 'false').toLowerCase(),
  );
  const approvedForLiveUse = booleanValue.parse(
    (env.MOBILE_TOPUP_APPROVED_FOR_LIVE_USE ?? 'false').toLowerCase(),
  );
  if (productionEnabled || approvedForLiveUse) {
    throw new Error('Mobile recharge production activation is intentionally unavailable');
  }
  const quoteTtlSeconds = z.coerce.number().int().min(30).max(900)
    .parse(env.MOBILE_TOPUP_QUOTE_TTL_SECONDS ?? '300');
  const feeUsd = z.string().regex(/^\d+(?:\.\d{1,2})?$/).parse(env.MOBILE_TOPUP_FEE_USD ?? '0.00');
  const paymentMode = z.literal('mock').parse((env.MOBILE_TOPUP_PAYMENT_MODE ?? 'mock').toLowerCase());
  const config: MobileTopUpConfig = {
    enabled,
    environment,
    clientId: optional(env.RELOADLY_CLIENT_ID),
    clientSecret: optional(env.RELOADLY_CLIENT_SECRET),
    authUrl: exactSandboxUrl(
      env.RELOADLY_AUTH_URL,
      'https://auth.reloadly.com/oauth/token',
      'RELOADLY_AUTH_URL',
    ),
    airtimeBaseUrl: exactSandboxUrl(
      env.RELOADLY_AIRTIME_BASE_URL,
      'https://topups-sandbox.reloadly.com',
      'RELOADLY_AIRTIME_BASE_URL',
    ),
    senderPhoneCountry: optional(env.RELOADLY_SENDER_PHONE_COUNTRY)?.toUpperCase(),
    senderPhoneNumber: optional(env.RELOADLY_SENDER_PHONE_NUMBER),
    billingCurrency: z.literal('USD').parse((env.MOBILE_TOPUP_BILLING_CURRENCY ?? 'USD').toUpperCase()),
    feeUsd,
    quoteTtlSeconds,
    paymentMode,
    productionEnabled: false,
    approvedForLiveUse: false,
  };
  if (enabled && (!config.clientId || !config.clientSecret)) {
    throw new Error('RELOADLY_CLIENT_ID and RELOADLY_CLIENT_SECRET are required when mobile recharge is enabled');
  }
  return config;
}
