export type Provider = 'MONCASH' | 'NATCASH';
export type TransferStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
export type KycStatus = 'NOT_STARTED' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'REVIEW_REQUIRED';
export type LedgerDirection = 'DEBIT' | 'CREDIT';

export interface User {
  id: string;
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  kycStatus: KycStatus;
  createdAt: string;
}

export interface KycProfile {
  id: string;
  userId: string;
  status: KycStatus;
  level: number;
  submittedAt?: string;
  reviewedAt?: string;
}

export interface Recipient {
  id: string;
  userId: string;
  name: string;
  phone: string;
  provider: Provider;
  favorite: boolean;
}

export interface Quote {
  id: string;
  sendAmount: number;
  sendCurrency: string;
  receiveAmount: number;
  receiveCurrency: string;
  fee: number;
  exchangeRate: number;
  expiresAt: string;
}

export interface Transfer {
  id: string;
  senderUserId: string;
  recipientId: string;
  provider: Provider;
  amountHtg: number;
  feeHtg: number;
  status: TransferStatus;
  providerTransactionId?: string;
  createdAt: string;
  completedAt?: string;
}

export interface Wallet {
  userId: string;
  currency: string;
  availableBalance: number;
  pendingBalance: number;
}

export interface LedgerEntry {
  id: string;
  accountId: string;
  transactionId: string;
  direction: LedgerDirection;
  amount: number;
  currency: string;
  createdAt: string;
}

export interface Notification {
  id: string;
  userId: string;
  channel: 'EMAIL' | 'SMS' | 'PUSH' | 'IN_APP';
  type: string;
  status: 'PENDING' | 'SENT' | 'FAILED';
  createdAt: string;
}

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface ApiResponse<T> {
  data: T;
  requestId?: string;
}
