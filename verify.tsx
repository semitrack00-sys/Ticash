import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { api } from '../src/lib/api';
import { saveToken } from '../src/store/session';
import { Button, Field, Screen, Subtle, Title } from '../src/components/Ui';

export default function Verify() {
  const params = useLocalSearchParams<{ phone: string; devCode?: string }>();
  const [code, setCode] = useState(params.devCode ?? '');
  const [name, setName] = useState('');
  const submit = async () => {
    try { const r = await api.verifyOtp(params.phone, code, name || undefined); await saveToken(r.token); router.replace('/home'); }
    catch (e) { Alert.alert('Verification failed', (e as Error).message); }
  };
  return <Screen><Title>Verify your phone</Title><Subtle>Enter the 6-digit code sent to {params.phone}.</Subtle><Field value={code} onChangeText={setCode} keyboardType="number-pad" maxLength={6} placeholder="123456" /><Field value={name} onChangeText={setName} placeholder="Full name (optional for demo)" /><Button title="Verify" onPress={submit} disabled={code.length !== 6} /></Screen>;
}
