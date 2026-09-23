export type MobileTopUpProviderName = 'RELOADLY' | 'DTONE' | 'DING';
export type MobileTopUpEnvironment = 'sandbox';
export type MobileTopUpKind = 'AIRTIME' | 'DATA';
export type MobileTopUpStatus = 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'REFUNDED';
export type MobileTopUpPaymentStatus = 'PENDING' | 'SESSION_CREATED' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'VOID_PENDING' | 'VOIDED' | 'REFUND_PENDING' | 'REFUNDED';
export type MobileTopUpPaymentMethod = 'CARD' | 'APPLE_PAY' | 'GOOGLE_PAY' | 'BANK_ACCOUNT';
export type MobileTopUpPaymentProviderName = 'MOCK' | 'CHECKOUT_COM' | 'DWOLLA';

export interface PaymentSessionInput {
  transactionId: string;
  amountMinor: number;
  currency: 'USD';
}

// Hosted sessions and server authorization are separate capabilities.
export interface MobileTopUpSessionProvider {
  createPaymentSession(input: PaymentSessionInput): Promise<Record<string, unknown>>;
}

export interface MobileTopUpPaymentQuery {
  getPayment(paymentId: string): Promise<Record<string, unknown>>;
}

export interface MobileTopUpPaymentCapture {
  capture(input: { paymentId: string; transactionId: string; amountMinor: number }): Promise<'PENDING' | 'CAPTURED'>;
}

export interface MobileTopUpPaymentRecovery {
  void?(input: { paymentId: string; transactionId: string }): Promise<'VOIDED' | 'VOID_PENDING'>;
  refund?(input: { paymentId: string; transactionId: string; amountMinor: number }): Promise<'REFUNDED' | 'REFUND_PENDING'>;
}

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

export interface MobileTopUpDestination extends MobileTopUpCountry {
  callingCode: string;
}

export interface MobileTopUpOperator {
  provider?: MobileTopUpProviderName;
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
  provider?: MobileTopUpProviderName;
  providerProductId?: string;
  classification?: 'AIRTIME' | 'DATA' | 'BUNDLE';
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
  provider?: MobileTopUpProviderName;
  productId?: string;
  providerProductId?: string;
  providerCurrency?: string;
  operatorId: number;
  amount: number;
  recipientPhone: string;
  recipientCountryCode: string;
  customIdentifier: string;
}

export interface ProviderTopUpResult {
  rawStatus?: string;
  transactionId: string;
  status: string;
  operatorTransactionId?: string;
  requestedAmount: number;
  requestedAmountCurrencyCode: string;
  deliveredAmount?: number;
  deliveredAmountCurrencyCode?: string;
  fee?: number;
}

export interface ProviderCoverage {
  environment: 'SANDBOX';
  uniqueCountries: number;
  providers: { provider: MobileTopUpProviderName; enabled: boolean; countries: number; reason?: string }[];
  overlapCountries: string[];
  reloadlyOnlyCountries: string[];
  dtoneOnlyCountries: string[];
}

export interface MobileTopUpProvider {
  readonly name?: MobileTopUpProviderName;
  readonly providerNames?: MobileTopUpProviderName[];
  coverage?(): Promise<ProviderCoverage>;
  listProducts?(countryCode: string, operatorId: number): Promise<MobileTopUpProduct[] | undefined>;
  listCountries(): Promise<MobileTopUpCountry[]>;
  listOperators(countryCode: string): Promise<MobileTopUpOperator[]>;
  detectOperator(phone: string, countryCode: string): Promise<MobileTopUpOperator>;
  getOperator(operatorId: number): Promise<MobileTopUpOperator>;
  submitTopUp(input: ProviderTopUpRequest): Promise<ProviderTopUpResult>;
  getTopUpStatus(transactionId: string, provider?: MobileTopUpProviderName): Promise<ProviderTopUpResult>;
}

export interface MobileTopUpPaymentAuthorization {
  authorizationId: string;
  status: MobileTopUpPaymentStatus;
  testMode: true;
}

export interface MobileTopUpPaymentProvider extends MobileTopUpPaymentRecovery {
  authorize(input: {
    userId: string;
    transactionId: string;
    amount: number;
    currency: 'USD';
    idempotencyKey: string;
  }): Promise<MobileTopUpPaymentAuthorization>;
}

export class MockMobileTopUpPaymentProvider implements MobileTopUpPaymentProvider {
  async void(): Promise<'VOIDED'> { return 'VOIDED'; }
  async refund(): Promise<'REFUNDED'> { return 'REFUNDED'; }
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
