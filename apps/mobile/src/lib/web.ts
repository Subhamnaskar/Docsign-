import type { useRouter } from 'expo-router';
import { API_URL, api } from './api';

type Router = ReturnType<typeof useRouter>;

/**
 * Opens a page of the website inside the app, already signed in (placing
 * fields, signing your own document). `watch` is an agreement id: the screen
 * follows it and offers to go back to it in the app.
 */
export async function openWebPage(router: Router, next: string, opts: { title: string; watch?: string; replace?: boolean }) {
  const { path } = await api<{ path: string }>('/mobile/web-session', { json: { next } });
  const route = { pathname: '/web' as const, params: { url: `${API_URL}${path}`, title: opts.title, ...(opts.watch ? { watch: opts.watch } : {}) } };
  if (opts.replace) router.replace(route);
  else router.push(route);
}

/** Signing links need no app session: the signing page has its own checks. */
export function openSigningPage(router: Router, url: string, title: string) {
  router.push({ pathname: '/web', params: { url, title } });
}
