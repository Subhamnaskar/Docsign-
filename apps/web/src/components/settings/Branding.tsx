'use client';

import { useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Label } from '@/components/ui';
import { api, upload } from '@/lib/api';

interface Branding {
  name: string;
  color: string | null;
  logoUrl: string | null;
}

const DEFAULT_COLOR = '#4f46e5';

/** Logo and colour shown to signers in emails and on the signing page. */
export function BrandingSettings() {
  const [b, setB] = useState<Branding | null>(null);
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api<Branding>('/organization/branding').then((x) => {
      setB(x);
      setColor(x.color ?? DEFAULT_COLOR);
    });
  }, []);

  async function run(fn: () => Promise<Branding | unknown>) {
    setError(null);
    setSaved(false);
    try {
      await fn();
      setB(await api<Branding>('/organization/branding'));
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Branding</h2>
      <p className="mt-1 text-sm text-gray-500">Signers see your logo and colour in emails and on the signing page.</p>
      {error && (
        <div className="mt-3">
          <Alert>{error}</Alert>
        </div>
      )}
      <div className="mt-4 grid gap-6 md:grid-cols-[1fr_280px]">
        <div className="space-y-4">
          <div>
            <Label>Logo</Label>
            <p className="mb-2 text-xs text-gray-500">PNG or JPG, up to 512 KB. A wide logo around 400×100 px works best.</p>
            <div className="flex flex-wrap items-center gap-3">
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) run(() => upload('/organization/logo', f));
                }}
                className="text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700"
              />
              {b?.logoUrl && (
                <Button size="sm" variant="ghost" className="text-red-600" onClick={() => run(() => api('/organization/logo', { method: 'DELETE' }))}>
                  Remove logo
                </Button>
              )}
            </div>
          </div>
          <div>
            <Label htmlFor="brand-color">Brand colour</Label>
            <div className="flex items-center gap-2">
              <input id="brand-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} className="h-10 w-14 cursor-pointer rounded border border-gray-300" />
              <Input className="w-32 font-mono" value={color} onChange={(e) => setColor(e.target.value)} maxLength={7} aria-label="Hex colour" />
              <Button
                variant="secondary"
                disabled={!/^#[0-9a-fA-F]{6}$/.test(color)}
                onClick={() => run(() => api('/organization', { method: 'PATCH', json: { brandColor: color } }))}
              >
                Save colour
              </Button>
            </div>
          </div>
          {saved && <p className="text-sm text-green-700">Saved</p>}
        </div>
        <div>
          <Label>Preview</Label>
          <div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
            <div className="rounded-lg bg-white p-4 shadow-sm">
              {b?.logoUrl ? (
                <img src={b.logoUrl} alt="Logo" className="max-h-10 max-w-[200px]" />
              ) : (
                <div className="text-lg font-bold" style={{ color }}>
                  {b?.name}
                </div>
              )}
              <div className="mt-3 h-2 w-3/4 rounded bg-gray-100" />
              <div className="mt-2 h-2 w-1/2 rounded bg-gray-100" />
              <span className="mt-4 inline-block rounded-md px-3 py-1.5 text-xs font-semibold text-white" style={{ background: color }}>
                Review and sign
              </span>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
