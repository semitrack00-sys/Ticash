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
  bankName?: string;
  lastFour: string;
  bankAccountType: string;
  status: 'PENDING' | 'VERIFIED' | 'FAILED' | 'REMOVED';
  isDefault: boolean;
  microDepositsInitiatedAt?: string;
  verificationAttempts: number;
  createdAt: string;
  updatedAt: string;
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
  id: string; name: string; bankName?: string; lastFour: string; bankAccountType: string;
  status: string; isDefault: boolean; microDepositsInitiatedAt?: string;
  verificationAttempts: number; createdAt: string; updatedAt: string;
}): PublicFundingSource {
  return {
    id: source.id,
    name: source.name,
    bankName: source.bankName,
    lastFour: source.lastFour,
    bankAccountType: source.bankAccountType,
    status: source.status === 'UNVERIFIED' ? 'PENDING' : source.status as PublicFundingSource['status'],
    isDefault: source.isDefault,
    microDepositsInitiatedAt: source.microDepositsInitiatedAt,
    verificationAttempts: source.verificationAttempts,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
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

function fundingSourceUrlFromWebhook(url: string): string {
  const resource = new URL(url);
  const segments = resource.pathname.split('/').filter(Boolean);
  if (segments.at(-1) === 'micro-deposits') {
    segments.pop();
    resource.pathname = `/${segments.join('/')}`;
  }
  if (segments.at(-2) !== 'funding-sources' || !segments.at(-1)) {
    throw new FundingError(
      'INVALID_WEBHOOK_RESOURCE',
      'Webhook funding-source resource URL is invalid',
      400,
    );
  }
  return resource.toString();
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
    const provider = this.requireProvider();
    const customer = await this.repository.getCustomer(userId);
    if (!customer) return [];
    const localSources = await this.repository.listSources(userId);
    const remoteSources = await provider.listFundingSources(customer.providerCustomerUrl);
    for (const remote of remoteSources) {
      const local = localSources.find((item) => item.providerFundingSourceId === remote.id);
      if (!local) continue;
      await this.repository.updateSource(userId, local.id, {
        name: remote.name,
        bankName: remote.bankName,
        bankAccountType: remote.bankAccountType,
        status: local.status === 'FAILED' ? 'FAILED' : remote.status,
        removedAt: remote.status === 'REMOVED' ? new Date().toISOString() : undefined,
      });
    }
    let refreshed = await this.repository.listSources(userId);
    if (!refreshed.some((item) => item.isDefault && item.status === 'VERIFIED')) {
      const verified = refreshed.find((item) => item.status === 'VERIFIED');
      if (verified) {
        await this.repository.setDefaultSource(userId, verified.id);
        refreshed = await this.repository.listSources(userId);
      }
    }
    return refreshed.map(publicSource);
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
      bankName: source.bankName,
      lastFour: input.accountNumber.slice(-4),
      bankAccountType: source.bankAccountType,
      status: source.status,
      isDefault: false,
      microDepositsInitiatedAt: undefined,
      verificationAttempts: 0,
      verificationFailureCode: undefined,
      removedAt: undefined,
    });
    await this.audit(userId, 'DWOLLA_FUNDING_SOURCE_CREATED', 'FundingSource', saved.id);
    return publicSource(saved);
  }

  async initiateMicroDeposits(userId: string, fundingSourceId: string) {
    const provider = this.requireProvider();
    const source = await this.repository.getSource(userId, fundingSourceId);
    if (!source) throw new FundingError('FUNDING_SOURCE_NOT_FOUND', 'Funding source was not found', 404);
    if (source.status === 'VERIFIED') return { fundingSource: publicSource(source), alreadyInitiated: true };
    if (source.status === 'REMOVED' || source.status === 'FAILED') {
      throw new FundingError('FUNDING_SOURCE_NOT_VERIFIABLE', 'This bank account cannot be verified', 409);
    }
    if (source.microDepositsInitiatedAt) {
      return { fundingSource: publicSource(source), alreadyInitiated: true };
    }
    await provider.initiateMicroDeposits(source.providerFundingSourceUrl);
    const updated = await this.repository.updateSource(userId, source.id, {
      microDepositsInitiatedAt: new Date().toISOString(),
    });
    await this.audit(userId, 'DWOLLA_MICRO_DEPOSITS_INITIATED', 'FundingSource', source.id);
    return { fundingSource: publicSource(updated), alreadyInitiated: false };
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
    if (source.status === 'VERIFIED') return publicSource(source);
    if (source.status === 'REMOVED' || source.status === 'FAILED') {
      throw new FundingError('FUNDING_SOURCE_NOT_VERIFIABLE', 'This bank account cannot be verified', 409);
    }
    if (!source.microDepositsInitiatedAt) {
      throw new FundingError('MICRO_DEPOSITS_NOT_INITIATED', 'Start micro-deposit verification first', 409);
    }
    if (source.verificationAttempts >= 3) {
      throw new FundingError('MICRO_DEPOSIT_ATTEMPTS_EXCEEDED', 'Micro-deposit verification attempts are exhausted', 429);
    }
    const attempted = await this.repository.updateSource(userId, source.id, {
      verificationAttempts: source.verificationAttempts + 1,
    });
    await this.audit(userId, 'DWOLLA_MICRO_DEPOSITS_VERIFICATION_ATTEMPTED', 'FundingSource', source.id);
    let providerSource;
    try {
      providerSource = await provider.verifyMicroDeposits(
        source.providerFundingSourceUrl,
        amount1,
        amount2,
      );
    } catch (error) {
      const failedPermanently = attempted.verificationAttempts >= 3;
      if (failedPermanently) {
        await this.repository.updateSource(userId, source.id, {
          status: 'FAILED',
          verificationFailureCode: 'MAX_ATTEMPTS',
        });
      }
      await this.audit(userId, 'DWOLLA_MICRO_DEPOSITS_VERIFICATION_FAILED', 'FundingSource', source.id);
      if (failedPermanently) {
        throw new FundingError('MICRO_DEPOSIT_ATTEMPTS_EXCEEDED', 'Micro-deposit verification attempts are exhausted', 429);
      }
      throw error;
    }
    if (providerSource.status !== 'VERIFIED') {
      throw new FundingError(
        'FUNDING_SOURCE_VERIFICATION_PENDING',
        'Dwolla has not confirmed this bank account as verified',
        409,
      );
    }
    let verified = await this.repository.updateSource(userId, source.id, {
      status: providerSource.status,
      bankName: providerSource.bankName,
    });
    const existingDefault = (await this.repository.listSources(userId)).some(
      (item) => item.isDefault && item.status === 'VERIFIED',
    );
    if (!existingDefault) verified = await this.repository.setDefaultSource(userId, source.id);
    await this.audit(userId, 'DWOLLA_FUNDING_SOURCE_VERIFIED', 'FundingSource', source.id);
    return publicSource(verified);
  }

  async setDefaultFundingSource(userId: string, fundingSourceId: string) {
    this.requireProvider();
    const source = await this.repository.getSource(userId, fundingSourceId);
    if (!source) throw new FundingError('FUNDING_SOURCE_NOT_FOUND', 'Funding source was not found', 404);
    if (source.status === 'REMOVED') {
      throw new FundingError('FUNDING_SOURCE_REMOVED', 'The bank account has been removed', 409);
    }
    if (source.status !== 'VERIFIED') {
      throw new FundingError('FUNDING_SOURCE_UNVERIFIED', 'Only a verified bank account can be the default', 409);
    }
    const updated = await this.repository.setDefaultSource(userId, source.id);
    await this.audit(userId, 'DWOLLA_DEFAULT_FUNDING_SOURCE_CHANGED', 'FundingSource', source.id);
    return publicSource(updated);
  }

  async removeFundingSource(userId: string, fundingSourceId: string) {
    const provider = this.requireProvider();
    const source = await this.repository.getSource(userId, fundingSourceId);
    if (!source) throw new FundingError('FUNDING_SOURCE_NOT_FOUND', 'Funding source was not found', 404);
    if (source.status === 'REMOVED') return publicSource(source);
    if (await this.repository.hasActiveTransactions(source.id)) {
      throw new FundingError('FUNDING_SOURCE_IN_USE', 'This bank has a pending funding transaction', 409);
    }
    await provider.removeFundingSource(source.providerFundingSourceUrl);
    const removed = await this.repository.updateSource(userId, source.id, {
      status: 'REMOVED',
      isDefault: false,
      removedAt: new Date().toISOString(),
    });
    if (source.isDefault) {
      const replacement = (await this.repository.listSources(userId)).find(
        (item) => item.status === 'VERIFIED',
      );
      if (replacement) await this.repository.setDefaultSource(userId, replacement.id);
    }
    await this.audit(userId, 'DWOLLA_FUNDING_SOURCE_REMOVED', 'FundingSource', source.id);
    return publicSource(removed);
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
    if (source.status === 'REMOVED') {
      throw new FundingError('FUNDING_SOURCE_REMOVED', 'The bank account has been removed', 409);
    }
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
      if (/^customer_(?:funding_source_|microdeposits_)/.test(envelope.topic) && envelope.resourceUrl) {
        const sourceUrl = fundingSourceUrlFromWebhook(envelope.resourceUrl);
        const providerSource = await provider.getFundingSource(sourceUrl);
        const local = await this.repository.getSourceByProviderId(
          providerSource.id || providerIdFromUrl(sourceUrl),
        );
        if (local) {
          const failed = envelope.topic === 'customer_microdeposits_failed' ||
            envelope.topic === 'customer_microdeposits_maxattempts';
          const status = envelope.topic === 'customer_funding_source_removed'
            ? 'REMOVED'
            : failed ? 'FAILED' : providerSource.status;
          await this.repository.updateSource(local.userId, local.id, {
            status,
            name: providerSource.name,
            bankName: providerSource.bankName,
            bankAccountType: providerSource.bankAccountType,
            isDefault: status === 'REMOVED' || status === 'FAILED' ? false : local.isDefault,
            verificationFailureCode: failed ? envelope.topic : undefined,
            removedAt: status === 'REMOVED' ? new Date().toISOString() : undefined,
          });
          if (status === 'VERIFIED') {
            const hasDefault = (await this.repository.listSources(local.userId)).some(
              (item) => item.isDefault && item.status === 'VERIFIED',
            );
            if (!hasDefault) await this.repository.setDefaultSource(local.userId, local.id);
          }
          await this.audit(local.userId, `DWOLLA_${envelope.topic.toUpperCase()}`, 'FundingSource', local.id);
        }
        await this.repository.completeWebhook(reservation.eventId);
        return { duplicate: false, ignored: !local };
      }
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
