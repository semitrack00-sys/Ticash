import { z } from 'zod';

export interface CheckoutConfig {
  enabled: boolean;
  environment: 'sandbox';
  apiBaseUrl?: string;
  processingChannelId?: string;
  secretKey?: string;
  publicKey?: string;
  webhookSecret?: string;
  successUrl?: string;
  failureUrl?: string;
}

export function loadCheckoutConfig(env: NodeJS.ProcessEnv = process.env): CheckoutConfig {
  const config: CheckoutConfig = {
    enabled: z.enum(['true', 'false']).parse(env.CHECKOUT_COM_ENABLED ?? 'false') === 'true',
    environment: z.literal('sandbox').parse(env.CHECKOUT_COM_ENVIRONMENT ?? 'sandbox'),
    apiBaseUrl: env.CHECKOUT_COM_API_BASE_URL?.trim() || undefined,
    processingChannelId: env.CHECKOUT_COM_PROCESSING_CHANNEL_ID?.trim() || undefined,
    secretKey: env.CHECKOUT_COM_SECRET_KEY?.trim() || undefined,
    publicKey: env.CHECKOUT_COM_PUBLIC_KEY?.trim() || undefined,
    webhookSecret: env.CHECKOUT_COM_WEBHOOK_SECRET?.trim() || undefined,
    successUrl: env.CHECKOUT_COM_SUCCESS_URL?.trim() || undefined,
    failureUrl: env.CHECKOUT_COM_FAILURE_URL?.trim() || undefined,
  };
  validateCheckoutConfig(config);
  return config;
}

export function validateCheckoutConfig(config: CheckoutConfig) {
  if (config.environment !== 'sandbox') throw new Error('Checkout.com production is unavailable');
  if (config.apiBaseUrl) {
    const url = new URL(config.apiBaseUrl);
    if (url.protocol !== 'https:' || !/^[a-z0-9]{8}\.api\.sandbox\.checkout\.com$/.test(url.hostname) ||
        url.port || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw new Error('Checkout.com requires the account-specific HTTPS sandbox API base URL');
    }
  }
  if (config.processingChannelId && !/^pc_[a-z0-9]{26}$/.test(config.processingChannelId)) {
    throw new Error('Checkout.com requires a valid processing channel ID');
  }
  if (config.enabled && (!config.apiBaseUrl || !config.processingChannelId || !config.secretKey?.startsWith('sk_sbox_') ||
      !config.publicKey?.startsWith('pk_sbox_') || !config.webhookSecret || !config.successUrl || !config.failureUrl)) {
    throw new Error('Checkout.com requires complete sandbox credentials, processing channel, webhook key and redirect URLs');
  }
  for (const value of [config.successUrl, config.failureUrl].filter(Boolean)) {
    const url = new URL(value!);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) {
      throw new Error('Checkout.com redirects require server-configured HTTPS URLs without credentials or query strings');
    }
  }
}
