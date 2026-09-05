import { z } from 'zod';
import type { DiditConfig } from './types.js';

const booleanValue = z.enum(['true', 'false']).transform((value) => value === 'true');

function optionalValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function loadDiditConfig(env: NodeJS.ProcessEnv = process.env): DiditConfig {
  const enabled = booleanValue.parse((env.DIDIT_ENABLED ?? 'false').toLowerCase());
  const baseUrl = optionalValue(env.DIDIT_BASE_URL) ?? 'https://verification.didit.me';
  let parsedBaseUrl: URL;
  try {
    parsedBaseUrl = new URL(baseUrl);
  } catch {
    throw new Error('DIDIT_BASE_URL must be a valid HTTPS URL');
  }
  if (parsedBaseUrl.protocol !== 'https:' || parsedBaseUrl.username || parsedBaseUrl.password) {
    throw new Error('DIDIT_BASE_URL must be a valid HTTPS URL');
  }

  const config: DiditConfig = {
    enabled,
    apiKey: optionalValue(env.DIDIT_API_KEY),
    webhookSecret: optionalValue(env.DIDIT_WEBHOOK_SECRET),
    workflowId: optionalValue(env.DIDIT_WORKFLOW_ID),
    baseUrl: parsedBaseUrl.toString().replace(/\/$/, ''),
  };
  if (!enabled) return config;
  if (!config.apiKey || !config.webhookSecret || !config.workflowId) {
    throw new Error(
      'DIDIT_API_KEY, DIDIT_WEBHOOK_SECRET, and DIDIT_WORKFLOW_ID are required when DIDIT_ENABLED=true',
    );
  }
  if (!z.string().uuid().safeParse(config.workflowId).success) {
    throw new Error('DIDIT_WORKFLOW_ID must be a valid UUID');
  }
  return config;
}
