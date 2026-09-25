import { z } from 'zod';

export interface StripeConfig {
  enabled: boolean;
  environment: 'sandbox';
  secretKey?: string;
  publicKey?: string;
  webhookSecret?: string;
  successUrl?: string;
  failureUrl?: string;
}

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

export function loadStripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig {
  const paymentMode = (env.MOBILE_TOPUP_PAYMENT_MODE ?? '').trim().toLowerCase();
  const stripeRequired = paymentMode === 'stripe_sandbox';
  const config: StripeConfig = {
    enabled: z.enum(['true', 'false']).parse(env.STRIPE_ENABLED ?? 'false') === 'true',
    environment: z.literal('sandbox').parse((env.STRIPE_ENVIRONMENT ?? 'sandbox').toLowerCase()),
    secretKey: env.STRIPE_SECRET_KEY?.trim() || undefined,
    publicKey: env.STRIPE_PUBLIC_KEY?.trim() || undefined,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    successUrl: env.STRIPE_SUCCESS_URL?.trim() || undefined,
    failureUrl: env.STRIPE_FAILURE_URL?.trim() || undefined,
  };
  validateStripeConfig(config, { strict: stripeRequired });
  return config;
}

export function validateStripeConfig(config: StripeConfig, { strict = true }: { strict?: boolean } = {}) {
  if (config.environment !== 'sandbox') throw new Error('Stripe production is unavailable');
  const incomplete = (
    !config.secretKey?.startsWith('sk_test_') ||
    !config.publicKey?.startsWith('pk_test_') ||
    !config.webhookSecret?.startsWith('whsec_') ||
    !config.successUrl ||
    !config.failureUrl
  );
  if (config.enabled && incomplete) {
    if (!strict) {
      config.enabled = false;
      return;
    }
    throw stripeValidationError('Stripe requires complete test credentials, webhook secret and redirect URLs', config);
  }
  for (const value of (config.enabled ? [config.successUrl, config.failureUrl].filter(Boolean) : [])) {
    const url = new URL(value!);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
      throw stripeValidationError('Stripe redirects require server-configured HTTPS URLs without credentials or query strings', config);
    }
  }
}
