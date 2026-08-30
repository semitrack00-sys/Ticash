import * as Crypto from 'expo-crypto';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { api } from '../src/lib/api';
import { Button, Card, Field, Screen, Subtle, Title } from '../src/components/Ui';
import { colors } from '../src/theme/colors';

export default function Send() {
  const [phone, setPhone] = useState('');
  const [amount, setAmount] = useState('');
  const [provider, setProvider] = useState<'MONCASH' | 'NATCASH'>('MONCASH');
  const [quote, setQuote] = useState<{ amountHtg: number; feeHtg: number; totalHtg: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const amountNumber = useMemo(() => Number(amount), [amount]);
  const getQuote = async () => { try { setQuote(await api.quote(amountNumber)); } catch (e) { Alert.alert('Check amount', (e as Error).message); } };
  const send = async () => {
    if (!quote) return;
    try {
      setBusy(true);
      const t = await api.send({ recipientPhone: phone, provider, amountHtg: quote.amountHtg, idempotencyKey: Crypto.randomUUID() });
      if (t.status === 'FAILED') Alert.alert('Transfer failed', 'No money was marked as sent. Check transaction history.');
      else Alert.alert('Transfer submitted', `${t.amountHtg} HTG to ${t.recipientPhone}`, [{ text: 'Done', onPress: () => router.replace('/home') }]);
    } catch (e) { Alert.alert('Could not send', (e as Error).message); }
    finally { setBusy(false); }
  };
  return <Screen><Title>Send money</Title><Subtle>Choose the recipient wallet, enter a Haiti phone number, and review the total before confirming.</Subtle><View style={s.providers}>{(['MONCASH','NATCASH'] as const).map(p => <Pressable key={p} onPress={() => { setProvider(p); setQuote(null); }} style={[s.provider, provider === p && s.selected]}><Text style={provider === p ? s.selectedText : undefined}>{p === 'MONCASH' ? 'MonCash' : 'NatCash'}</Text></Pressable>)}</View><Field value={phone} onChangeText={v => { setPhone(v); setQuote(null); }} keyboardType="phone-pad" placeholder="Recipient phone" /><Field value={amount} onChangeText={v => { setAmount(v.replace(/\D/g, '')); setQuote(null); }} keyboardType="number-pad" placeholder="Amount in HTG" />{quote ? <Card><Text>Recipient gets: {quote.amountHtg.toLocaleString()} HTG</Text><Text>TiCash fee: {quote.feeHtg.toLocaleString()} HTG</Text><Text style={s.total}>Total: {quote.totalHtg.toLocaleString()} HTG</Text></Card> : <Button title="Review transfer" onPress={getQuote} disabled={!phone || !Number.isFinite(amountNumber) || amountNumber <= 0} />}{quote && <Button title={busy ? 'Sending…' : 'Confirm and send'} onPress={send} disabled={busy} />}</Screen>;
}
const s = StyleSheet.create({ providers: { flexDirection: 'row', gap: 10 }, provider: { flex: 1, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, alignItems: 'center' }, selected: { backgroundColor: colors.primary, borderColor: colors.primary }, selectedText: { color: 'white', fontWeight: '800' }, total: { fontWeight: '800', fontSize: 18, color: colors.ink } });
