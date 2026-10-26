import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { useAuth } from '@/lib/auth';
import { MAX_FORM_WIDTH } from '@/lib/layout';
import { space, useTheme } from '@/lib/theme';
import { Body, Button, Heading, Logo } from './ui';

/** Shown instead of the app until Face ID / fingerprint succeeds. */
export function LockScreen() {
  const { unlock, signOut, me } = useAuth();
  const t = useTheme();
  const [failed, setFailed] = useState(false);

  // Ask once when the lock appears; later attempts come from the button
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    unlock().then((ok) => setFailed(!ok));
  }, [unlock]);

  return (
    <View style={{ flex: 1, backgroundColor: t.background, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.lg }}>
      <Logo size={64} />
      <Heading>Nuronix eSign is locked</Heading>
      {me?.user ? <Body muted>{me.user.email}</Body> : null}
      <View style={{ gap: space.md, marginTop: space.lg, width: '100%', maxWidth: MAX_FORM_WIDTH }}>
        <Button title="Unlock" onPress={() => unlock().then((ok) => setFailed(!ok))} />
        {failed ? <Button title="Sign out" kind="secondary" onPress={signOut} /> : null}
      </View>
    </View>
  );
}
