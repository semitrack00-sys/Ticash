import { z } from 'zod';

export interface StripeConfig {
  enabled: boolean;
  environment: 'sandbox' | 'production';
  testMode: boolean;
  secretKey?: string;
  publicKey?: string;
  webhookSecret?: string;
  successUrl?: string;
  failureUrl?: string;
}

const approvedReturnOrigins = new Set([
  'https://ticash-app.com',
  'https://www.ticash-app.com',
  'https://flupflap.com',
  'https://www.flupflap.com',
]);

interface StripeStartupDiagnostics {
  secretKeyPresent: boolean;
  secretKeyTestPrefix: boolean;
  publicKeyPresent: boolean;
  publicKeyTestPrefix: boolean;
  webhookSecretPresent: boolean;
  webhookSecretPrefix: boolean;
  successUrlPresent: boolean;
  failureUrlPresent: boolean;
}

function stripeStartupDiagnostics(config: StripeConfig): StripeStartupDiagnostics {
  return {
    secretKeyPresent: Boolean(config.secretKey),
    secretKeyTestPrefix: Boolean(config.secretKey?.startsWith('sk_test_')),
    publicKeyPresent: Boolean(config.publicKey),
    publicKeyTestPrefix: Boolean(config.publicKey?.startsWith('pk_test_')),
    webhookSecretPresent: Boolean(config.webhookSecret),
    webhookSecretPrefix: Boolean(config.webhookSecret?.startsWith('whsec_')),
    successUrlPresent: Boolean(config.successUrl),
    failureUrlPresent: Boolean(config.failureUrl),
  };
}

function stripeValidationError(message: string, config: StripeConfig): Error {
  const diagnostics = stripeStartupDiagnostics(config);
  return new Error(`${message} diagnostics=${JSON.stringify(diagnostics)}`);
}

function hasValue(value: string | undefined): boolean {
  return Boolean(value?.trim());
}

function validateAllowedReturnUrl(value: string, config: StripeConfig) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || !approvedReturnOrigins.has(url.origin)) {
    throw stripeValidationError('Stripe redirects must target approved TiCash or FlupFlap HTTPS origins without credentials or query strings', config);
  }
}

export function loadStripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig {
  const paymentMode = (env.MOBILE_TOPUP_PAYMENT_MODE ?? '').trim().toLowerCase();
  const stripeRequired = paymentMode === 'stripe_sandbox' || paymentMode === 'stripe_live';
  const environment = z.enum(['sandbox', 'production']).parse((env.STRIPE_ENVIRONMENT ?? 'sandbox').toLowerCase());
  const sandboxSecretKey = env.STRIPE_SECRET_KEY?.trim() || undefined;
  const sandboxPublicKey = env.STRIPE_PUBLIC_KEY?.trim() || undefined;
  const sandboxWebhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim() || undefined;
  const liveSecretKey = env.STRIPE_LIVE_SECRET_KEY?.trim() || undefined;
  const livePublicKey = env.STRIPE_LIVE_PUBLIC_KEY?.trim() || undefined;
  const liveWebhookSecret = env.STRIPE_LIVE_WEBHOOK_SECRET?.trim() || undefined;
  if (environment === 'sandbox' && [liveSecretKey, livePublicKey, liveWebhookSecret].some(hasValue)) {
    throw new Error('Stripe sandbox mode must not include live credential variables');
  }
  if (environment === 'production' && [sandboxSecretKey, sandboxPublicKey, sandboxWebhookSecret].some(hasValue)) {
    throw new Error('Stripe production mode must not include sandbox credential variables');
  }
  const secretKey = environment === 'production' ? liveSecretKey : sandboxSecretKey;
  const publicKey = environment === 'production' ? livePublicKey : sandboxPublicKey;
  const webhookSecret = environment === 'production' ? liveWebhookSecret : sandboxWebhookSecret;
  const config: StripeConfig = {
    enabled: z.enum(['true', 'false']).parse(env.STRIPE_ENABLED ?? 'false') === 'true',
    environment,
    testMode: environment === 'sandbox',
    secretKey,
    publicKey,
    webhookSecret,
    successUrl: env.STRIPE_SUCCESS_URL?.trim() || undefined,
    failureUrl: env.STRIPE_FAILURE_URL?.trim() || undefined,
  };

  if (paymentMode === 'stripe_sandbox' && config.environment !== 'sandbox') {
    throw stripeValidationError('MOBILE_TOPUP_PAYMENT_MODE=stripe_sandbox requires STRIPE_ENVIRONMENT=sandbox', config);
  }
  if (paymentMode === 'stripe_live' && config.environment !== 'production') {
    throw stripeValidationError('MOBILE_TOPUP_PAYMENT_MODE=stripe_live requires STRIPE_ENVIRONMENT=production', config);
  }

  validateStripeConfig(config, { strict: stripeRequired });
  return config;
}

export function validateStripeConfig(config: StripeConfig, { strict = true }: { strict?: boolean } = {}) {
  const secretPrefix = config.environment === 'production' ? 'sk_live_' : 'sk_test_';
  const publicPrefix = config.environment === 'production' ? 'pk_live_' : 'pk_test_';
  const oppositeSecretPrefix = config.environment === 'production' ? 'sk_test_' : 'sk_live_';
  const oppositePublicPrefix = config.environment === 'production' ? 'pk_test_' : 'pk_live_';

  if (config.secretKey?.startsWith(oppositeSecretPrefix) || config.publicKey?.startsWith(oppositePublicPrefix)) {
    throw stripeValidationError('Stripe credential key prefixes do not match STRIPE_ENVIRONMENT', config);
  }

  const incomplete = (
    !config.secretKey?.startsWith(secretPrefix) ||
    !config.publicKey?.startsWith(publicPrefix) ||
    !config.webhookSecret?.startsWith('whsec_') ||
    !config.successUrl ||
    !config.failureUrl
  );
  if (incomplete) {
    if (strict) {
      throw stripeValidationError('Stripe requires complete credentials, webhook secret and redirect URLs for the selected environment', config);
    }
    if (config.enabled) {
      config.enabled = false;
      return;
    }
  }
  for (const value of (config.enabled ? [config.successUrl, config.failureUrl].filter(Boolean) : [])) {
    validateAllowedReturnUrl(value!, config);
  }
}
