import type { ComponentProps, PropsWithChildren } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors } from '../theme/colors';

export function Screen({ children }: PropsWithChildren) { return <View style={s.screen}>{children}</View>; }
export function Title({ children }: PropsWithChildren) { return <Text style={s.title}>{children}</Text>; }
export function Subtle({ children }: PropsWithChildren) { return <Text style={s.subtle}>{children}</Text>; }
export function Field(props: ComponentProps<typeof TextInput>) { return <TextInput placeholderTextColor={colors.muted} {...props} style={[s.field, props.style]} />; }
export function Button({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) { return <Pressable disabled={disabled} onPress={onPress} style={[s.button, disabled && { opacity: 0.5 }]}><Text style={s.buttonText}>{title}</Text></Pressable>; }
export function Card({ children }: PropsWithChildren) { return <View style={s.card}>{children}</View>; }

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, padding: 22, paddingTop: 70, gap: 14 },
  title: { fontSize: 30, fontWeight: '800', color: colors.ink },
  subtle: { fontSize: 15, color: colors.muted, lineHeight: 22 },
  field: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 14, fontSize: 17, color: colors.ink },
  button: { backgroundColor: colors.primary, borderRadius: 14, padding: 16, alignItems: 'center' },
  buttonText: { color: 'white', fontSize: 17, fontWeight: '700' },
  card: { backgroundColor: colors.surface, borderRadius: 16, padding: 16, gap: 8, borderWidth: 1, borderColor: colors.border }
});
