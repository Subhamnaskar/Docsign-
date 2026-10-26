import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { Button } from '@/components/ui';
import { API_URL, api } from '@/lib/api';
import { space, useTheme } from '@/lib/theme';
import type { Envelope } from '@/lib/types';

/**
 * A website page inside the app: placing fields before sending, the signing
 * page, signing your own document. With `watch`, it follows that agreement
 * and offers to open it in the app once it is sent or signed.
 */
export default function WebPage() {
  const { url, title, watch } = useLocalSearchParams<{ url: string; title?: string; watch?: string }>();
  const router = useRouter();
  const t = useTheme();
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState<string | null>(null);
  const left = useRef(false);

  const openAgreement = () => {
    if (left.current || !watch) return;
    left.current = true;
    router.replace(`/agreement/${watch}`);
  };

  // The editor goes to the agreement page once it is sent: show it in the app instead
  function onNavigate(nav: WebViewNavigation) {
    if (!watch || !nav.url.startsWith(API_URL)) return;
    const path = nav.url.slice(API_URL.length).split('?')[0];
    if (path === `/envelopes/${watch}` || path === '/dashboard') openAgreement();
  }

  // Signing your own document finishes on the signing page; offer the way back once it is sealed
  useEffect(() => {
    if (!watch) return;
    const id = setInterval(async () => {
      const env = await api<Envelope>(`/envelopes/${watch}`).catch(() => null);
      if (env?.status === 'COMPLETED') setDone('Signed and sealed.');
      if (env?.status === 'SENT' && !env.selfSign) setDone('Sent for signature.');
    }, 4000);
    return () => clearInterval(id);
  }, [watch]);

  return (
    <View style={{ flex: 1, backgroundColor: t.background }}>
      <Stack.Screen
        options={{
          title: title ?? '',
          headerRight: () => (
            <Pressable onPress={() => (watch ? openAgreement() : router.back())} hitSlop={12}>
              <Text style={{ color: t.primary, fontSize: 17, fontWeight: '600' }}>Done</Text>
            </Pressable>
          ),
        }}
      />
      <WebView
        source={{ uri: url }}
        onLoadEnd={() => setLoading(false)}
        onNavigationStateChange={onNavigate}
        setSupportMultipleWindows={false}
        allowsBackForwardNavigationGestures
        pullToRefreshEnabled={false}
        style={{ flex: 1, backgroundColor: t.background }}
      />
      {loading ? (
        <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
          <ActivityIndicator color={t.primary} size="large" />
        </View>
      ) : null}
      {done && watch ? (
        <View style={{ padding: space.lg, gap: space.sm, borderTopWidth: 1, borderColor: t.border, backgroundColor: t.card }}>
          <Text style={{ color: t.success, fontWeight: '700', fontSize: 15 }}>{done}</Text>
          <Button title="Open in the app" onPress={openAgreement} />
        </View>
      ) : null}
    </View>
  );
}
