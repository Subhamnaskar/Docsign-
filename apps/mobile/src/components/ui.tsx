import * as Haptics from 'expo-haptics';
import type { ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, type TextInputProps, View, type ViewStyle } from 'react-native';
import { statusLabel } from '@/lib/format';
import { gold, radius, space, type Theme, useTheme } from '@/lib/theme';
import type { EnvelopeStatus } from '@/lib/types';

/** Scrolling page with pull-to-refresh. Tab screens have no header, so they keep clear of the status bar (`safeTop`). */
export function Screen({ children, refreshing, onRefresh, safeTop }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; safeTop?: boolean }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.background }}
      contentContainerStyle={{ padding: space.lg, paddingTop: space.lg + (safeTop ? insets.top : 0), gap: space.lg, paddingBottom: space.xxl * 2 }}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={t.primary} /> : undefined}>
      {children}
    </ScrollView>
  );
}

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  const t = useTheme();
  const box = [styles.card, { backgroundColor: t.card, borderColor: t.border }, style];
  if (!onPress) return <View style={box}>{children}</View>;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [...box, pressed && { opacity: 0.7 }]}>
      {children}
    </Pressable>
  );
}

export function Heading({ children, size = 22 }: { children: ReactNode; size?: number }) {
  const t = useTheme();
  return <Text style={{ color: t.text, fontSize: size, fontWeight: '700' }}>{children}</Text>;
}

export function Body({ children, muted, style }: { children: ReactNode; muted?: boolean; style?: object }) {
  const t = useTheme();
  return <Text style={[{ color: muted ? t.textMuted : t.text, fontSize: 15, lineHeight: 21 }, style]}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  const t = useTheme();
  return <Text style={{ color: t.textMuted, fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 0.6 }}>{children}</Text>;
}

type ButtonKind = 'primary' | 'secondary' | 'danger';

export function Button({ title, onPress, kind = 'primary', loading, disabled }: { title: string; onPress: () => void; kind?: ButtonKind; loading?: boolean; disabled?: boolean }) {
  const t = useTheme();
  const colors = buttonColors(t, kind);
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      disabled={off}
      onPress={() => {
        Haptics.selectionAsync().catch(() => {});
        onPress();
      }}
      style={({ pressed }) => [styles.button, { backgroundColor: colors.bg, borderColor: colors.border }, (pressed || off) && { opacity: 0.6 }]}>
      {loading ? <ActivityIndicator color={colors.fg} /> : <Text style={{ color: colors.fg, fontSize: 16, fontWeight: '700' }}>{title}</Text>}
    </Pressable>
  );
}

function buttonColors(t: Theme, kind: ButtonKind) {
  if (kind === 'primary') return { bg: t.primary, fg: t.primaryText, border: t.primary };
  if (kind === 'danger') return { bg: 'transparent', fg: t.danger, border: t.danger };
  return { bg: t.card, fg: t.text, border: t.border };
}

export function Field({ label, ...props }: TextInputProps & { label: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
      <TextInput
        placeholderTextColor={t.textMuted}
        {...props}
        style={[styles.input, { color: t.text, backgroundColor: t.card, borderColor: t.border }]}
      />
    </View>
  );
}

const tone: Record<EnvelopeStatus, 'neutral' | 'info' | 'success' | 'danger'> = {
  DRAFT: 'neutral',
  SENT: 'info',
  COMPLETED: 'success',
  DECLINED: 'danger',
  VOIDED: 'neutral',
  EXPIRED: 'neutral',
};

export function StatusPill({ status, label }: { status: EnvelopeStatus; label?: string }) {
  const t = useTheme();
  const color = { neutral: t.textMuted, info: t.info, success: t.success, danger: t.danger }[tone[status]];
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={{ color, fontSize: 12, fontWeight: '700' }}>{label ?? statusLabel[status]}</Text>
    </View>
  );
}

export function Notice({ children, kind = 'error' }: { children: ReactNode; kind?: 'error' | 'info' }) {
  const t = useTheme();
  const color = kind === 'error' ? t.danger : t.info;
  return (
    <View style={[styles.notice, { borderColor: color }]}>
      <Text style={{ color, fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', paddingVertical: space.xxl, gap: space.sm }}>
      <Heading size={17}>{title}</Heading>
      {children ? <Body muted style={{ textAlign: 'center' }}>{children}</Body> : null}
    </View>
  );
}

export function Loading() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.background }}>
      <ActivityIndicator color={t.primary} size="large" />
    </View>
  );
}

/** The app mark: gold tile with the signature stroke, as on the website. */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.25, backgroundColor: gold[500], alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#14110b', fontSize: size * 0.5, fontWeight: '900' }}>✍</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radius.lg, padding: space.lg, gap: space.sm },
  button: { minHeight: 50, borderRadius: radius.md, borderWidth: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.lg },
  input: { minHeight: 48, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, fontSize: 16 },
  pill: { borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  notice: { borderWidth: 1, borderRadius: radius.md, padding: space.md },
});
