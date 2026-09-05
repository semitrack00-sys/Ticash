import { z } from 'zod';
import type { FundingConfig } from './types.js';

const booleanValue = z.enum(['true', 'false']).transform((value) => value === 'true');

function optionalSecret(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function loadFundingConfig(env: NodeJS.ProcessEnv = process.env): FundingConfig {
  const enabled = booleanValue.parse((env.DWOLLA_ENABLED ?? 'false').toLowerCase());
  const productionEnabled = booleanValue.parse((env.DWOLLA_PRODUCTION_ENABLED ?? 'false').toLowerCase());
  const liveFundingEnabled = booleanValue.parse((env.DWOLLA_LIVE_FUNDING_ENABLED ?? 'false').toLowerCase());
  const approvedForLiveUse = booleanValue.parse((env.DWOLLA_APPROVED_FOR_LIVE_USE ?? 'false').toLowerCase());
  const environment = z.enum(['sandbox', 'production']).parse(
    (env.DWOLLA_ENVIRONMENT ?? 'sandbox').toLowerCase(),
  );

  const config: FundingConfig = {
    enabled,
    environment,
    clientId: optionalSecret(env.DWOLLA_CLIENT_ID),
    clientSecret: optionalSecret(env.DWOLLA_CLIENT_SECRET),
    webhookSecret: optionalSecret(env.DWOLLA_WEBHOOK_SECRET),
    masterFundingSourceUrl: optionalSecret(env.DWOLLA_MASTER_FUNDING_SOURCE_URL),
    productionEnabled,
    liveFundingEnabled,
    approvedForLiveUse,
  };

  if (!enabled) return config;
  if (!config.clientId || !config.clientSecret || !config.webhookSecret) {
    throw new Error(
      'DWOLLA_CLIENT_ID, DWOLLA_CLIENT_SECRET, and DWOLLA_WEBHOOK_SECRET are required when DWOLLA_ENABLED=true',
    );
  }
  if (environment === 'production' &&
      !(productionEnabled && liveFundingEnabled && approvedForLiveUse)) {
    throw new Error(
      'Dwolla production requires DWOLLA_PRODUCTION_ENABLED, DWOLLA_LIVE_FUNDING_ENABLED, and DWOLLA_APPROVED_FOR_LIVE_USE',
    );
  }
  if (environment === 'production') {
    throw new Error('Dwolla production is intentionally unavailable in this sandbox/UAT build');
  }
  return config;
}

export function assertFundingEnabled(config: FundingConfig): void {
  if (!config.enabled) {
    const error = new Error('Dwolla funding is disabled');
    error.name = 'FUNDING_DISABLED';
    throw error;
  }
}
