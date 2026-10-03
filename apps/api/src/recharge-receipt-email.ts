import type { MobileTopUpTransactionRecord } from './topup/repository.js';

export interface RechargeReceiptEmailService {
  readonly configured: boolean;
  sendReceipt(input: { to: string; transaction: MobileTopUpTransactionRecord }): Promise<void>;
}

class DisabledRechargeReceiptEmailService implements RechargeReceiptEmailService {
  readonly configured = false;
  async sendReceipt(): Promise<void> {}
}

function esc(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

class ResendRechargeReceiptEmailService implements RechargeReceiptEmailService {
  readonly configured = true;
  constructor(private readonly apiKey: string, private readonly from: string) {}

  async sendReceipt(input: { to: string; transaction: MobileTopUpTransactionRecord }): Promise<void> {
    const t = input.transaction;
    const delivered = t.receiverValueConfirmed && t.deliveredValue !== undefined
      ? `${Number(t.deliveredValue).toFixed(2)} ${t.deliveredCurrency}`
      : 'Confirmed by the mobile operator';
    const reference = t.id;
    const text = [
      'FlupFlap recharge receipt',
      `Status: Delivered`,
      `Reference: ${reference}`,
      `Phone: ${t.recipientPhone}`,
      `Operator: ${t.operatorName}`,
      `Recharge amount: ${Number(t.providerAmount).toFixed(2)} ${t.providerCurrency}`,
      `Receiver value: ${delivered}`,
      `FlupFlap fee: ${Number(t.feeUsd).toFixed(2)} USD`,
      `Total: ${Number(t.totalChargeUsd).toFixed(2)} USD`,
      t.deliveredAt ? `Delivered: ${new Date(t.deliveredAt).toISOString()}` : '',
      'Thank you for using FlupFlap.',
    ].filter(Boolean).join('\n');
    const html = [
      '<h2>FlupFlap recharge receipt</h2>',
      '<p><strong>Status:</strong> Delivered</p>',
      `<p><strong>Reference:</strong> ${esc(reference)}</p>`,
      `<p><strong>Phone:</strong> ${esc(t.recipientPhone)}</p>`,
      `<p><strong>Operator:</strong> ${esc(t.operatorName)}</p>`,
      `<p><strong>Recharge amount:</strong> ${Number(t.providerAmount).toFixed(2)} ${esc(t.providerCurrency)}</p>`,
      `<p><strong>Receiver value:</strong> ${esc(delivered)}</p>`,
      `<p><strong>FlupFlap fee:</strong> ${Number(t.feeUsd).toFixed(2)} USD</p>`,
      `<p><strong>Total:</strong> ${Number(t.totalChargeUsd).toFixed(2)} USD</p>`,
      t.deliveredAt ? `<p><strong>Delivered:</strong> ${esc(new Date(t.deliveredAt).toISOString())}</p>` : '',
      '<p>Thank you for using FlupFlap.</p>',
    ].join('');
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + this.apiKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': `flupflap-recharge-receipt/${t.id}`,
      },
      body: JSON.stringify({
        from: this.from,
        to: input.to,
        subject: `FlupFlap receipt - ${Number(t.providerAmount).toFixed(2)} ${t.providerCurrency}`,
        text,
        html,
      }),
    });
    if (!response.ok) throw new Error('Recharge receipt email delivery failed');
  }
}

export function loadRechargeReceiptEmailService(
  environment: NodeJS.ProcessEnv = process.env,
): RechargeReceiptEmailService {
  const provider = (environment.RECHARGE_RECEIPT_EMAIL_PROVIDER ?? environment.PASSWORD_RESET_EMAIL_PROVIDER ?? '').trim().toLowerCase();
  if (!provider) return new DisabledRechargeReceiptEmailService();
  if (provider !== 'resend') throw new Error('RECHARGE_RECEIPT_EMAIL_PROVIDER must be blank or "resend"');
  const apiKey = environment.RESEND_API_KEY?.trim();
  const from = (environment.RECHARGE_RECEIPT_EMAIL_FROM ?? environment.PASSWORD_RESET_EMAIL_FROM ?? '').trim();
  if (!apiKey || !from) return new DisabledRechargeReceiptEmailService();
  return new ResendRechargeReceiptEmailService(apiKey, from);
}
