import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Body, Button, Card, Heading, Label, Notice, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { activityLabel, timeAgo } from '@/lib/format';
import { radius, space, useTheme } from '@/lib/theme';
import type { Home } from '@/lib/types';
import { useLoad } from '@/lib/useLoad';

export default function HomeScreen() {
  const router = useRouter();
  const { data, error, refreshing, refresh } = useLoad(useCallback(() => api<Home>('/home'), []));
  const first = data?.name?.split(' ')[0];

  return (
    <Screen safeTop refreshing={refreshing} onRefresh={refresh}>
      <Heading size={28}>{first ? `Hi, ${first}` : 'Welcome'}</Heading>
      {error ? <Notice>{error}</Notice> : null}

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
        <Stat label="To sign" value={data?.counts.toSign} onPress={() => router.push('/to-sign')} highlight />
        <Stat label="Waiting for others" value={data?.counts.awaitingOthers} onPress={() => router.push({ pathname: '/agreements', params: { status: 'SENT' } })} />
        <Stat label="Drafts" value={data?.counts.drafts} onPress={() => router.push({ pathname: '/agreements', params: { status: 'DRAFT' } })} />
        <Stat label="Completed this month" value={data?.counts.completedThisMonth} onPress={() => router.push({ pathname: '/agreements', params: { status: 'COMPLETED' } })} />
      </View>

      <View style={{ gap: space.md }}>
        <Button title="Send for signature" onPress={() => router.push('/new')} />
        <Button title="Sign a document yourself" kind="secondary" onPress={() => router.push({ pathname: '/new', params: { mode: 'self' } })} />
      </View>

      <Label>Recent activity</Label>
      {data && !data.activity.length ? <Body muted>Nothing yet. Agreements you send show up here.</Body> : null}
      {data?.activity.map((a) => (
        <Card key={a.id} onPress={() => router.push(`/agreement/${a.envelope.id}`)}>
          <Body>
            <Text style={{ fontWeight: '700' }}>{a.actor?.name ?? a.actor?.email ?? 'Someone'}</Text> {activityLabel[a.type] ?? a.type} {a.envelope.title}
          </Body>
          <Body muted>{timeAgo(a.createdAt)}</Body>
        </Card>
      ))}
    </Screen>
  );
}

function Stat({ label, value, onPress, highlight }: { label: string; value?: number; onPress: () => void; highlight?: boolean }) {
  const t = useTheme();
  const strong = highlight && !!value;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flexGrow: 1,
        flexBasis: '45%',
        padding: space.lg,
        borderRadius: radius.lg,
        backgroundColor: strong ? t.primary : t.card,
        borderWidth: 1,
        borderColor: strong ? t.primary : t.border,
        opacity: pressed ? 0.7 : 1,
      })}>
      <Text style={{ fontSize: 28, fontWeight: '800', color: strong ? t.primaryText : t.text }}>{value ?? '–'}</Text>
      <Text style={{ fontSize: 13, color: strong ? t.primaryText : t.textMuted }}>{label}</Text>
    </Pressable>
  );
}
