import { router } from 'expo-router';
import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Button, Card, Screen, Subtle, Title } from '../src/components/Ui';
import { api, type Transfer } from '../src/lib/api';
import { colors } from '../src/theme/colors';

export default function Home() {
  const [items, setItems] = useState<Transfer[]>([]);
  const [loading, setLoading] = useState(false);
  const load = async () => { try { setLoading(true); setItems(await api.transfers()); } finally { setLoading(false); } };
  useFocusEffect(useCallback(() => { void load(); }, []));
  return <Screen><Title>TiCash</Title><Subtle>Fast wallet payouts in Haiti.</Subtle><Button title="Send money" onPress={() => router.push('/send')} /><Text style={s.heading}>Recent transfers</Text><ScrollView refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}><View style={{ gap: 10 }}>{items.length === 0 ? <Subtle>No transfers yet.</Subtle> : items.map(t => <Card key={t.id}><Text style={s.amount}>{t.amountHtg.toLocaleString()} HTG</Text><Text>{t.provider} • {t.recipientPhone}</Text><Text style={{ color: t.status === 'COMPLETED' ? colors.success : colors.muted }}>{t.status}</Text></Card>)}</View></ScrollView></Screen>;
}
const s = StyleSheet.create({ heading: { marginTop: 10, fontWeight: '800', fontSize: 18, color: colors.ink }, amount: { fontSize: 20, fontWeight: '800', color: colors.ink } });
