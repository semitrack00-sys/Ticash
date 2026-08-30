import { router } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';
import { api } from '../src/lib/api';
import { Button, Field, Screen, Subtle, Title } from '../src/components/Ui';

export default function Login() {
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    try { setBusy(true); const r = await api.requestOtp(phone); router.push({ pathname: '/verify', params: { phone, devCode: r.devCode ?? '' } }); }
    catch (e) { Alert.alert('Could not continue', (e as Error).message); }
    finally { setBusy(false); }
  };
  return <Screen><Title>Welcome to TiCash</Title><Subtle>Send money to MonCash and NatCash wallets in Haiti.</Subtle><Field keyboardType="phone-pad" value={phone} onChangeText={setPhone} placeholder="Haiti phone number" /><Button title={busy ? 'Sending…' : 'Continue'} onPress={submit} disabled={busy || phone.length < 8} /></Screen>;
}
