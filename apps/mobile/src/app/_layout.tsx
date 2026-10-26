import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';
import { LockScreen } from '@/components/LockScreen';
import { AuthProvider, useAuth } from '@/lib/auth';
import { lockPhonesUpright } from '@/lib/layout';
import { onNotificationTap } from '@/lib/push';
import { useTheme } from '@/lib/theme';

SplashScreen.preventAutoHideAsync();
lockPhonesUpright();

export default function RootLayout() {
  return (
    <AuthProvider>
      <Navigation />
    </AuthProvider>
  );
}

function Navigation() {
  const { status } = useAuth();
  const scheme = useColorScheme();
  const t = useTheme();
  const router = useRouter();

  useEffect(() => {
    if (status !== 'loading') SplashScreen.hideAsync();
  }, [status]);

  // A tapped alert opens the agreement it is about (or the "to sign" list)
  useEffect(() => {
    if (status !== 'signedIn') return;
    return onNotificationTap((to) => router.push(to as never));
  }, [status, router]);

  if (status === 'loading') return null;
  if (status === 'locked') return <LockScreen />;

  const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
  const theme = { ...base, colors: { ...base.colors, primary: t.primary, background: t.background, card: t.card, text: t.text, border: t.border } };
  return (
    <ThemeProvider value={theme}>
      <Stack screenOptions={{ headerTintColor: t.primary, headerTitleStyle: { color: t.text }, headerBackButtonDisplayMode: 'minimal' }}>
        <Stack.Protected guard={status === 'signedIn'}>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="agreement/[id]" options={{ title: 'Agreement' }} />
          <Stack.Screen name="new" options={{ title: 'New agreement', presentation: 'modal' }} />
          <Stack.Screen name="web" options={{ title: '' }} />
        </Stack.Protected>
        <Stack.Protected guard={status === 'signedOut'}>
          <Stack.Screen name="login" options={{ headerShown: false }} />
        </Stack.Protected>
      </Stack>
    </ThemeProvider>
  );
}
