// TypeScript type definitions
export interface User {
  id: string;
  email: string;
  name: string;
}

export interface Transaction {
  id: string;
  amount: number;
  recipientId: string;
  status: 'pending' | 'completed' | 'failed';
  createdAt: Date;
}

export interface RemittancePayload {
  recipientEmail: string;
  amount: number;
  currency: string;
  description?: string;
}
