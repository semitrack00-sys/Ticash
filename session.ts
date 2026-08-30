import * as SecureStore from 'expo-secure-store';

export async function saveToken(token: string) { await SecureStore.setItemAsync('ticash_token', token); }
export async function getToken() { return SecureStore.getItemAsync('ticash_token'); }
export async function clearToken() { await SecureStore.deleteItemAsync('ticash_token'); }
