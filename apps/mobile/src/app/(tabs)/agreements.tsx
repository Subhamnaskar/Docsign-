import { useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput } from 'react-native';
import { EnvelopeRow } from '@/components/EnvelopeRow';
import { Empty, Heading, Notice, Screen } from '@/components/ui';
import { api } from '@/lib/api';
import { radius, space, useTheme } from '@/lib/theme';
import type { EnvelopeStatus, EnvelopeSummary } from '@/lib/types';
import { useLoad } from '@/lib/useLoad';

const FILTERS: { label: string; status?: EnvelopeStatus }[] = [
  { label: 'All' },
  { label: 'Waiting', status: 'SENT' },
  { label: 'Completed', status: 'COMPLETED' },
  { label: 'Drafts', status: 'DRAFT' },
  { label: 'Declined', status: 'DECLINED' },
];

export default function Agreements() {
  const t = useTheme();
  const params = useLocalSearchParams<{ status?: EnvelopeStatus }>();
  const [status, setStatus] = useState<EnvelopeStatus | undefined>(params.status);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');

  // Home's counters open this tab on a status
  useEffect(() => setStatus(params.status), [params.status]);
  // Search after typing pauses
  useEffect(() => {
    const id = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(() => {
    const qs = new URLSearchParams({ limit: '50', ...(status ? { status } : {}), ...(query ? { search: query } : {}) });
    return api<{ data: EnvelopeSummary[] }>(`/envelopes?${qs}`);
  }, [status, query]);
  const { data, error, refreshing, refresh } = useLoad(load);

  return (
    <Screen safeTop refreshing={refreshing} onRefresh={refresh}>
      <Heading size={28}>Agreements</Heading>
      <TextInput
        value={search}
        onChangeText={setSearch}
        placeholder="Search title or recipient"
        placeholderTextColor={t.textMuted}
        autoCapitalize="none"
        clearButtonMode="while-editing"
        style={{ minHeight: 44, borderRadius: radius.md, borderWidth: 1, borderColor: t.border, backgroundColor: t.card, color: t.text, paddingHorizontal: space.md, fontSize: 16 }}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.sm }}>
        {FILTERS.map((f) => {
          const on = f.status === status;
          return (
            <Pressable
              key={f.label}
              onPress={() => setStatus(f.status)}
              style={{ paddingHorizontal: space.lg, paddingVertical: space.sm, borderRadius: radius.pill, backgroundColor: on ? t.primary : t.card, borderWidth: 1, borderColor: on ? t.primary : t.border }}>
              <Text style={{ color: on ? t.primaryText : t.text, fontWeight: '600' }}>{f.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
      {error ? <Notice>{error}</Notice> : null}
      {data && !data.data.length ? <Empty title="No agreements">{query ? 'Nothing matches your search.' : 'Agreements you send appear here.'}</Empty> : null}
      {data?.data.map((e) => <EnvelopeRow key={e.id} envelope={e} />)}
    </Screen>
  );
}
