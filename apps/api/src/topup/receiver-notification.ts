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
    en: `TiCash: Your recharge of ${value} was successful. Thank you for using TiCash.`,
    ht: `TiCash: Ou resevwa yon rechaj ${value} sou nimewo ou. Tranzaksyon an reyisi. Mèsi paske w itilize TiCash.`,
    es: `TiCash: Has recibido una recarga de ${value}. La transacción fue exitosa. Gracias por usar TiCash.`,
    pt: `TiCash: Você recebeu uma recarga de ${value}. A transação foi concluída com sucesso. Obrigado por usar o TiCash.`,
    fr: `TiCash : Votre recharge de ${value} a réussi. Merci d'utiliser TiCash.`,
    sw: `TiCash: Umepokea salio la ${value}. Muamala umefanikiwa. Asante kwa kutumia TiCash.`,
  };
  return messages[record.language as ReceiverLanguage] ?? messages.en;
}

export interface ReceiverSmsProvider {
  // An adapter MUST implement provider-side deduplication with this stable key.
  // Unknown acceptance is not retried automatically, even if the adapter times out.
  send(input: { to: string; message: string; idempotencyKey: string }): Promise<
    { status: 'SENT' | 'DELIVERED'; messageId: string } |
    { status: 'NOT_SENT'; category: 'SMS_NOT_CONFIGURED' | 'PROVIDER_REJECTED' }
  >;
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
