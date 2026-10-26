'use client';

import Script from 'next/script';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Input, Label, Logo, Spinner } from '@/components/ui';
import { api, setAddinSession, upload } from '@/lib/api';
import type { Me } from '@/lib/types';

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const Office: any;

interface Attachment {
  id: string;
  name: string;
  size: number;
}

const OFFICE_EXT = /\.(pdf|docx?|xlsx?|pptx?|odt|rtf|txt)$/i;

/** Reads the open Word document as PDF, slice by slice. */
function wordAsPdf(): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    Office.context.document.getFileAsync(Office.FileType.Pdf, { sliceSize: 4 * 1024 * 1024 }, (res: any) => {
      if (res.status !== Office.AsyncResultStatus.Succeeded) return reject(new Error(res.error?.message ?? 'Could not read the document'));
      const file = res.value;
      const parts: Uint8Array[] = [];
      const next = (i: number) => {
        if (i >= file.sliceCount) {
          file.closeAsync();
          const total = parts.reduce((n, p) => n + p.length, 0);
          const out = new Uint8Array(total);
          let off = 0;
          for (const p of parts) {
            out.set(p, off);
            off += p.length;
          }
          return resolve(out);
        }
        file.getSliceAsync(i, (s: any) => {
          if (s.status !== Office.AsyncResultStatus.Succeeded) {
            file.closeAsync();
            return reject(new Error(s.error?.message ?? 'Could not read the document'));
          }
          parts.push(new Uint8Array(s.value.data));
          next(i + 1);
        });
      };
      next(0);
    });
  });
}

function attachmentBytes(id: string): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    Office.context.mailbox.item.getAttachmentContentAsync(id, (res: any) => {
      if (res.status !== Office.AsyncResultStatus.Succeeded) return reject(new Error(res.error?.message ?? 'Could not read the attachment'));
      if (res.value.format !== Office.MailboxEnums.AttachmentContentFormat.Base64) return reject(new Error('This attachment type is not supported'));
      const bin = atob(res.value.content);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      resolve(bytes);
    });
  });
}

/**
 * Word and Outlook task pane. Word: send the open document. Outlook: send an
 * attachment of the open message, with its sender as the first signer.
 * Uses the normal Nuronix eSign session (the pane runs on this site's own origin).
 */
export default function OfficeTaskpane() {
  const [ready, setReady] = useState(false);
  const [host, setHost] = useState<'word' | 'outlook' | 'browser'>('browser');
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [title, setTitle] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [chosen, setChosen] = useState<string>('');
  const [signer, setSigner] = useState<{ name: string; email: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const onOffice = useCallback(() => {
    if (typeof Office === 'undefined') return setReady(true);
    Office.onReady((info: { host: string }) => {
      if (info.host === Office.HostType.Word) {
        setHost('word');
        try {
          const url: string = Office.context.document.url ?? '';
          setTitle(decodeURIComponent(url.split(/[\\/]/).pop() ?? '').replace(/\.[^.]+$/, '') || 'Untitled agreement');
        } catch {
          setTitle('Untitled agreement');
        }
      } else if (info.host === Office.HostType.Outlook) {
        setHost('outlook');
        const item = Office.context.mailbox.item;
        const files = (item.attachments ?? []).filter((a: any) => !a.isInline && OFFICE_EXT.test(a.name)).map((a: any) => ({ id: a.id, name: a.name, size: a.size }));
        setAttachments(files);
        setChosen(files[0]?.id ?? '');
        setTitle(item.subject || 'Untitled agreement');
        if (item.from) setSigner({ name: item.from.displayName || item.from.emailAddress, email: item.from.emailAddress });
      }
      setReady(true);
    });
  }, []);

  const loadMe = useCallback(() => {
    api<Me>('/auth/me')
      .then(setMe)
      .catch(() => setMe(null));
  }, []);
  useEffect(loadMe, [loadMe]);

  /** Sign in through a top-level dialog and keep the session token it returns. */
  function signIn() {
    if (typeof Office === 'undefined' || !Office.context?.ui?.displayDialogAsync) {
      window.location.assign(`/login?next=${encodeURIComponent('/office/taskpane?host=' + host)}`);
      return;
    }
    Office.context.ui.displayDialogAsync(`${window.location.origin}/office/connect`, { height: 60, width: 30 }, (res: any) => {
      if (res.status !== Office.AsyncResultStatus.Succeeded) return setError('Could not open the sign-in window.');
      const dialog = res.value;
      dialog.addEventHandler(Office.EventType.DialogMessageReceived, (arg: { message: string }) => {
        dialog.close();
        try {
          setAddinSession(JSON.parse(arg.message).token);
          loadMe();
        } catch {
          setError('Sign-in did not complete.');
        }
      });
    });
  }

  async function send() {
    setBusy(true);
    setError(null);
    try {
      let bytes: Uint8Array;
      let filename: string;
      if (host === 'word') {
        bytes = await wordAsPdf();
        filename = `${title || 'document'}.pdf`;
      } else {
        const a = attachments.find((x) => x.id === chosen);
        if (!a) throw new Error('Choose an attachment.');
        bytes = await attachmentBytes(a.id);
        filename = a.name;
      }
      const env = await api<{ id: string }>('/envelopes', { method: 'POST', json: { title: title.trim() || 'Untitled agreement' } });
      await upload(`/envelopes/${env.id}/documents`, new File([new Uint8Array(bytes)], filename));
      if (signer) await api(`/envelopes/${env.id}/recipients`, { method: 'PUT', json: [{ name: signer.name, email: signer.email }] });
      const url = `${window.location.origin}/envelopes/${env.id}/edit`;
      setDone(url);
      // Finish in the full editor (fields, review, send)
      if (typeof Office !== 'undefined' && Office.context?.ui?.openBrowserWindow) Office.context.ui.openBrowserWindow(url);
      else window.open(url, '_blank');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-white p-4 text-sm">
      <Script src="https://appsforoffice.microsoft.com/lib/1/hosted/office.js" strategy="afterInteractive" onLoad={onOffice} onError={() => setReady(true)} />
      <Logo className="text-gray-900" />
      {!ready || me === undefined ? (
        <div className="flex justify-center py-12 text-brand-600"><Spinner /></div>
      ) : me === null ? (
        <div className="mt-6 space-y-3">
          <p className="text-gray-600">Sign in to Nuronix eSign to send documents for signature.</p>
          {error && <Alert>{error}</Alert>}
          <Button onClick={signIn}>Sign in</Button>
        </div>
      ) : host === 'browser' ? (
        <div className="mt-6 space-y-2 text-gray-600">
          <p>This page runs inside Word or Outlook. Add Nuronix eSign to Office with one of these manifests:</p>
          <ul className="list-disc pl-5">
            <li><a className="text-brand-700 underline" href="/office/manifest-word.xml">Word add-in manifest</a></li>
            <li><a className="text-brand-700 underline" href="/office/manifest-outlook.xml">Outlook add-in manifest</a></li>
          </ul>
        </div>
      ) : done ? (
        <div className="mt-6 space-y-3">
          <Alert tone="success" title="Draft created">Finish adding signers and fields in Nuronix eSign, then send.</Alert>
          <a href={done} target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline">Open the agreement</a>
          <Button variant="secondary" size="sm" onClick={() => setDone(null)}>Send another</Button>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {error && <Alert>{error}</Alert>}
          <div>
            <Label htmlFor="op-title">Agreement title</Label>
            <Input id="op-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          {host === 'outlook' &&
            (attachments.length ? (
              <div>
                <Label>Attachment</Label>
                {attachments.map((a) => (
                  <label key={a.id} className="flex items-center gap-2 py-1">
                    <input type="radio" name="att" checked={chosen === a.id} onChange={() => setChosen(a.id)} />
                    <span className="truncate">{a.name}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="text-gray-600">This email has no document attachments.</p>
            ))}
          {signer && <p className="text-gray-600">First signer: <strong>{signer.name}</strong> ({signer.email}). You can change this in the editor.</p>}
          <Button className="w-full" onClick={send} loading={busy} disabled={host === 'outlook' && !chosen}>
            {host === 'word' ? 'Send this document for signature' : 'Send attachment for signature'}
          </Button>
          <p className="text-xs text-gray-500">
            Signed in as {me.user?.email ?? me.organization.name}.{' '}
            <button className="underline" onClick={() => { setAddinSession(null); setMe(null); }}>Sign out</button>
          </p>
        </div>
      )}
    </div>
  );
}
