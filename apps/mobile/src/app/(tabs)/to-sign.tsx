import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { View } from 'react-native';
import { Body, Card, Empty, Grid, Heading, Notice, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { space } from '@/lib/theme';
import type { ToSignItem } from '@/lib/types';
import { useLoad } from '@/lib/useLoad';
import { openSigningPage } from '@/lib/web';

export default function ToSign() {
  const router = useRouter();
  const { data, error, refreshing, refresh } = useLoad(useCallback(() => api<{ emailVerified: boolean; data: ToSignItem[] }>('/mobile/to-sign'), []));

  return (
    <Screen safeTop refreshing={refreshing} onRefresh={refresh}>
      <Heading size={28}>To sign</Heading>
      {error ? <Notice>{error}</Notice> : null}
      {data && !data.emailVerified ? (
        <Notice kind="info">Confirm your email address (check your inbox for our link) to see agreements sent to you.</Notice>
      ) : null}
      {data?.emailVerified && !data.data.length ? (
        <Empty title="You're all caught up">Agreements other people send you to sign appear here.</Empty>
      ) : null}
      <Grid>
        {data?.data.map((item) => (
          <Card key={item.recipientId} onPress={() => openSigningPage(router, item.signingUrl, item.title)}>
            <Body style={{ fontWeight: '700' }}>
              {item.testMode ? '[TEST] ' : ''}
              {item.title}
            </Body>
            <Body muted>
              From {item.from} · {item.organization}
            </Body>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs }}>
              <Body muted>{item.role === 'APPROVER' ? 'Approve' : 'Sign'}</Body>
              {item.expiresAt ? <Body muted>Due {formatDate(item.expiresAt)}</Body> : <Body muted>Sent {formatDate(item.sentAt)}</Body>}
            </View>
          </Card>
        ))}
      </Grid>
    </Screen>
  );
}
