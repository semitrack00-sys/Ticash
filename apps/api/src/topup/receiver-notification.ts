import { validReceiverValue } from './receiver-value.js';
import type { MobileTopUpTransactionRecord } from './repository.js';

export const receiverLanguages = ['en', 'ht', 'es', 'pt', 'fr', 'sw'] as const;
export type ReceiverLanguage = typeof receiverLanguages[number];
const defaults: Readonly<Record<string, ReceiverLanguage>> = {
  HT: 'ht', DO: 'es', MX: 'es', BR: 'pt', JM: 'en', US: 'en', FR: 'fr',
  SN: 'fr', CI: 'fr', NG: 'en', GH: 'en', KE: 'en', TZ: 'en', CA: 'en',
};
export function receiverLanguage(country: string, preference?: string, operatorPreference?: string): ReceiverLanguage {
  const supported = (value?: string): value is ReceiverLanguage => receiverLanguages.includes(value as ReceiverLanguage);
  return supported(preference) ? preference : supported(operatorPreference) ? operatorPreference : defaults[country] ?? 'en';
}

export interface ReceiverNotification {
  transactionId: string;
  phone: string;
  country: string;
  language: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'SENT' | 'DELIVERED' | 'FAILED';
  providerMessageId?: string;
  attempts: number;
  lastErrorCategory?: string;
  claimedAt?: string;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  deliveredAt?: string;
}

export function notificationFor(record: MobileTopUpTransactionRecord): ReceiverNotification | undefined {
  if (record.status !== 'DELIVERED' || !record.receiverValueConfirmed || !record.providerTransactionId || !record.deliveredAt ||
      !validReceiverValue(record.deliveredValue, record.deliveredCurrency)) return undefined;
  return { transactionId: record.id, phone: record.recipientPhone, country: record.countryCode,
    language: receiverLanguage(record.countryCode, record.receiverLanguage), amount: record.deliveredValue,
    currency: record.deliveredCurrency, status: 'PENDING', attempts: 0,
    lastErrorCategory: 'SMS_NOT_CONFIGURED', createdAt: record.deliveredAt, updatedAt: record.deliveredAt };
}

export function receiverMessage(record: Pick<ReceiverNotification, 'language' | 'amount' | 'currency'>): string {
  if (!validReceiverValue(record.amount, record.currency)) throw new Error('Invalid notification amount');
  const value = `${record.amount} ${record.currency}`;
  const messages: Record<ReceiverLanguage, string> = {
    en: `FlupFlap: Your recharge of ${value} was successful. Thank you for using FlupFlap.`,
    ht: `FlupFlap: Ou resevwa yon rechaj ${value} sou nimewo ou. Tranzaksyon an reyisi. Mèsi paske w itilize FlupFlap.`,
    es: `FlupFlap: Has recibido una recarga de ${value}. La transacción fue exitosa. Gracias por usar FlupFlap.`,
    pt: `FlupFlap: Você recebeu uma recarga de ${value}. A transação foi concluída com sucesso. Obrigado por usar o FlupFlap.`,
    fr: `FlupFlap : Votre recharge de ${value} a réussi. Merci d'utiliser FlupFlap.`,
    sw: `FlupFlap: Umepokea salio la ${value}. Muamala umefanikiwa. Asante kwa kutumia FlupFlap.`,
  };
  return messages[record.language as ReceiverLanguage] ?? messages.en;
}

export interface ReceiverSmsProvider {
  // Unknown acceptance is never retried automatically. Some SMS providers, including
  // Telnyx POST /messages, do not provide server-side idempotency for SMS sends.
  // The durable outbox claim therefore provides the exactly-once attempt boundary.
  send(input: { to: string; message: string; idempotencyKey: string }): Promise<
    { status: 'SENT' | 'DELIVERED'; messageId: string } |
    { status: 'NOT_SENT'; category: 'SMS_NOT_CONFIGURED' | 'PROVIDER_REJECTED' }
  >;
}

export interface TelnyxSmsConfig {
  apiKey: string;
  fromNumber: string;
  messagingProfileId: string;
  baseUrl: string;
}

export function loadTelnyxSmsConfig(env: NodeJS.ProcessEnv = process.env): TelnyxSmsConfig | undefined {
  const apiKey = env.TELNYX_API_KEY?.trim();
  const fromNumber = env.TELNYX_FROM_NUMBER?.trim();
  const messagingProfileId = env.TELNYX_MESSAGING_PROFILE_ID?.trim();
  if (!apiKey && !fromNumber && !messagingProfileId) return undefined;
  if (!apiKey || !fromNumber || !messagingProfileId) throw new Error('TELNYX_API_KEY, TELNYX_FROM_NUMBER and TELNYX_MESSAGING_PROFILE_ID must be configured together');
  if (!/^\+[1-9]\d{7,14}$/.test(fromNumber)) throw new Error('TELNYX_FROM_NUMBER must be E.164');
  if (!/^[0-9a-f-]{36}$/i.test(messagingProfileId)) throw new Error('TELNYX_MESSAGING_PROFILE_ID must be a UUID');
  return { apiKey, fromNumber, messagingProfileId, baseUrl: 'https://api.telnyx.com/v2' };
}

export class TelnyxReceiverSmsProvider implements ReceiverSmsProvider {
  constructor(private readonly config: TelnyxSmsConfig, private readonly transport: typeof fetch = fetch) {}

  async send(input: { to: string; message: string; idempotencyKey: string }): Promise<
    { status: 'SENT'; messageId: string } | { status: 'NOT_SENT'; category: 'PROVIDER_REJECTED' }
  > {
    if (!/^\+[1-9]\d{7,14}$/.test(input.to)) return { status: 'NOT_SENT', category: 'PROVIDER_REJECTED' };
    // Deliberately one HTTP attempt: Telnyx SMS sends have no server-side idempotency.
    // A network/timeout exception is allowed to escape so the outbox records an
    // ambiguous outcome and never blindly resends the SMS.
    const response = await this.transport(`${this.config.baseUrl}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: this.config.fromNumber,
        to: input.to,
        text: input.message,
        messaging_profile_id: this.config.messagingProfileId,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return { status: 'NOT_SENT', category: 'PROVIDER_REJECTED' };
    const body = await response.json() as { data?: { id?: unknown } };
    const messageId = body.data?.id;
    if (typeof messageId !== 'string' || messageId.length < 1 || messageId.length > 200) throw new Error('Invalid Telnyx acceptance response');
    return { status: 'SENT', messageId };
  }
}

export class DisabledReceiverSmsProvider implements ReceiverSmsProvider {
  async send(): Promise<{ status: 'NOT_SENT'; category: 'SMS_NOT_CONFIGURED' }> {
    return { status: 'NOT_SENT', category: 'SMS_NOT_CONFIGURED' };
  }
}
export interface ReceiverNotificationStore {
  listRetryableNotificationIds(limit: number): Promise<string[]>;
  getNotification(id: string): Promise<ReceiverNotification | undefined>;
  claimNotification(id: string, when: string): Promise<boolean>;
  finishNotification(id: string, update: Partial<Pick<ReceiverNotification,
    'status' | 'providerMessageId' | 'lastErrorCategory' | 'sentAt' | 'deliveredAt'>>): Promise<void>;
}
export class ReceiverNotificationService {
  constructor(private readonly store: ReceiverNotificationStore,
    private readonly provider: ReceiverSmsProvider = new DisabledReceiverSmsProvider()) {}

  // Invoke from a separately supervised server worker; no money/provider purchase APIs are available here.
  async processBatch(limit = 50) {
    const ids = await this.store.listRetryableNotificationIds(Math.max(1, Math.min(100, Math.trunc(limit) || 50)));
    for (const id of ids) await this.retry(id);
    return ids.length;
  }

  async retry(id: string) {
    if (!await this.store.claimNotification(id, new Date().toISOString())) return this.store.getNotification(id);
    const record = (await this.store.getNotification(id))!;
    try {
      const result = await this.provider.send({ to: record.phone, message: receiverMessage(record),
        idempotencyKey: `recharge-receiver:${id}` });
      if (result.status === 'NOT_SENT') {
        await this.store.finishNotification(id, { status: 'FAILED', lastErrorCategory: result.category });
      } else if (typeof result.messageId === 'string' && result.messageId.length > 0 && result.messageId.length <= 200) {
        const when = new Date().toISOString();
        await this.store.finishNotification(id, { status: result.status, providerMessageId: result.messageId,
          lastErrorCategory: undefined, sentAt: when, ...(result.status === 'DELIVERED' ? { deliveredAt: when } : {}) });
      } else {
        await this.store.finishNotification(id, { status: 'FAILED', lastErrorCategory: 'SMS_OUTCOME_UNKNOWN' });
      }
    } catch {
      // Never retain provider exceptions (they may contain credentials or phone numbers).
      // A crash/timeout after acceptance must not allow another send.
      await this.store.finishNotification(id, { status: 'FAILED', lastErrorCategory: 'SMS_OUTCOME_UNKNOWN' });
    }
    return this.store.getNotification(id);
  }
}

export function retryableNotification(n: ReceiverNotification): boolean {
  return n.status === 'PENDING' && !n.claimedAt || n.status === 'FAILED' &&
    ['SMS_NOT_CONFIGURED', 'PROVIDER_REJECTED'].includes(n.lastErrorCategory ?? '');
}
