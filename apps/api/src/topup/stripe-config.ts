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

export function loadStripeConfig(env: NodeJS.ProcessEnv = process.env): StripeConfig {
  const config: StripeConfig = {
    enabled: z.enum(['true', 'false']).parse(env.STRIPE_ENABLED ?? 'false') === 'true',
    environment: z.literal('sandbox').parse((env.STRIPE_ENVIRONMENT ?? 'sandbox').toLowerCase()),
    secretKey: env.STRIPE_SECRET_KEY?.trim() || undefined,
    publicKey: env.STRIPE_PUBLIC_KEY?.trim() || undefined,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    successUrl: env.STRIPE_SUCCESS_URL?.trim() || undefined,
    failureUrl: env.STRIPE_FAILURE_URL?.trim() || undefined,
  };
  validateStripeConfig(config);
  return config;
}

export function validateStripeConfig(config: StripeConfig) {
  if (config.environment !== 'sandbox') throw new Error('Stripe production is unavailable');
  if (config.enabled && (
    !config.secretKey?.startsWith('sk_test_') ||
    !config.publicKey?.startsWith('pk_test_') ||
    !config.webhookSecret?.startsWith('whsec_') ||
    !config.successUrl ||
    !config.failureUrl
  )) {
    throw new Error('Stripe requires complete test credentials, webhook secret and redirect URLs');
  }
  for (const value of [config.successUrl, config.failureUrl].filter(Boolean)) {
    const url = new URL(value!);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
      throw new Error('Stripe redirects require server-configured HTTPS URLs without credentials or query strings');
    }
  }
}
