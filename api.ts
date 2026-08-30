import * as SecureStore from 'expo-secure-store';

const baseUrl = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await SecureStore.getItemAsync('ticash_token');
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {})
    }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Request failed');
  return data as T;
}

export const api = {
  requestOtp: (phone: string) => request<{ ok: boolean; devCode?: string }>('/v1/auth/request-otp', { method: 'POST', body: JSON.stringify({ phone }) }),
  verifyOtp: (phone: string, code: string, fullName?: string) => request<{ token: string; user: { id: string; phone: string; fullName?: string } }>('/v1/auth/verify-otp', { method: 'POST', body: JSON.stringify({ phone, code, fullName }) }),
  quote: (amountHtg: number) => request<{ amountHtg: number; feeHtg: number; totalHtg: number; currency: 'HTG' }>('/v1/transfers/quote', { method: 'POST', body: JSON.stringify({ amountHtg }) }),
  send: (body: { recipientPhone: string; provider: 'MONCASH' | 'NATCASH'; amountHtg: number; idempotencyKey: string }) => request<Transfer>('/v1/transfers', { method: 'POST', body: JSON.stringify(body) }),
  transfers: () => request<Transfer[]>('/v1/transfers')
};

export type Transfer = {
  id: string;
  recipientPhone: string;
  provider: 'MONCASH' | 'NATCASH';
  amountHtg: number;
  feeHtg: number;
  totalHtg: number;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
  createdAt: string;
};
