import { z } from 'zod';
import type { MobileTopUpConfig } from './types.js';
import type { StripeConfig } from './stripe-config.js';
import type { MobileTopUpRuntimeEnvironment } from './types.js';

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

function exactUrl(value: string | undefined, expected: string, name: string): string {
  const result = value?.trim() || expected;
  if (result !== expected) throw new Error(`${name} must match the reviewed value`);
  return result;
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function runtimeEnvironment(environment: MobileTopUpConfig['environment']): MobileTopUpRuntimeEnvironment {
  return environment === 'production' ? 'PRODUCTION' : 'SANDBOX';
}

export function assertMobileTopUpConfigurationCoherence(config: MobileTopUpConfig, stripeConfig: StripeConfig) {
  if (config.paymentMode === 'stripe_live' && config.environment !== 'production') {
    throw new Error('MOBILE_TOPUP_PAYMENT_MODE=stripe_live requires RELOADLY_ENVIRONMENT=production');
  }
  if (config.paymentMode === 'stripe_sandbox' && config.environment !== 'sandbox') {
    throw new Error('MOBILE_TOPUP_PAYMENT_MODE=stripe_sandbox requires RELOADLY_ENVIRONMENT=sandbox');
  }
  if (config.environment === 'production' && config.paymentMode !== 'stripe_live') {
    throw new Error('RELOADLY_ENVIRONMENT=production requires MOBILE_TOPUP_PAYMENT_MODE=stripe_live');
  }
  if (config.liveRechargeEnabled && (config.environment !== 'production' || config.paymentMode !== 'stripe_live')) {
    throw new Error('Live mobile recharge gates require coherent production mode and stripe_live payments');
  }
  if ((config.environment === 'production' || config.paymentMode === 'stripe_live') && !config.liveRechargeEnabled) {
    throw new Error('Production mobile recharge requires all four live gates');
  }
  if (stripeConfig.environment !== config.environment) {
    throw new Error('Stripe and Reloadly environments must match exactly');
  }
  if (config.paymentMode === 'stripe_sandbox' && stripeConfig.environment !== 'sandbox') {
    throw new Error('MOBILE_TOPUP_PAYMENT_MODE=stripe_sandbox requires STRIPE_ENVIRONMENT=sandbox');
  }
  if (config.paymentMode === 'stripe_live' && stripeConfig.environment !== 'production') {
    throw new Error('MOBILE_TOPUP_PAYMENT_MODE=stripe_live requires STRIPE_ENVIRONMENT=production');
  }
  if (config.paymentMode === 'stripe_live' && !stripeConfig.enabled) {
    throw new Error('MOBILE_TOPUP_PAYMENT_MODE=stripe_live requires complete Stripe production configuration');
  }
  if (config.paymentMode === 'stripe_sandbox' && !stripeConfig.enabled) {
    throw new Error('MOBILE_TOPUP_PAYMENT_MODE=stripe_sandbox requires complete Stripe sandbox configuration');
  }
}

export function topUpRuntimeEnvironment(config: MobileTopUpConfig): MobileTopUpRuntimeEnvironment {
  return runtimeEnvironment(config.environment);
}

export function loadMobileTopUpConfig(env: NodeJS.ProcessEnv = process.env): MobileTopUpConfig {
  const enabled = booleanValue.parse((env.MOBILE_TOPUP_ENABLED ?? 'false').toLowerCase());
  const environment = z.enum(['sandbox', 'production']).parse((env.RELOADLY_ENVIRONMENT ?? 'sandbox').toLowerCase());
  const productionEnabled = booleanValue.parse(
    (env.MOBILE_TOPUP_PRODUCTION_ENABLED ?? 'false').toLowerCase(),
  );
  const approvedForLiveUse = booleanValue.parse(
    (env.MOBILE_TOPUP_APPROVED_FOR_LIVE_USE ?? 'false').toLowerCase(),
  );
  const appApprovedForLiveUse = booleanValue.parse((env.APPROVED_FOR_LIVE_USE ?? 'false').toLowerCase());
  const liveMoneyEnabled = booleanValue.parse((env.LIVE_MONEY_ENABLED ?? 'false').toLowerCase());
  const anyLiveGate = productionEnabled || approvedForLiveUse || appApprovedForLiveUse || liveMoneyEnabled;
  const liveRechargeEnabled = productionEnabled && approvedForLiveUse && appApprovedForLiveUse && liveMoneyEnabled;
  const quoteTtlSeconds = z.coerce.number().int().min(30).max(900)
    .parse(env.MOBILE_TOPUP_QUOTE_TTL_SECONDS ?? '300');
  const checkoutResumeTtlSeconds = z.coerce.number().int().min(60).max(86_400)
    .parse(env.MOBILE_TOPUP_CHECKOUT_RESUME_TTL_SECONDS ?? '3600');
  const paymentMode = z.enum(['mock', 'stripe_sandbox', 'stripe_live'])
    .parse((env.MOBILE_TOPUP_PAYMENT_MODE ?? 'mock').toLowerCase());
  const sandboxClientId = optional(env.RELOADLY_CLIENT_ID);
  const sandboxClientSecret = optional(env.RELOADLY_CLIENT_SECRET);
  const liveClientId = optional(env.RELOADLY_LIVE_CLIENT_ID);
  const liveClientSecret = optional(env.RELOADLY_LIVE_CLIENT_SECRET);
  if (environment === 'sandbox' && (hasValue(env.RELOADLY_LIVE_CLIENT_ID) || hasValue(env.RELOADLY_LIVE_CLIENT_SECRET))) {
    throw new Error('Sandbox mode must not include Reloadly live credentials');
  }
  if (environment === 'production' && (hasValue(env.RELOADLY_CLIENT_ID) || hasValue(env.RELOADLY_CLIENT_SECRET))) {
    throw new Error('Production mode must not include Reloadly sandbox credentials');
  }
  const selectedClientId = environment === 'production' ? liveClientId : sandboxClientId;
  const selectedClientSecret = environment === 'production' ? liveClientSecret : sandboxClientSecret;
  const airtimeBaseUrl = environment === 'production'
    ? exactUrl(env.RELOADLY_AIRTIME_BASE_URL, 'https://topups.reloadly.com', 'RELOADLY_AIRTIME_BASE_URL')
    : exactSandboxUrl(env.RELOADLY_AIRTIME_BASE_URL, 'https://topups-sandbox.reloadly.com', 'RELOADLY_AIRTIME_BASE_URL');
  const config: MobileTopUpConfig = {
    enabled,
    environment,
    clientId: selectedClientId,
    clientSecret: selectedClientSecret,
    authUrl: exactUrl(
      env.RELOADLY_AUTH_URL,
      'https://auth.reloadly.com/oauth/token',
      'RELOADLY_AUTH_URL',
    ),
    airtimeBaseUrl,
    senderPhoneCountry: optional(env.RELOADLY_SENDER_PHONE_COUNTRY)?.toUpperCase(),
    senderPhoneNumber: optional(env.RELOADLY_SENDER_PHONE_NUMBER),
    billingCurrency: z.literal('USD').parse((env.MOBILE_TOPUP_BILLING_CURRENCY ?? 'USD').toUpperCase()),
    quoteTtlSeconds,
    checkoutResumeTtlSeconds,
    paymentMode,
    productionEnabled,
    approvedForLiveUse,
    appApprovedForLiveUse,
    liveMoneyEnabled,
    liveRechargeEnabled,
  };
  if (config.environment === 'production' && (!config.clientId || !config.clientSecret)) {
    throw new Error('RELOADLY_LIVE_CLIENT_ID and RELOADLY_LIVE_CLIENT_SECRET are required when production mobile recharge is configured');
  }
  if (enabled && (!config.clientId || !config.clientSecret)) {
    throw new Error('RELOADLY_CLIENT_ID and RELOADLY_CLIENT_SECRET are required when mobile recharge is enabled');
  }
  if (anyLiveGate && !config.liveRechargeEnabled) {
    throw new Error('Production mobile recharge requires MOBILE_TOPUP_PRODUCTION_ENABLED, MOBILE_TOPUP_APPROVED_FOR_LIVE_USE, APPROVED_FOR_LIVE_USE, and LIVE_MONEY_ENABLED all true');
  }
  if ((config.environment === 'production' || config.paymentMode === 'stripe_live') && !config.liveRechargeEnabled) {
    throw new Error('Production mobile recharge requires MOBILE_TOPUP_PRODUCTION_ENABLED, MOBILE_TOPUP_APPROVED_FOR_LIVE_USE, APPROVED_FOR_LIVE_USE, and LIVE_MONEY_ENABLED all true');
  }
  if (config.liveRechargeEnabled && (runtimeEnvironment(config.environment) !== 'PRODUCTION' || config.paymentMode !== 'stripe_live')) {
    throw new Error('Live mobile recharge gates require RELOADLY_ENVIRONMENT=production and MOBILE_TOPUP_PAYMENT_MODE=stripe_live');
  }
  return config;
}
