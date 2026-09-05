import type { PayoutMethod, TransferStatus } from '@ticash/shared';
import { z } from 'zod';

export interface PayoutRequest {
  recipientPhone: string;
  amountHtg: number;
  transferId: string;
}

export interface PayoutResult {
  status: TransferStatus;
  providerTransactionId: string;
}

export interface PayoutAdapter {
  readonly provider: PayoutMethod;
  readonly testMode: boolean;
  submit(request: PayoutRequest): Promise<PayoutResult>;
}

export interface PayoutConfig {
  mode: 'mock';
  enabledMethods: PayoutMethod[];
}

export class PayoutError extends Error {
  constructor(readonly code: string, message: string, readonly statusCode: number) {
    super(message);
  }
}

const booleanValue = z.enum(['true', 'false']).transform((value) => value === 'true');

export function loadPayoutConfig(env: NodeJS.ProcessEnv = process.env): PayoutConfig {
  const mode = z.literal('mock').parse((env.PAYOUTS_MODE ?? 'mock').toLowerCase());
  const enabledMethods: PayoutMethod[] = [];
  if (booleanValue.parse((env.MONCASH_SANDBOX_ENABLED ?? 'true').toLowerCase())) enabledMethods.push('MONCASH');
  if (booleanValue.parse((env.NATCASH_SANDBOX_ENABLED ?? 'true').toLowerCase())) enabledMethods.push('NATCASH');
  return { mode, enabledMethods };
}

class MockPayoutAdapter implements PayoutAdapter {
  readonly testMode = true;
  constructor(readonly provider: PayoutMethod) {}

  async submit(request: PayoutRequest): Promise<PayoutResult> {
    if (!/^\+509\d{8}$/.test(request.recipientPhone) || request.amountHtg <= 0) {
      throw new PayoutError('INVALID_PAYOUT_REQUEST', 'Invalid Haiti sandbox payout request', 400);
    }
    return {
      status: 'PROCESSING',
      providerTransactionId: `mock-${this.provider.toLowerCase()}-${request.transferId}`,
    };
  }
}

export function payoutAdapterFor(provider: PayoutMethod, config: PayoutConfig): PayoutAdapter {
  if (!config.enabledMethods.includes(provider)) {
    throw new PayoutError('PAYOUT_METHOD_UNAVAILABLE', `${provider} is not enabled for Haiti sandbox payouts`, 409);
  }
  return new MockPayoutAdapter(provider);
}

export function publicPayoutMethods(config: PayoutConfig) {
  return config.enabledMethods.map((method) => ({
    id: method,
    country: 'HT' as const,
    currency: 'HTG' as const,
    displayName: method === 'MONCASH' ? 'MonCash' : 'Natcash',
    enabled: true,
    testMode: true,
    approvedForLiveUse: false,
  }));
}
