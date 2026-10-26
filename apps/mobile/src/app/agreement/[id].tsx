import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, View } from 'react-native';
import { Body, Button, Card, Heading, Label, Loading, Notice, Screen, StatusPill } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { sharePdf } from '@/lib/files';
import { formatDate, recipientLabel } from '@/lib/format';
import { space, useTheme } from '@/lib/theme';
import type { Envelope } from '@/lib/types';
import { useLoad } from '@/lib/useLoad';
import { openWebPage } from '@/lib/web';

export default function Agreement() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const t = useTheme();
  const { data: env, error, refreshing, refresh, reload } = useLoad(useCallback(() => api<Envelope>(`/envelopes/${id}`), [id]));
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function act(key: string, fn: () => Promise<unknown>, done?: string) {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
      if (done) setMessage(done);
    } catch (e) {
      Alert.alert('Could not do that', e instanceof ApiError ? e.message : 'Try again.');
    } finally {
      setBusy(null);
    }
  }

  if (!env) return error ? <Screen><Notice>{error}</Notice></Screen> : <Loading />;

  const signers = env.recipients.filter((r) => r.role !== 'CC');
  const edit = () =>
    env.selfSign
      ? openWebPage(router, `/sign-yourself?id=${env.id}`, { title: 'Sign', watch: env.id })
      : openWebPage(router, `/envelopes/${env.id}/edit`, { title: 'Place fields', watch: env.id });

  return (
    <Screen refreshing={refreshing} onRefresh={refresh}>
      <Stack.Screen options={{ title: '' }} />
      <View style={{ gap: space.sm }}>
        <Heading>{env.title}</Heading>
        <StatusPill status={env.status} />
        {env.sentAt && !env.selfSign ? <Body muted>Sent {formatDate(env.sentAt)}</Body> : null}
        {env.completedAt ? <Body muted>Completed {formatDate(env.completedAt)}</Body> : null}
        {env.expiresAt && env.status === 'SENT' ? <Body muted>Expires {formatDate(env.expiresAt)}</Body> : null}
      </View>
      {message ? <Notice kind="info">{message}</Notice> : null}

      {env.status === 'COMPLETED' ? (
        <Card>
          <Label>Signed documents</Label>
          {env.documents.map((d) => (
            <Button
              key={d.id}
              title={`Share ${d.name.replace(/\.pdf$/i, '')} (signed)`}
              loading={busy === d.id}
              onPress={() => act(d.id, () => sharePdf(`/envelopes/${env.id}/documents/${d.id}/file`, `${d.name.replace(/\.pdf$/i, '')} (signed).pdf`))}
            />
          ))}
          <Button
            title="Share certificate of completion"
            kind="secondary"
            loading={busy === 'cert'}
            onPress={() => act('cert', () => sharePdf(`/envelopes/${env.id}/certificate`, `Certificate - ${env.title}.pdf`))}
          />
        </Card>
      ) : null}

      <Card>
        <Label>{env.selfSign ? 'Signer' : 'Recipients'}</Label>
        {signers.map((r) => (
          <View key={r.id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: space.md, paddingVertical: space.xs }}>
            <View style={{ flex: 1 }}>
              <Body style={{ fontWeight: '600' }}>{r.name}</Body>
              <Body muted>{r.email}</Body>
            </View>
            <Body style={{ color: r.status === 'SIGNED' ? t.success : r.status === 'DECLINED' ? t.danger : t.textMuted, fontWeight: '600' }}>
              {recipientLabel[r.status]}
            </Body>
          </View>
        ))}
        {!signers.length ? <Body muted>No recipients yet.</Body> : null}
      </Card>

      {env.status === 'DRAFT' ? (
        <>
          <Button title={env.selfSign ? 'Place signature and sign' : 'Place fields and send'} onPress={() => act('edit', edit)} loading={busy === 'edit'} />
          <Button
            title="Delete draft"
            kind="danger"
            onPress={() =>
              Alert.alert('Delete this draft?', env.title, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => act('delete', async () => (await api(`/envelopes/${env.id}`, { method: 'DELETE' }), router.back())) },
              ])
            }
          />
        </>
      ) : null}

      {env.status === 'SENT' && env.selfSign ? <Button title="Sign now" onPress={() => act('edit', edit)} loading={busy === 'edit'} /> : null}
      {env.status === 'SENT' && !env.selfSign ? (
        <Button title="Send a reminder" kind="secondary" loading={busy === 'remind'} onPress={() => act('remind', () => api(`/envelopes/${env.id}/remind`, { method: 'POST' }).then(reload), 'Reminder sent.')} />
      ) : null}
    </Screen>
  );
}
