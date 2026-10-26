import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';

/** The Nuronix eSign server: app.json → extra.apiUrl, or EXPO_PUBLIC_API_URL for local testing. */
export const API_URL: string = process.env.EXPO_PUBLIC_API_URL ?? (Constants.expoConfig?.extra?.apiUrl as string);

const TOKEN_KEY = 'session-token';
let token: string | null = null;
let onSignedOut: (() => void) | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export async function loadToken() {
  token = await SecureStore.getItemAsync(TOKEN_KEY);
  return token;
}

export async function saveToken(t: string | null) {
  token = t;
  if (t) await SecureStore.setItemAsync(TOKEN_KEY, t);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export const sessionToken = () => token;

/** Called when the server says the session has ended (signed out elsewhere, expired). */
export function setSignedOutHandler(fn: () => void) {
  onSignedOut = fn;
}

type Options = { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; json?: unknown; form?: FormData };

/** Calls /api/v1{path} with the session token; throws ApiError with the server's message. */
export async function api<T = unknown>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (token) headers['x-session-token'] = token;
  if (opts.json !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      method: opts.method ?? (opts.json !== undefined || opts.form ? 'POST' : 'GET'),
      headers,
      body: opts.form ?? (opts.json !== undefined ? JSON.stringify(opts.json) : undefined),
    });
  } catch {
    throw new ApiError('No connection. Check your internet and try again.', 0);
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onSignedOut?.();
    const err = body?.error;
    throw new ApiError(err?.message ?? `Something went wrong (${res.status}).`, res.status, err?.code);
  }
  return body as T;
}

/** Headers for downloads made outside fetch (file downloads). */
export const authHeaders = (): Record<string, string> => (token ? { 'x-session-token': token } : {});
