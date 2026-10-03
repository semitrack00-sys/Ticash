import { describe, expect, it, vi } from 'vitest';
import { ResendRechargeReceiptEmailService, loadRechargeReceiptEmailService } from '../src/topup/recharge-receipt-email.js';
import type { MobileTopUpTransactionRecord } from '../src/topup/repository.js';

const transaction = {
  id: '12345678-1234-4234-8234-123456789abc',
  status: 'DELIVERED',
  deliveredAt: '2026-10-03T20:00:00.000Z',
  recipientPhone: '+50937050210',
  operatorName: 'Digicel Haiti',
  productName: 'Digicel Haiti',
  providerAmount: 5,
  providerCurrency: 'USD',
  deliveredValue: 607.30,
  deliveredCurrency: 'HTG',
  feeUsd: 0.99,
  totalChargeUsd: 5.99,
} as MobileTopUpTransactionRecord;

describe('FlupFlap recharge receipt email', () => {
  it('sends a branded delivered receipt with an idempotency key', async () => {
    const transport = vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
      new Response(JSON.stringify({ id: 'email-fixture' }), { status: 200 }));
    const service = new ResendRechargeReceiptEmailService('re_test_fixture', 'FlupFlap <receipts@example.test>', transport as typeof fetch);
    await service.sendReceipt({ to: 'sender@example.test', transaction });
    expect(transport).toHaveBeenCalledTimes(1);
    const [, init] = transport.mock.calls[0]!;
    const headers = init?.headers as Record<string, string>;
    expect(headers['Idempotency-Key']).toBe('flupflap-receipt-' + transaction.id);
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      to: 'sender@example.test',
      subject: 'FlupFlap recharge receipt - 12345678',
    });
    expect(body.text).toContain('Total paid: 5.99 USD');
    expect(body.text).toContain('Receiver value: 607.30 HTG');
  });

  it('reuses the configured Resend sender when a receipt-specific sender is absent', () => {
    expect(loadRechargeReceiptEmailService({
      PASSWORD_RESET_EMAIL_PROVIDER: 'resend',
      PASSWORD_RESET_EMAIL_FROM: 'FlupFlap <support@example.test>',
      RESEND_API_KEY: 're_test_fixture',
    } as NodeJS.ProcessEnv).configured).toBe(true);
  });

  it('refuses to email a non-delivered transaction', async () => {
    const transport = vi.fn();
    const service = new ResendRechargeReceiptEmailService('re_test_fixture', 'FlupFlap <receipts@example.test>', transport as typeof fetch);
    await expect(service.sendReceipt({ to: 'sender@example.test', transaction: { ...transaction, status: 'PROCESSING' } }))
      .rejects.toThrow('Only delivered recharges can produce receipts');
    expect(transport).not.toHaveBeenCalled();
  });
});
