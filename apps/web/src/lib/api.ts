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

export async function api<T = unknown>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, headers, ...rest } = init;
  const res = await fetch(`/api/v1${path}`, {
    credentials: 'include',
    ...rest,
    headers: json !== undefined ? { 'Content-Type': 'application/json', ...headers } : headers,
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
