import type { Prisma } from '@prisma/client';
import { MobileTopUpError } from '../topup/types.js';

export type IdentityGate = {
  refresh(customerId: string): Promise<unknown>;
  check(tx: Prisma.TransactionClient, customerId: string, amount: number, transactionId?: string): Promise<string | undefined>;
};

export function identityRequired(amount: number, reserved24h: number, flagged: boolean) {
  return flagged || amount > 25 || amount + reserved24h > 50;
}

export async function assertIdentity(gate: IdentityGate | undefined, tx: Prisma.TransactionClient,
  customerId: string, amount: number, transactionId?: string) {
  const reason = await gate?.check(tx, customerId, amount, transactionId);
  if (reason) throw new MobileTopUpError(reason, 'Complete account verification in Account before purchasing. Contact support if verification is unavailable.', 403);
}
