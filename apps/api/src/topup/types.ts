import type { ReceiverQuote } from './receiver-value.js';
export type MobileTopUpProviderName = 'RELOADLY' | 'DTONE' | 'DING';
export type MobileTopUpEnvironment = 'sandbox' | 'production';
export type MobileTopUpRuntimeEnvironment = 'SANDBOX' | 'PRODUCTION';
export type ProductClassification = 'AIRTIME' | 'DATA' | 'BUNDLE';
export type MobileTopUpKind = 'AIRTIME' | 'DATA';
export type MobileTopUpStatus = 'PENDING' | 'PROCESSING' | 'DELIVERED' | 'FAILED' | 'REFUNDED';
export type MobileTopUpPaymentStatus = 'PENDING' | 'SESSION_CREATED' | 'AUTHORIZED' | 'CAPTURED' | 'FAILED' | 'VOID_PENDING' | 'VOIDED' | 'REFUND_PENDING' | 'REFUNDED';
export type MobileTopUpPaymentMethod = 'CARD' | 'APPLE_PAY' | 'GOOGLE_PAY' | 'BANK_ACCOUNT';
export type MobileTopUpPaymentProviderName = 'MOCK' | 'STRIPE' | 'DWOLLA';

export interface PaymentSessionInput {
  transactionId: string;
  amountMinor: number;
  currency: 'USD';
}

export interface HostedCheckoutSession {
  id: string;
  url: string;
}

export interface HostedCheckoutSessionBaseContract {
  provider: 'STRIPE';
  environment: MobileTopUpRuntimeEnvironment;
  testMode: boolean;
  transactionId: string;
  checkoutSession: HostedCheckoutSession;
}

export interface HostedCheckoutSessionContract extends HostedCheckoutSessionBaseContract {
  amountMinor: number;
  currency: 'USD';
  paymentStatus: MobileTopUpPaymentStatus;
}

// Public capability response: explicit customer-facing fields, never an internal record.
export interface MobileTopUpCheckoutResumeDto {
  paymentStatus: MobileTopUpPaymentStatus;
  failureReason: 'INSUFFICIENT_FUNDS' | 'PAYMENT_DECLINED' | 'PAYMENT_CANCELLED' | 'PAYMENT_EXPIRED' | 'RECHARGE_PROVIDER_FAILED' | null;
  countryCode: string;
  receiverQuote: ReceiverQuote | null;
  deliveredValue: number | null;
  deliveredCurrency: string | null;
  receiverDiscrepancy: boolean;
  status: MobileTopUpStatus;
  testMode: boolean;
  recipientPhone: string;
  operatorName: string;
  productName: string;
  providerAmount: number;
  providerCurrency: string;
  feeUsd: number;
  totalChargeUsd: number;
}

export interface MobileTopUpSessionProvider {
  createPaymentSession(input: PaymentSessionInput & { billingCountry?: string; resumeToken: string }): Promise<HostedCheckoutSession>;
  getHostedCheckoutSession(paymentSessionId: string): Promise<HostedCheckoutSession>;
  flowContract(transactionId: string, checkoutSession: HostedCheckoutSession): HostedCheckoutSessionBaseContract;
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
  getRecoveryStatus?(input: { paymentId: string; transactionId: string; kind: 'VOID' | 'REFUND'; amountMinor?: number }): Promise<'VOIDED' | 'VOID_PENDING' | 'REFUNDED' | 'REFUND_PENDING'>;
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
  quoteTtlSeconds: number;
  checkoutResumeTtlSeconds?: number;
  paymentMode: 'mock' | 'stripe_sandbox' | 'stripe_live';
  productionEnabled: boolean;
  approvedForLiveUse: boolean;
  appApprovedForLiveUse?: boolean;
  liveMoneyEnabled?: boolean;
  liveRechargeEnabled?: boolean;
}

export interface MobileTopUpCountry {
  code: string;
  name: string;
}

export interface MobileTopUpDestination extends MobileTopUpCountry {
  callingCode: string;
}

export interface MobileTopUpOperator {
  preferredLanguage?: string;
  logoUrl?: string;
  provider?: MobileTopUpProviderName;
  id: number;
  name: string;
  countryCode: string;
  status: boolean;
  bundle: boolean;
  data?: boolean;
  combo?: boolean;
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
  classification?: ProductClassification;
  catalogVersion?: string;
  description?: string;
  benefits?: { type: 'DATA' | 'MINUTES' | 'SMS'; amount: number; unit: string }[];
  validity?: { quantity: number; unit: string; semantics: 'SERVICE' | 'REDEMPTION' };
  redemptionPeriodIso?: string;
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
  amountIncrement?: number;
  amountPrecision?: number;
}

export interface ProviderTopUpRequest {
  productSnapshot?: MobileTopUpProduct;
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
  providerFailureCode?: string;
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
  environment: MobileTopUpRuntimeEnvironment;
  uniqueCountries: number;
  providers: { provider: MobileTopUpProviderName; enabled: boolean; countries: number; reason?: string }[];
  overlapCountries: string[];
  reloadlyOnlyCountries: string[];
  dtoneOnlyCountries: string[];
  dingOnlyCountries?: string[];
  providerOverlaps?: Record<string, string[]>;
}

export interface MobileTopUpProvider {
  quoteReceiverValue?(product: MobileTopUpProduct, amount: number): Promise<ReceiverQuote>;
  readonly name?: MobileTopUpProviderName;
  readonly providerNames?: MobileTopUpProviderName[];
  coverage?(): Promise<ProviderCoverage>;
  listProducts?(countryCode: string, operatorId: number): Promise<MobileTopUpProduct[] | undefined>;
  listCountries(): Promise<MobileTopUpCountry[]>;
  listOperators(countryCode: string): Promise<MobileTopUpOperator[]>;
  detectOperator(phone: string, countryCode: string, preferredProvider?: MobileTopUpProviderName): Promise<MobileTopUpOperator>;
  getOperator(operatorId: number): Promise<MobileTopUpOperator>;
  submitTopUp(input: ProviderTopUpRequest): Promise<ProviderTopUpResult>;
  getTopUpStatus(transactionId: string, provider?: MobileTopUpProviderName): Promise<ProviderTopUpResult>;
  findTopUpByCustomIdentifier?(customIdentifier: string, provider?: MobileTopUpProviderName): Promise<ProviderTopUpResult | undefined>;
}

export interface MobileTopUpPaymentAuthorization {
  authorizationId: string;
  status: MobileTopUpPaymentStatus;
  testMode: boolean;
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

export interface MobileTopUpQuoteRecord {
  receiverQuote?: ReceiverQuote;
  productSnapshot?: MobileTopUpProduct;
  provider?: MobileTopUpProviderName;
  providerProductId?: string;
  id: string;
  userId: string;
  countryCode: string;
  recipientPhone: string;
  operatorId: number;
  operatorName: string;
  productId: string;
  productName: string;
  kind: MobileTopUpKind;
  providerAmount: number;
  providerCurrency: string;
  deliveredValue?: number;
  deliveredCurrency: string;
  feeUsd: number;
  totalChargeUsd: number;
  testMode: boolean;
  expiresAt: string;
  consumedAt?: string;
  createdAt: string;
}

export interface MobileTopUpTransactionRecord extends Omit<MobileTopUpQuoteRecord, 'expiresAt' | 'consumedAt'> {
  receiverValueConfirmed?: boolean;
  receiverDiscrepancy?: boolean;
  receiverLanguage?: string;
  quoteId: string;
  recipientId?: string;
  providerTransactionId?: string;
  operatorTransactionId?: string;
  customIdentifier: string;
  idempotencyKey: string;
  requestHash: string;
  status: MobileTopUpStatus;
  paymentStatus: MobileTopUpPaymentStatus;
  paymentAuthorizationId?: string;
  paymentMethod?: MobileTopUpPaymentMethod;
  paymentProvider?: MobileTopUpPaymentProviderName;
  paymentEnvironment: MobileTopUpRuntimeEnvironment;
  rechargeEnvironment: MobileTopUpRuntimeEnvironment;
  paymentSessionId?: string;
  paymentProviderTransactionId?: string;
  checkoutResumeTokenHash?: string;
  checkoutResumeTokenExpiresAt?: string;
  paymentStartedAt?: string;
  fulfillmentStartedAt?: string;
  recoveryStartedAt?: string;
  paymentRecoveryCode?: string;
  providerStatus?: string;
  failureCode?: string;
  testMode: boolean;
  updatedAt: string;
  deliveredAt?: string;
  failedAt?: string;
  refundedAt?: string;
}

export type TransactionUpdate = Partial<Pick<MobileTopUpTransactionRecord,
    'providerTransactionId' | 'operatorTransactionId' | 'status' | 'paymentStatus' |
    'paymentAuthorizationId' | 'providerStatus' | 'failureCode' | 'deliveredValue' |
    'deliveredCurrency' | 'deliveredAt' | 'failedAt' | 'refundedAt' | 'paymentMethod' |
  'paymentProvider' |
  'paymentSessionId' | 'paymentProviderTransactionId' | 'paymentRecoveryCode' |
    'checkoutResumeTokenHash' | 'checkoutResumeTokenExpiresAt'>>;

export class MobileTopUpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
  }
}
