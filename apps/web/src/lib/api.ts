export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message);
  }

  /** Human-readable list of problems returned with policy / validation errors. */
  get problems(): string[] {
    const d = this.details as { problems?: string[] } | { path: string; message: string }[] | undefined;
    if (Array.isArray(d)) return d.map((x) => (x.path ? `${x.path}: ${x.message}` : x.message));
    return d?.problems ?? [];
  }
}

const SIGNER_SESSION_KEY = 'ds_signer_session';

/**
 * Embedded signing runs in a third-party iframe where cookies may be blocked,
 * so its session is kept in sessionStorage and sent as a header instead.
 */
export function setSignerSession(token: string | null) {
  try {
    if (token) sessionStorage.setItem(SIGNER_SESSION_KEY, token);
    else sessionStorage.removeItem(SIGNER_SESSION_KEY);
  } catch {
    // Storage unavailable (private mode): the cookie path still works outside iframes
  }
}

export function signerSessionHeaders(): Record<string, string> {
  try {
    const token = typeof window !== 'undefined' ? sessionStorage.getItem(SIGNER_SESSION_KEY) : null;
    return token ? { 'X-Signer-Session': token } : {};
  } catch {
    return {};
  }
}

const ADDIN_SESSION_KEY = 'ds_addin_session';

/** Office add-ins on the web can't use cookies (cross-site iframe), so they keep a session token. */
export function setAddinSession(token: string | null) {
  try {
    if (token) localStorage.setItem(ADDIN_SESSION_KEY, token);
    else localStorage.removeItem(ADDIN_SESSION_KEY);
  } catch {
    // Storage unavailable: the add-in asks to sign in again
  }
}

function addinSessionHeaders(): Record<string, string> {
  try {
    const token = typeof window !== 'undefined' && window.location.pathname.startsWith('/office/') ? localStorage.getItem(ADDIN_SESSION_KEY) : null;
    return token ? { 'X-Session-Token': token } : {};
  } catch {
    return {};
  }
}

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const base = path.startsWith('/signing/') ? signerSessionHeaders() : addinSessionHeaders();
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...base, ...headers } : { ...base, ...headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const err = body?.error;
    throw new ApiError(res.status, err?.message ?? `Request failed (${res.status})`, err?.code, err?.details);
  }
  return body as T;
}

export function upload<T = unknown>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  return api<T>(path, { method: 'POST', body: form });
}

export const fileUrl = (path: string) => `/api/v1${path}`;
