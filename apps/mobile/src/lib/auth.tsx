import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { api, loadToken, saveToken, setSignedOutHandler } from './api';
import { currentPushToken, registerForPush } from './push';
import type { Me } from './types';

type Status = 'loading' | 'signedOut' | 'locked' | 'signedIn';
type LoginResult = { mfaToken?: string };

interface Auth {
  status: Status;
  me: Me | null;
  /** Face ID / fingerprint required to open the app */
  lockEnabled: boolean;
  signIn(email: string, password: string): Promise<LoginResult>;
  verifyCode(mfaToken: string, code: string): Promise<void>;
  signOut(): Promise<void>;
  unlock(): Promise<boolean>;
  setLockEnabled(on: boolean): Promise<void>;
  refreshMe(): Promise<void>;
}

const AuthContext = createContext<Auth | null>(null);
const LOCK_KEY = 'biometric-lock';
/** Lock again after the app has been in the background this long */
const RELOCK_AFTER_MS = 2 * 60_000;
const platform = Platform.OS === 'ios' ? 'ios' : 'android';

export async function canUseBiometrics() {
  return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync());
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [lockEnabled, setLock] = useState(false);
  const backgroundedAt = useRef<number | null>(null);

  const clear = useCallback(async () => {
    await saveToken(null);
    setMe(null);
    setStatus('signedOut');
  }, []);

  const finishSignIn = useCallback(async (token: string) => {
    await saveToken(token);
    setMe(await api<Me>('/auth/me'));
    setStatus('signedIn');
    // Alerts are optional: a refusal or a simulator without push must not block sign-in
    registerForPush().catch(() => {});
  }, []);

  // Start-up: restore the saved session, locked if the user asked for Face ID / fingerprint
  useEffect(() => {
    setSignedOutHandler(() => void clear());
    (async () => {
      const lock = (await SecureStore.getItemAsync(LOCK_KEY)) === 'on';
      setLock(lock);
      if (!(await loadToken())) return setStatus('signedOut');
      try {
        setMe(await api<Me>('/auth/me'));
        setStatus(lock ? 'locked' : 'signedIn');
        registerForPush().catch(() => {});
      } catch {
        await clear();
      }
    })();
  }, [clear]);

  // Lock again when the app comes back after a while
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background') backgroundedAt.current = Date.now();
      if (state === 'active' && backgroundedAt.current && lockEnabled && Date.now() - backgroundedAt.current > RELOCK_AFTER_MS) {
        setStatus((s) => (s === 'signedIn' ? 'locked' : s));
      }
    });
    return () => sub.remove();
  }, [lockEnabled]);

  const value: Auth = {
    status,
    me,
    lockEnabled,
    async signIn(email, password) {
      const res = await api<{ token?: string; mfaRequired?: boolean; mfaToken?: string }>('/mobile/login', { json: { email, password, platform } });
      if (res.mfaRequired) return { mfaToken: res.mfaToken };
      await finishSignIn(res.token!);
      return {};
    },
    async verifyCode(mfaToken, code) {
      const res = await api<{ token: string }>('/mobile/login/mfa', { json: { token: mfaToken, code, platform } });
      await finishSignIn(res.token);
    },
    async signOut() {
      await api('/mobile/logout', { json: { pushToken: currentPushToken() ?? undefined } }).catch(() => {});
      await clear();
    },
    async unlock() {
      const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Nuronix eSign' });
      if (res.success) setStatus('signedIn');
      return res.success;
    },
    async setLockEnabled(on) {
      if (on) {
        const res = await LocalAuthentication.authenticateAsync({ promptMessage: 'Confirm to turn on the lock' });
        if (!res.success) return;
      }
      await SecureStore.setItemAsync(LOCK_KEY, on ? 'on' : 'off');
      setLock(on);
    },
    async refreshMe() {
      setMe(await api<Me>('/auth/me'));
    },
  };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
