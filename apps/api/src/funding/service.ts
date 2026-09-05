import { createHash, randomUUID } from 'node:crypto';
import type {
  DwollaCustomerInput,
  DwollaFundingProvider,
  DwollaFundingSourceInput,
  DwollaWebhookEnvelope,
  FundingConfig,
  FundingStatus,
} from './types.js';
import { FundingError, mapDwollaTransferStatus } from './types.js';
import type { FundingRepository, FundingTransactionRecord } from './repository.js';

export interface PublicFundingSource {
  id: string;
  name: string;
  lastFour: string;
  bankAccountType: string;
  status: string;
}

export interface PublicFundingTransaction {
  id: string;
  amount: number;
  currency: 'USD';
  status: FundingStatus;
  failureCode?: string;
  createdAt: string;
  updatedAt: string;
  transferId?: string;
}

function publicSource(source: {
  id: string; name: string; lastFour: string; bankAccountType: string; status: string;
}): PublicFundingSource {
  return {
    id: source.id,
    name: source.name,
    lastFour: source.lastFour,
    bankAccountType: source.bankAccountType,
    status: source.status,
  };
}

function publicTransaction(record: FundingTransactionRecord): PublicFundingTransaction {
  return {
    id: record.id,
    amount: record.amount,
    currency: record.currency,
    status: record.status,
    failureCode: record.failureCode,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    transferId: record.transferId,
  };
}

function providerIdFromUrl(url: string): string {
  const id = new URL(url).pathname.split('/').filter(Boolean).at(-1);
  if (!id) throw new FundingError('INVALID_WEBHOOK_RESOURCE', 'Webhook resource URL is invalid', 400);
  return id;
}

function isTransferLifecycleTopic(topic: string): boolean {
  return /^(?:(?:customer_)?bank_|customer_)?transfer_(?:created|cancelled|failed|completed)$/.test(topic);
}

export class FundingService {
  constructor(
    readonly config: FundingConfig,
    private readonly repository: FundingRepository,
    private readonly provider?: DwollaFundingProvider,
    private readonly audit: (
      userId: string | undefined,
      action: string,
      entity: string,
      entityId?: string,
    ) => Promise<void> = async () => undefined,
    private readonly onStatusChanged: (record: FundingTransactionRecord) => Promise<void> = async () => undefined,
  ) {}

  private requireProvider(): DwollaFundingProvider {
    if (!this.config.enabled) {
      throw new FundingError('FUNDING_DISABLED', 'Dwolla sandbox funding is disabled', 503);
    }
    if (!this.provider) {
      throw new FundingError('FUNDING_CONFIGURATION_ERROR', 'Dwolla provider is unavailable', 503);
    }
    return this.provider;
  }

  availability() {
    return {
      provider: 'dwolla',
      enabled: this.config.enabled,
      environment: this.config.environment,
      productionEnabled: this.config.environment === 'production' &&
        this.config.productionEnabled && this.config.liveFundingEnabled && this.config.approvedForLiveUse,
      destinationMarket: 'HT',
      receivingCurrency: 'HTG',
      liveMoneyEnabled: false,
    };
  }

  async createCustomer(userId: string, input: DwollaCustomerInput) {
    const provider = this.requireProvider();
    const existing = await this.repository.getCustomer(userId);
    if (existing) return { customer: existing, created: false };
    const customer = await provider.createCustomer(input);
    const saved = await this.repository.saveCustomer({
      userId,
      providerCustomerId: customer.id,
      providerCustomerUrl: customer.url,
      status: customer.status,
    });
    await this.audit(userId, 'DWOLLA_CUSTOMER_CREATED', 'FundingProviderCustomer', saved.id);
    return { customer: saved, created: true };
  }

  async listFundingSources(userId: string) {
    this.requireProvider();
    return (await this.repository.listSources(userId)).map(publicSource);
  }

  async createFundingSource(
    userId: string,
    input: Omit<DwollaFundingSourceInput, 'customerUrl'>,
  ) {
    const provider = this.requireProvider();
    const customer = await this.repository.getCustomer(userId);
    if (!customer) {
      throw new FundingError('DWOLLA_CUSTOMER_REQUIRED', 'Create a Dwolla customer before adding a bank account', 409);
    }
    const source = await provider.createFundingSource({ ...input, customerUrl: customer.providerCustomerUrl });
    const saved = await this.repository.saveSource({
      userId,
      providerCustomerId: customer.providerCustomerId,
      providerFundingSourceId: source.id,
      providerFundingSourceUrl: source.url,
      name: source.name,
      lastFour: input.accountNumber.slice(-4),
      bankAccountType: source.bankAccountType,
      status: source.status,
    });
    await this.audit(userId, 'DWOLLA_FUNDING_SOURCE_CREATED', 'FundingSource', saved.id);
    return publicSource(saved);
  }

  async initiateMicroDeposits(userId: string, fundingSourceId: string) {
    const provider = this.requireProvider();
    const source = await this.repository.getSource(userId, fundingSourceId);
    if (!source) throw new FundingError('FUNDING_SOURCE_NOT_FOUND', 'Funding source was not found', 404);
    await provider.initiateMicroDeposits(source.providerFundingSourceUrl);
    await this.audit(userId, 'DWOLLA_MICRO_DEPOSITS_INITIATED', 'FundingSource', source.id);
  }

  async verifyMicroDeposits(
    userId: string,
    fundingSourceId: string,
    amount1: string,
    amount2: string,
  ) {
    const provider = this.requireProvider();
    const source = await this.repository.getSource(userId, fundingSourceId);
    if (!source) throw new FundingError('FUNDING_SOURCE_NOT_FOUND', 'Funding source was not found', 404);
    const providerSource = await provider.verifyMicroDeposits(
      source.providerFundingSourceUrl,
      amount1,
      amount2,
    );
    if (providerSource.status !== 'VERIFIED') {
      throw new FundingError(
        'FUNDING_SOURCE_VERIFICATION_PENDING',
        'Dwolla has not confirmed this bank account as verified',
        409,
      );
    }
    const verified = await this.repository.updateSourceStatus(source.id, providerSource.status);
    await this.audit(userId, 'DWOLLA_FUNDING_SOURCE_VERIFIED', 'FundingSource', source.id);
    return publicSource(verified);
  }

  async initiateFunding(
    userId: string,
    fundingSourceId: string,
    amount: number,
    idempotencyKey: string,
    transferId?: string,
  ) {
    const provider = this.requireProvider();
    if (!this.config.masterFundingSourceUrl) {
      throw new FundingError(
        'DESTINATION_FUNDING_SOURCE_UNAVAILABLE',
        'The TiCash Dwolla destination funding source is not configured',
        503,
      );
    }
    const source = await this.repository.getSource(userId, fundingSourceId);
    if (!source) throw new FundingError('FUNDING_SOURCE_NOT_FOUND', 'Funding source was not found', 404);
    if (source.status !== 'VERIFIED') {
      throw new FundingError('FUNDING_SOURCE_UNVERIFIED', 'The bank account must be verified before funding', 409);
    }
    const requestHash = createHash('sha256')
      .update(JSON.stringify({ fundingSourceId, amount: amount.toFixed(2), currency: 'USD', transferId }))
      .digest('hex');
    const reservation = await this.repository.reserveTransaction({
      id: randomUUID(), userId, fundingSourceId, amount, idempotencyKey, requestHash, transferId,
    });
    if (!reservation.created) {
      if (reservation.record.requestHash !== requestHash) {
        throw new FundingError(
          'IDEMPOTENCY_CONFLICT',
          'The idempotency key was already used for another funding request',
          409,
        );
      }
      await this.onStatusChanged(reservation.record);
      return { transaction: publicTransaction(reservation.record), idempotentReplay: true };
    }
    let providerTransferAttached = false;
    try {
      const transfer = await provider.initiateTransfer({
        sourceUrl: source.providerFundingSourceUrl,
        destinationUrl: this.config.masterFundingSourceUrl,
        amount: amount.toFixed(2),
        currency: 'USD',
        correlationId: reservation.record.id,
        idempotencyKey: `${userId}:${idempotencyKey}`,
      });
      const saved = await this.repository.attachProviderTransfer(
        reservation.record.id,
        transfer.id,
        transfer.url,
        mapDwollaTransferStatus(transfer.status),
      );
      providerTransferAttached = true;
      await this.onStatusChanged(saved);
      await this.audit(userId, 'DWOLLA_FUNDING_REQUESTED', 'FundingTransaction', saved.id);
      return { transaction: publicTransaction(saved), idempotentReplay: false };
    } catch (error) {
      if (providerTransferAttached) throw error;
      const failureCode = error instanceof FundingError ? error.code : 'DWOLLA_REQUEST_FAILED';
      const failed = await this.repository.applyProviderStatus(reservation.record.id, 'FAILED', failureCode);
      await this.onStatusChanged(failed);
      throw error;
    }
  }

  async getFunding(userId: string, id: string, refresh = false) {
    const provider = this.requireProvider();
    let transaction = await this.repository.getTransaction(userId, id);
    if (!transaction) throw new FundingError('FUNDING_NOT_FOUND', 'Funding transaction was not found', 404);
    if (refresh && transaction.providerTransferUrl) {
      const remote = await provider.getTransfer(transaction.providerTransferUrl);
      transaction = await this.repository.applyProviderStatus(
        transaction.id,
        mapDwollaTransferStatus(remote.status),
        remote.failureCode,
      );
      await this.onStatusChanged(transaction);
    }
    return publicTransaction(transaction);
  }

  async cancelFunding(userId: string, id: string) {
    const provider = this.requireProvider();
    const transaction = await this.repository.getTransaction(userId, id);
    if (!transaction?.providerTransferUrl) {
      throw new FundingError('FUNDING_NOT_FOUND', 'Cancelable funding transaction was not found', 404);
    }
    const remote = await provider.cancelTransfer(transaction.providerTransferUrl);
    const cancelled = await this.repository.applyProviderStatus(
      transaction.id,
      mapDwollaTransferStatus(remote.status),
      remote.failureCode,
    );
    await this.onStatusChanged(cancelled);
    await this.audit(userId, 'DWOLLA_FUNDING_CANCELLED', 'FundingTransaction', transaction.id);
    return publicTransaction(cancelled);
  }

  async processWebhook(envelope: DwollaWebhookEnvelope, payloadHash: string) {
    const provider = this.requireProvider();
    const reservation = await this.repository.reserveWebhook(envelope.id, envelope.topic, payloadHash);
    if (reservation.duplicate) return { duplicate: true };
    try {
      if (!isTransferLifecycleTopic(envelope.topic) || !envelope.resourceUrl) {
        await this.repository.completeWebhook(reservation.eventId);
        return { duplicate: false, ignored: true };
      }
      const remote = await provider.getTransfer(envelope.resourceUrl);
      const local = await this.repository.getTransactionByProviderId(remote.id || providerIdFromUrl(envelope.resourceUrl));
      if (!local) {
        await this.repository.completeWebhook(reservation.eventId);
        return { duplicate: false, ignored: true };
      }
      const updated = await this.repository.applyProviderStatus(
        local.id,
        mapDwollaTransferStatus(remote.status),
        remote.failureCode,
      );
      await this.onStatusChanged(updated);
      await this.audit(local.userId, `DWOLLA_FUNDING_${mapDwollaTransferStatus(remote.status)}`, 'FundingTransaction', local.id);
      await this.repository.completeWebhook(reservation.eventId);
      return { duplicate: false, ignored: false };
    } catch (error) {
      await this.repository.failWebhook(
        reservation.eventId,
        error instanceof FundingError ? error.code : 'WEBHOOK_PROCESSING_FAILED',
      );
      throw error;
    }
  }

  async walletBalance(userId: string) {
    this.requireProvider();
    return { currency: 'USD' as const, available: await this.repository.walletBalance(userId) };
  }
}
