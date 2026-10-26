import * as WebBrowser from 'expo-web-browser';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { Body, Button, Field, Heading, Logo, Notice, Screen } from '@/components/ui';
import { API_URL, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { space } from '@/lib/theme';

export default function Login() {
  const { signIn, verifyCode } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const submitPassword = () =>
    run(async () => {
      const res = await signIn(email.trim(), password);
      if (res.mfaToken) setMfaToken(res.mfaToken);
    });
  const submitCode = () => run(() => verifyCode(mfaToken!, code.trim()));

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen safeTop narrow>
        <View style={{ alignItems: 'center', gap: space.md, marginTop: space.xxl, marginBottom: space.lg }}>
          <Logo size={64} />
          <Heading size={26}>Nuronix eSign</Heading>
          <Body muted>Send, sign and track agreements.</Body>
        </View>
        {error ? <Notice>{error}</Notice> : null}
        {!mfaToken ? (
          <>
            <Field label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" />
            <Field label="Password" value={password} onChangeText={setPassword} secureTextEntry autoComplete="current-password" textContentType="password" onSubmitEditing={submitPassword} />
            <Button title="Sign in" onPress={submitPassword} loading={busy} disabled={!email || !password} />
            <Button title="Forgot password?" kind="secondary" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/forgot-password`)} />
            <Body muted style={{ textAlign: 'center' }}>New to Nuronix eSign?</Body>
            <Button title="Create a free account" kind="secondary" onPress={() => WebBrowser.openBrowserAsync(`${API_URL}/register`)} />
          </>
        ) : (
          <>
            <Body>Enter the 6-digit code from your authenticator app, or a recovery code.</Body>
            <Field label="Code" value={code} onChangeText={setCode} autoFocus keyboardType="number-pad" autoComplete="one-time-code" textContentType="oneTimeCode" onSubmitEditing={submitCode} />
            <Button title="Verify" onPress={submitCode} loading={busy} disabled={code.trim().length < 6} />
            <Button title="Back" kind="secondary" onPress={() => (setMfaToken(null), setCode(''))} />
          </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}
