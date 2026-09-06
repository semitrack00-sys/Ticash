export type KycStatus = 'NOT_STARTED' | 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'DECLINED' | 'EXPIRED';
export type PayoutMethod = 'MONCASH' | 'NATCASH';
export type TransferStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
export type TransferStage = 'AWAITING_FUNDING' | 'FUNDING_PROCESSING' | 'COMPLIANCE_REVIEW' | 'PAYOUT_PROCESSING' | 'DELIVERED' | 'FAILED' | 'CANCELLED' | 'REVERSED';
export type UserRole =
  | 'CUSTOMER'
  | 'SUPER_ADMIN'
  | 'COMPLIANCE'
  | 'OPERATIONS'
  | 'SUPPORT'
  | 'READ_ONLY'
  | 'ADMIN';
export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phoneNumber?: string;
  countryCode?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  region?: string;
  postalCode?: string;
  kycStatus: KycStatus;
  role: UserRole;
  createdAt: string;
}
export interface Recipient { id: string; firstName: string; middleName?: string; lastName: string; fullName: string; country: 'HT'; phoneNumber: string; address: string; city: string; department: string; payoutMethod: PayoutMethod }
export type SourceCurrency = 'USD' | 'CAD' | 'EUR' | 'MXN' | 'BRL' | 'CLP' | 'DOP';
export interface Transfer { id: string; referenceNumber: string; recipientId: string; recipientName: string; recipientPhone: string; payoutMethod: PayoutMethod; amount: number; sourceCurrency: SourceCurrency; targetCurrency: 'HTG'; fee: number; ticashFee: number; providerFundingFee: number; totalCharged: number; exchangeRate: number; amountReceived: number; status: TransferStatus; stage: TransferStage; complianceStatus?: 'CLEAR' | 'REVIEW' | 'BLOCKED'; testMode: boolean; fundingTransactionId?: string; providerTransactionId?: string; failureCode?: string; configurationVersionId?: string; createdAt: string; completedAt?: string }
export interface TransferQuote {
  quoteId: string;
  provider: string;
  testMode: boolean;
  corridor: {
    sendCountry: 'US' | 'CA' | 'EU' | 'MX' | 'BR' | 'CL' | 'DO';
    receiveCountry: 'HT';
    sourceCurrency: SourceCurrency;
    targetCurrency: 'HTG';
  };
  payoutMethod: PayoutMethod;
  sendAmount: number;
  exchangeRate: number;
  ticashFee: number;
  providerFundingFee: number;
  totalCustomerCharge: number;
  recipientAmount: number;
  expiresAt: string;
  configurationVersionId?: string;
}
