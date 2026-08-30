import { router } from 'expo-router';
import { useEffect } from 'react';
import { ActivityIndicator } from 'react-native';
import { Screen } from '../src/components/Ui';
import { getToken } from '../src/store/session';

export default function Index() {
  useEffect(() => { getToken().then(token => router.replace(token ? '/home' : '/login')); }, []);
  return <Screen><ActivityIndicator /></Screen>;
}
