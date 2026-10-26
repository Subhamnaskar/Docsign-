import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Body, Button, Card, Field, Label, Notice, Screen } from '@/components/ui';
import { api, ApiError } from '@/lib/api';
import { type LocalFile, pagesToPdf, pickPdf, scanPage, uploadDocument } from '@/lib/files';
import { space, useTheme } from '@/lib/theme';
import type { Envelope } from '@/lib/types';
import { openWebPage } from '@/lib/web';

interface Signer {
  name: string;
  email: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Start an agreement: a PDF or scanned pages, then signers (or just me), then fields on the website page. */
export default function NewAgreement() {
  const { mode } = useLocalSearchParams<{ mode?: 'self' }>();
  const self = mode === 'self';
  const router = useRouter();
  const t = useTheme();
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<LocalFile | null>(null);
  const [pages, setPages] = useState<string[]>([]);
  const [signers, setSigners] = useState<Signer[]>([{ name: '', email: '' }]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(null);
    }
  }

  const choose = () =>
    run('pick', async () => {
      const f = await pickPdf();
      if (!f) return;
      setFile(f);
      setPages([]);
      if (!title) setTitle(f.name.replace(/\.pdf$/i, ''));
    });

  const scan = () =>
    run('scan', async () => {
      const page = await scanPage();
      if (!page) return;
      setFile(null);
      setPages((p) => [...p, page]);
    });

  const validSigners = signers.filter((s) => s.name.trim() && EMAIL.test(s.email.trim()));
  const hasDocument = !!file || pages.length > 0;
  const ready = hasDocument && (self || (validSigners.length > 0 && validSigners.length === signers.filter((s) => s.name || s.email).length));

  const start = () =>
    run('start', async () => {
      const name = title.trim() || (self ? 'Document to sign' : 'Agreement');
      const doc = file ?? (await pagesToPdf(pages, name));
      const env = self
        ? await api<Envelope>('/self-sign', { json: { title: name } })
        : await api<Envelope>('/envelopes', { json: { title: name } });
      await uploadDocument(env.id, doc);
      if (!self) {
        await api(`/envelopes/${env.id}/recipients`, {
          method: 'PUT',
          json: validSigners.map((s, i) => ({ name: s.name.trim(), email: s.email.trim().toLowerCase(), routingOrder: i + 1 })),
        });
      }
      // Placing fields is easiest on the page itself; the editor then sends (or starts signing)
      await openWebPage(router, self ? `/sign-yourself?id=${env.id}` : `/envelopes/${env.id}/edit?step=fields`, { title: self ? 'Sign' : 'Place fields', watch: env.id, replace: true });
    });

  return (
    <Screen>
      {error ? <Notice>{error}</Notice> : null}
      <Field label="Title" value={title} onChangeText={setTitle} placeholder={self ? 'e.g. Joining letter' : 'e.g. Rental agreement'} />

      <Card>
        <Label>Document</Label>
        {file ? <Body>📄 {file.name}</Body> : null}
        {pages.length ? <Body>📷 {pages.length} scanned {pages.length === 1 ? 'page' : 'pages'}</Body> : null}
        {!hasDocument ? <Body muted>Choose a PDF, or scan paper pages with the camera.</Body> : null}
        <View style={{ flexDirection: 'row', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Button title={file ? 'Change PDF' : 'Choose PDF'} kind="secondary" onPress={choose} loading={busy === 'pick'} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title={pages.length ? 'Scan another page' : 'Scan pages'} kind="secondary" onPress={scan} loading={busy === 'scan'} />
          </View>
        </View>
        {pages.length ? <Button title="Start the scan again" kind="danger" onPress={() => setPages([])} /> : null}
      </Card>

      {!self ? (
        <Card>
          <Label>Who signs</Label>
          {signers.map((s, i) => (
            <View key={i} style={{ gap: space.sm, paddingBottom: space.sm, borderBottomWidth: i < signers.length - 1 ? 1 : 0, borderColor: t.border }}>
              <Field label={signers.length > 1 ? `Signer ${i + 1}` : 'Name'} value={s.name} onChangeText={(v) => setSigners((all) => all.map((x, j) => (j === i ? { ...x, name: v } : x)))} autoCapitalize="words" />
              <Field
                label="Email"
                value={s.email}
                onChangeText={(v) => setSigners((all) => all.map((x, j) => (j === i ? { ...x, email: v } : x)))}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              {signers.length > 1 ? (
                <Pressable onPress={() => setSigners((all) => all.filter((_, j) => j !== i))}>
                  <Text style={{ color: t.danger, fontWeight: '600' }}>Remove</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          <Button title="Add another signer" kind="secondary" onPress={() => setSigners((all) => [...all, { name: '', email: '' }])} />
          {signers.length > 1 ? <Body muted>They sign in this order.</Body> : null}
        </Card>
      ) : (
        <Body muted>Free. You'll place your signature, sign, then share or download the signed PDF.</Body>
      )}

      <Button title={self ? 'Next: place signature' : 'Next: place fields'} onPress={start} loading={busy === 'start'} disabled={!ready || !!busy} />
    </Screen>
  );
}
