import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(12).max(128)
  .regex(/[a-z]/, 'Password must include a lowercase letter')
  .regex(/[A-Z]/, 'Password must include an uppercase letter')
  .regex(/[0-9]/, 'Password must include a number');

export const haitiPhoneSchema = z.string().transform((value) => value.replace(/[\s()-]/g, ''))
  .pipe(z.string().regex(/^\+509\d{8}$/, 'Use Haitian format +509XXXXXXXX'));

export const moneyAmountSchema = z.coerce.number().finite().positive().max(1_000_000)
  .refine((value) => Number.isInteger(value * 100), 'Amount supports at most 2 decimal places');

export const uuidSchema = z.string().uuid();
export const providerSchema = z.enum(['MONCASH', 'NATCASH']);

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export const transferInputSchema = z.object({
  recipientId: uuidSchema,
  provider: providerSchema,
  amountHtg: moneyAmountSchema,
  quoteId: uuidSchema,
  idempotencyKey: z.string().min(16).max(128)
}).strict();

export type TransferInput = z.infer<typeof transferInputSchema>;
