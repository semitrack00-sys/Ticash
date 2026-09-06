export type DwollaEnvironment = 'sandbox' | 'production';

export type FundingStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REVERSED';

export type FundingSourceStatus = 'UNVERIFIED' | 'VERIFIED' | 'FAILED' | 'REMOVED';

export interface FundingConfig {
  enabled: boolean;
  environment: DwollaEnvironment;
  clientId?: string;
  clientSecret?: string;
  webhookSecret?: string;
  masterFundingSourceUrl?: string;
  productionEnabled: boolean;
  liveFundingEnabled: boolean;
  approvedForLiveUse: boolean;
}

export interface DwollaCustomerInput {
  firstName: string;
  lastName: string;
  email: string;
}

export interface DwollaCustomer {
  id: string;
  url: string;
  status: string;
}

export interface DwollaFundingSourceInput {
  customerUrl: string;
  routingNumber: string;
  accountNumber: string;
  bankAccountType: 'checking' | 'savings';
  name: string;
}

export interface DwollaFundingSource {
  id: string;
  url: string;
  name: string;
  bankName?: string;
  bankAccountType: string;
  status: FundingSourceStatus;
}

export interface DwollaTransfer {
  id: string;
  url: string;
  status: string;
  failureCode?: string;
}

export interface DwollaWebhookEnvelope {
  id: string;
  topic: string;
  resourceUrl?: string;
}

export interface DwollaFundingProvider {
  createCustomer(input: DwollaCustomerInput): Promise<DwollaCustomer>;
  getCustomer(customerUrl: string): Promise<DwollaCustomer>;
  createFundingSource(input: DwollaFundingSourceInput): Promise<DwollaFundingSource>;
  listFundingSources(customerUrl: string): Promise<DwollaFundingSource[]>;
  getFundingSource(fundingSourceUrl: string): Promise<DwollaFundingSource>;
  removeFundingSource(fundingSourceUrl: string): Promise<DwollaFundingSource>;
  initiateMicroDeposits(fundingSourceUrl: string): Promise<void>;
  verifyMicroDeposits(
    fundingSourceUrl: string,
    amount1: string,
    amount2: string,
  ): Promise<DwollaFundingSource>;
  initiateTransfer(input: {
    sourceUrl: string;
    destinationUrl: string;
    amount: string;
    currency: 'USD';
    correlationId: string;
    idempotencyKey: string;
  }): Promise<DwollaTransfer>;
  getTransfer(transferUrl: string): Promise<DwollaTransfer>;
  cancelTransfer(transferUrl: string): Promise<DwollaTransfer>;
}

export class FundingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
    this.name = 'FundingError';
  }
}

export function mapDwollaTransferStatus(status: string): FundingStatus {
  switch (status.toLowerCase()) {
    case 'pending':
      return 'PROCESSING';
    case 'processed':
      return 'COMPLETED';
    case 'failed':
      return 'FAILED';
    case 'cancelled':
      return 'CANCELLED';
    default:
      throw new FundingError('UNKNOWN_PROVIDER_STATUS', 'Dwolla returned an unknown transfer status', 502);
  }
}
