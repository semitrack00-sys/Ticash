export type MobileTopUpEnvironment = 'sandbox';
export type MobileTopUpKind = 'AIRTIME' | 'DATA';
export type MobileTopUpStatus = 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'REFUNDED';
export type MobileTopUpPaymentStatus = 'PENDING' | 'AUTHORIZED' | 'FAILED' | 'REFUNDED';

export interface MobileTopUpConfig {
  enabled: boolean;
  environment: MobileTopUpEnvironment;
  clientId?: string;
  clientSecret?: string;
  authUrl: string;
  airtimeBaseUrl: string;
  senderPhoneCountry?: string;
  senderPhoneNumber?: string;
  billingCurrency: 'USD';
  feeUsd: string;
  quoteTtlSeconds: number;
  paymentMode: 'mock';
  productionEnabled: false;
  approvedForLiveUse: false;
}

export interface MobileTopUpCountry {
  code: string;
  name: string;
}

export interface MobileTopUpOperator {
  id: number;
  name: string;
  countryCode: string;
  status: boolean;
  bundle: boolean;
  denominationType: 'FIXED' | 'RANGE';
  senderCurrencyCode: string;
  destinationCurrencyCode: string;
  fixedAmounts: number[];
  localFixedAmounts: number[];
  fixedAmountsPlanNames: Record<string, string>;
  localFixedAmountsPlanNames: Record<string, string>;
  minAmount?: number;
  maxAmount?: number;
}

export interface MobileTopUpProduct {
  id: string;
  countryCode: string;
  operatorId: number;
  kind: MobileTopUpKind;
  name: string;
  price: number;
  priceCurrency: string;
  deliveredValue?: number;
  deliveredCurrency: string;
  amountType: 'FIXED' | 'RANGE';
  minimumAmount?: number;
  maximumAmount?: number;
}

export interface ProviderTopUpRequest {
  operatorId: number;
  amount: number;
  recipientPhone: string;
  recipientCountryCode: string;
  customIdentifier: string;
}

export interface ProviderTopUpResult {
  transactionId: string;
  status: string;
  operatorTransactionId?: string;
  requestedAmount: number;
  requestedAmountCurrencyCode: string;
  deliveredAmount?: number;
  deliveredAmountCurrencyCode?: string;
  fee?: number;
}

export interface MobileTopUpProvider {
  listCountries(): Promise<MobileTopUpCountry[]>;
  listOperators(countryCode: string): Promise<MobileTopUpOperator[]>;
  detectOperator(phone: string, countryCode: string): Promise<MobileTopUpOperator>;
  getOperator(operatorId: number): Promise<MobileTopUpOperator>;
  submitTopUp(input: ProviderTopUpRequest): Promise<ProviderTopUpResult>;
  getTopUpStatus(transactionId: string): Promise<ProviderTopUpResult>;
}

export interface MobileTopUpPaymentAuthorization {
  authorizationId: string;
  status: MobileTopUpPaymentStatus;
  testMode: true;
}

export interface MobileTopUpPaymentProvider {
  authorize(input: {
    userId: string;
    transactionId: string;
    amount: number;
    currency: 'USD';
    idempotencyKey: string;
  }): Promise<MobileTopUpPaymentAuthorization>;
}

export class MockMobileTopUpPaymentProvider implements MobileTopUpPaymentProvider {
  async authorize(input: {
    userId: string;
    transactionId: string;
    amount: number;
    currency: 'USD';
    idempotencyKey: string;
  }): Promise<MobileTopUpPaymentAuthorization> {
    return {
      authorizationId: `mock-topup-payment:${input.transactionId}`,
      status: 'AUTHORIZED',
      testMode: true,
    };
  }
}

export class MobileTopUpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
