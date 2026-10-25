/**
 * Browser pickers for Google Drive, Dropbox and OneDrive. Each resolves to the
 * request body for POST /envelopes/:id/documents/cloud, or null if cancelled.
 * The provider scripts are loaded on first use.
 */

export interface CloudConfig {
  google: { clientId: string; apiKey: string; appId: string } | null;
  dropbox: { appKey: string } | null;
  onedrive: { clientId: string } | null;
}

export type CloudPick =
  | { provider: 'google'; fileId: string; accessToken: string }
  | { provider: 'dropbox' | 'onedrive'; url: string; name?: string };

const EXTENSIONS = ['.pdf', '.doc', '.docx', '.odt', '.rtf', '.txt', '.xls', '.xlsx', '.ods', '.ppt', '.pptx', '.odp'];

const loaded = new Map<string, Promise<void>>();
function loadScript(src: string, attrs: Record<string, string> = {}): Promise<void> {
  if (!loaded.has(src)) {
    loaded.set(
      src,
      new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        for (const [k, v] of Object.entries(attrs)) s.setAttribute(k, v);
        s.onload = () => resolve();
        s.onerror = () => {
          loaded.delete(src);
          reject(new Error(`Could not load ${new URL(src).hostname}. Check your connection or ad blocker.`));
        };
        document.head.appendChild(s);
      }),
    );
  }
  return loaded.get(src)!;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const w = () => window as any;

export async function pickFromDropbox(cfg: NonNullable<CloudConfig['dropbox']>): Promise<CloudPick | null> {
  await loadScript('https://www.dropbox.com/static/api/2/dropins.js', { id: 'dropboxjs', 'data-app-key': cfg.appKey });
  return new Promise((resolve) => {
    w().Dropbox.choose({
      linkType: 'direct',
      multiselect: false,
      extensions: EXTENSIONS,
      success: (files: { link: string; name: string }[]) => resolve({ provider: 'dropbox', url: files[0].link, name: files[0].name }),
      cancel: () => resolve(null),
    });
  });
}

export async function pickFromOneDrive(cfg: NonNullable<CloudConfig['onedrive']>): Promise<CloudPick | null> {
  await loadScript('https://js.live.net/v7.2/OneDrive.js');
  return new Promise((resolve, reject) => {
    w().OneDrive.open({
      clientId: cfg.clientId,
      action: 'download',
      multiSelect: false,
      advanced: { redirectUri: `${window.location.origin}/onedrive-picker`, filter: EXTENSIONS.join(',') },
      success: (res: { value: Record<string, string>[] }) => {
        const f = res.value[0];
        resolve({ provider: 'onedrive', url: f['@microsoft.graph.downloadUrl'], name: f.name });
      },
      cancel: () => resolve(null),
      error: (e: unknown) => reject(new Error(`OneDrive: ${(e as Error)?.message ?? 'picker failed'}`)),
    });
  });
}

let googleToken: { value: string; expires: number } | null = null;

export async function pickFromGoogleDrive(cfg: NonNullable<CloudConfig['google']>): Promise<CloudPick | null> {
  await Promise.all([loadScript('https://accounts.google.com/gsi/client'), loadScript('https://apis.google.com/js/api.js')]);
  await new Promise<void>((r) => w().gapi.load('picker', () => r()));
  if (!googleToken || googleToken.expires < Date.now() + 60_000) {
    googleToken = await new Promise((resolve, reject) => {
      // drive.file: access only to files the user picks
      const client = w().google.accounts.oauth2.initTokenClient({
        client_id: cfg.clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        callback: (r: { access_token?: string; expires_in?: number; error?: string }) =>
          r.access_token ? resolve({ value: r.access_token, expires: Date.now() + (r.expires_in ?? 3600) * 1000 }) : reject(new Error(r.error ?? 'Google sign-in was cancelled')),
      });
      client.requestAccessToken();
    });
  }
  const token = googleToken!.value;
  const g = w().google.picker;
  return new Promise((resolve) => {
    const view = new g.DocsView(g.ViewId.DOCS).setIncludeFolders(true).setSelectFolderEnabled(false);
    new g.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(cfg.apiKey)
      .setAppId(cfg.appId)
      .setCallback((data: { action: string; docs?: { id: string }[] }) => {
        if (data.action === g.Action.PICKED && data.docs?.[0]) resolve({ provider: 'google', fileId: data.docs[0].id, accessToken: token });
        if (data.action === g.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}
