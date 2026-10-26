import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import { useEffect, useState } from 'react';
import { Switch, View } from 'react-native';
import { Body, Button, Card, Heading, Label, Screen } from '@/components/ui';
import { API_URL } from '@/lib/api';
import { canUseBiometrics, useAuth } from '@/lib/auth';
import { space, useTheme } from '@/lib/theme';

export default function Settings() {
  const { me, lockEnabled, setLockEnabled, signOut } = useAuth();
  const t = useTheme();
  const [biometrics, setBiometrics] = useState(false);
  useEffect(() => {
    canUseBiometrics().then(setBiometrics);
  }, []);

  return (
    <Screen safeTop>
      <Heading size={28}>Settings</Heading>
      <Card>
        <Label>Signed in as</Label>
        <Body style={{ fontWeight: '700' }}>{me?.user?.name}</Body>
        <Body muted>{me?.user?.email}</Body>
        <Body muted>{me?.organization.name}</Body>
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Body style={{ fontWeight: '600' }}>Lock with Face ID / fingerprint</Body>
            <Body muted>{biometrics ? 'Ask when opening the app.' : 'Set up Face ID, Touch ID or a fingerprint on this phone first.'}</Body>
          </View>
          <Switch value={lockEnabled} disabled={!biometrics} onValueChange={setLockEnabled} trackColor={{ true: t.primary }} />
        </View>
      </Card>

      <Card>
        <Body style={{ fontWeight: '600' }}>More settings</Body>
        <Body muted>Team, branding, templates, billing and two-factor are on the website.</Body>
        <Button title="Open on the web" kind="secondary" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/settings`)} />
      </Card>

      <Button title="Sign out" kind="danger" onPress={signOut} />
      <Body muted style={{ textAlign: 'center' }}>Nuronix eSign {Constants.expoConfig?.version} · by NuronixAI</Body>
    </Screen>
  );
}
