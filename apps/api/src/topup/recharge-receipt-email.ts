import type { MobileTopUpTransactionRecord } from './repository.js';

export interface RechargeReceiptEmailService {
  readonly configured: boolean;
  sendReceipt(input: { to: string; transaction: MobileTopUpTransactionRecord }): Promise<void>;
}

export class RechargeReceiptEmailDeliveryError extends Error {
  constructor(message = 'Recharge receipt email delivery failed') {
    super(message);
  }
}

class DisabledRechargeReceiptEmailService implements RechargeReceiptEmailService {
  readonly configured = false;
  async sendReceipt(): Promise<void> {
    throw new RechargeReceiptEmailDeliveryError('Recharge receipt email delivery is not configured');
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function money(value: number | undefined, currency = 'USD') {
  return value === undefined ? 'Not confirmed' : `${value.toFixed(2)} ${currency}`;
}

export class ResendRechargeReceiptEmailService implements RechargeReceiptEmailService {
  readonly configured = true;
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  async sendReceipt(input: { to: string; transaction: MobileTopUpTransactionRecord }): Promise<void> {
    const t = input.transaction;
    if (t.status !== 'DELIVERED' || !t.deliveredAt) {
      throw new RechargeReceiptEmailDeliveryError('Only delivered recharges can produce receipts');
    }
    const subject = `FlupFlap recharge receipt - ${t.id.slice(0, 8).toUpperCase()}`;
    const lines = [
      'FlupFlap Recharge Receipt',
      `Reference: ${t.id}`,
      `Status: Delivered`,
      `Phone: ${t.recipientPhone}`,
      `Operator: ${t.operatorName}`,
      `Product: ${t.productName}`,
      `Recharge amount: ${money(t.providerAmount, t.providerCurrency)}`,
      `Receiver value: ${money(t.deliveredValue, t.deliveredCurrency)}`,
      `FlupFlap fee: ${money(t.feeUsd)}`,
      `Total paid: ${money(t.totalChargeUsd)}`,
      `Delivered: ${t.deliveredAt}`,
      '',
      'Thank you for using FlupFlap.',
    ];
    const htmlRows = [
      ['Reference', t.id],
      ['Status', 'Delivered'],
      ['Phone', t.recipientPhone],
      ['Operator', t.operatorName],
      ['Product', t.productName],
      ['Recharge amount', money(t.providerAmount, t.providerCurrency)],
      ['Receiver value', money(t.deliveredValue, t.deliveredCurrency)],
      ['FlupFlap fee', money(t.feeUsd)],
      ['Total paid', money(t.totalChargeUsd)],
      ['Delivered', t.deliveredAt],
    ].map(([label, value]) => `<tr><td style="padding:6px 12px 6px 0;color:#5b6472">${escapeHtml(label!)}</td><td style="padding:6px 0;font-weight:600">${escapeHtml(value!)}</td></tr>`).join('');
    const response = await this.transport('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + this.apiKey,
        'Content-Type': 'application/json',
        'Idempotency-Key': `flupflap-receipt-${t.id}`,
      },
      body: JSON.stringify({
        from: this.from,
        to: input.to,
        subject,
        text: lines.join('\n'),
        html: `<div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033"><h1 style="color:#1677ff">FlupFlap</h1><h2>Recharge receipt</h2><table style="border-collapse:collapse;width:100%">${htmlRows}</table><p style="margin-top:24px">Thank you for using FlupFlap.</p></div>`,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new RechargeReceiptEmailDeliveryError();
  }
}

export function loadRechargeReceiptEmailService(
  environment: NodeJS.ProcessEnv = process.env,
): RechargeReceiptEmailService {
  const provider = (environment.FLUPFLAP_RECEIPT_EMAIL_PROVIDER ?? environment.PASSWORD_RESET_EMAIL_PROVIDER ?? '').trim().toLowerCase();
  if (!provider) return new DisabledRechargeReceiptEmailService();
  if (provider !== 'resend') throw new Error('FLUPFLAP_RECEIPT_EMAIL_PROVIDER must be blank or "resend"');
  const apiKey = environment.RESEND_API_KEY?.trim();
  const from = (environment.FLUPFLAP_RECEIPT_EMAIL_FROM ?? environment.PASSWORD_RESET_EMAIL_FROM)?.trim();
  if (!apiKey || !from) return new DisabledRechargeReceiptEmailService();
  return new ResendRechargeReceiptEmailService(apiKey, from);
}
