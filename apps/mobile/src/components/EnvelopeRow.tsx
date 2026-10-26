import { useRouter } from 'expo-router';
import { View } from 'react-native';
import { formatDate } from '@/lib/format';
import type { EnvelopeSummary } from '@/lib/types';
import { Body, Card, StatusPill } from './ui';

/** One agreement in a list: title, who it's with, status and date. */
export function EnvelopeRow({ envelope: e }: { envelope: EnvelopeSummary }) {
  const router = useRouter();
  const signers = e.recipients.filter((r) => r.role !== 'CC');
  const signed = signers.filter((r) => r.status === 'SIGNED').length;
  const who = signers.map((r) => r.name).join(', ') || 'No recipients yet';
  return (
    <Card onPress={() => router.push(`/agreement/${e.id}`)}>
      <Body style={{ fontWeight: '700' }}>{e.title}</Body>
      <Body muted>{who}</Body>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <StatusPill status={e.status} label={e.status === 'SENT' && signers.length > 1 ? `${signed} of ${signers.length} signed` : undefined} />
        <Body muted>{formatDate(e.completedAt ?? e.sentAt ?? e.updatedAt)}</Body>
      </View>
    </Card>
  );
}
