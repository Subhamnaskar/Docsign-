'use client';

import { useEffect, useState } from 'react';
import { Card, cx } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';
import type { Recipient } from '@/lib/types';

interface Check {
  id: string;
  recipientId: string;
  kind: 'PAN' | 'BANK' | 'DIGILOCKER' | 'VIDEO';
  provider: string;
  status: 'PASSED' | 'FAILED';
  nameMatch: number | null;
  data: Record<string, string | number | boolean | null>;
  hasRecording: boolean;
  createdAt: string;
}

const KIND: Record<Check['kind'], string> = { PAN: 'PAN', BANK: 'Bank account', DIGILOCKER: 'Aadhaar (DigiLocker)', VIDEO: 'Video selfie' };

function details(c: Check): string {
  const d = c.data;
  if (c.kind === 'PAN') return [d.pan, d.registeredName && `registered to ${d.registeredName}`].filter(Boolean).join(' · ');
  if (c.kind === 'BANK') return [d.account, d.ifsc, d.nameAtBank && `holder ${d.nameAtBank}`].filter(Boolean).join(' · ');
  if (c.kind === 'DIGILOCKER') return [d.aadhaarName, d.aadhaar, d.yearOfBirth && `born ${d.yearOfBirth}`].filter(Boolean).join(' · ');
  return d.challenge ? `Read out "${d.challenge}"` : '';
}

/** Identity check outcomes per recipient, with video recordings, for the sender. */
export function KycResults({ envelopeId, recipients }: { envelopeId: string; recipients: Recipient[] }) {
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  useEffect(() => {
    api<Check[]>(`/envelopes/${envelopeId}/kyc`).then(setChecks).catch(() => setChecks([]));
  }, [envelopeId]);
  const required = recipients.filter((r) => r.idChecks?.length);
  if (!required.length) return null;

  return (
    <Card className="p-5">
      <h2 className="font-semibold">Identity checks</h2>
      <div className="mt-3 space-y-4">
        {required.map((r) => {
          const mine = (checks ?? []).filter((c) => c.recipientId === r.id);
          return (
            <div key={r.id}>
              <div className="text-sm font-medium">{r.name}</div>
              <ul className="mt-1 divide-y divide-gray-100 rounded-lg border border-gray-200 text-sm">
                {r.idChecks!.map((kind) => {
                  const attempts = mine.filter((c) => c.kind === kind);
                  const last = attempts[attempts.length - 1];
                  return (
                    <li key={kind} className="px-3 py-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-medium">{KIND[kind]}</span>
                        <span
                          className={cx(
                            'rounded-full px-2 py-0.5 text-xs font-medium',
                            last?.status === 'PASSED' ? 'bg-green-50 text-green-700' : last ? 'bg-red-50 text-red-700' : 'bg-gray-100 text-gray-500',
                          )}
                        >
                          {last?.status === 'PASSED' ? 'Passed' : last ? 'Failed' : 'Not done yet'}
                        </span>
                      </div>
                      {last && (
                        <div className="mt-0.5 text-xs text-gray-500">
                          {details(last)}
                          {last.nameMatch !== null && ` · name match ${last.nameMatch}%`} · {formatDate(last.createdAt)}
                          {attempts.length > 1 && ` · ${attempts.length} attempts`}
                          {last.provider === 'sandbox' && ' · sandbox'}
                        </div>
                      )}
                      {last?.hasRecording && (
                        <div className="mt-2">
                          {playing === last.id ? (
                            <video controls autoPlay className="w-full max-w-sm rounded-lg bg-black" src={`/api/v1/envelopes/${envelopeId}/kyc/${last.id}/recording`} />
                          ) : (
                            <button className="text-xs font-medium text-brand-700 hover:underline" onClick={() => setPlaying(last.id)}>
                              Watch recording
                            </button>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
