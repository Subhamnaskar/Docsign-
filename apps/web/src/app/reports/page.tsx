'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AppShell } from '@/components/AppShell';
import { ChartCard, HBars, Legend, LineChart, ORDINAL_BLUE, SERIES } from '@/components/charts';
import { Alert, Card, cx, PageLoader } from '@/components/ui';
import { api } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface Report {
  days: number;
  totals: { sent: number; completed: number; completionRate: number | null; medianHours: number | null; p90Hours: number | null; outstanding: number };
  weekly: { week: string; sent: number; completed: number }[];
  funnel: { invited: number; opened: number; verified: number; signed: number };
  statusCounts: Record<string, number>;
  bySender: { name: string; email: string; sent: number; completed: number; medianHours: number | null }[];
  declines: { envelopeId: string; title: string; signer: string; reason: string | null; at: string | null }[];
}

const RANGES = [30, 90, 180, 365];
const STATUS_LABELS: Record<string, string> = { SENT: 'Out for signature', COMPLETED: 'Completed', DECLINED: 'Declined', VOIDED: 'Voided', EXPIRED: 'Expired' };

function duration(hours: number | null): string {
  if (hours === null) return '—';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours * 10) / 10} h`;
  return `${Math.round((hours / 24) * 10) / 10} days`;
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const shortDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

function Tile({ label, value, caption }: { label: string; value: string; caption?: string }) {
  return (
    <Card className="p-4">
      <div className="text-sm text-gray-500">{label}</div>
      <div className="mt-1 text-3xl font-semibold tabular-nums text-gray-900">{value}</div>
      {caption && <div className="mt-1 text-xs text-gray-500">{caption}</div>}
    </Card>
  );
}

function Table({ head, rows }: { head: string[]; rows: (string | number)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs uppercase tracking-wide text-gray-400">
          <tr>
            {head.map((h, i) => (
              <th key={h} className={cx('py-2 font-medium', i > 0 && 'text-right')}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((r, ri) => (
            <tr key={ri}>
              {r.map((c, ci) => (
                <td key={ci} className={cx('py-2', ci > 0 ? 'text-right tabular-nums' : 'text-gray-700')}>
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Reports() {
  const [days, setDays] = useState(90);
  const [data, setData] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    api<Report>(`/reports?days=${days}`)
      .then(setData)
      .catch((e) => setError(e.message));
  }, [days]);

  const f = data?.funnel;
  const funnelRows = f
    ? [
        { label: 'Invited', value: f.invited },
        { label: 'Opened link', value: f.opened },
        { label: 'Verified', value: f.verified },
        { label: 'Signed', value: f.signed },
      ].map((r) => ({ ...r, note: f.invited ? `${Math.round((r.value / f.invited) * 100)}% of invited` : undefined }))
    : [];
  const statusRows = data ? Object.entries(STATUS_LABELS).map(([k, label]) => ({ label, value: data.statusCounts[k] ?? 0 })) : [];

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-gray-500">How agreements move from sent to signed.</p>
        </div>
        <div className="flex rounded-lg bg-white p-1 text-sm shadow-sm ring-1 ring-gray-200" role="group" aria-label="Time range">
          {RANGES.map((r) => (
            <button key={r} onClick={() => setDays(r)} className={cx('rounded-md px-3 py-1.5 font-medium', days === r ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50')}>
              {r === 365 ? '1 year' : `${r} days`}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {!data ? (
        <PageLoader />
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Tile label="Sent" value={String(data.totals.sent)} caption={`${data.totals.outstanding} still out for signature`} />
            <Tile label="Completed" value={String(data.totals.completed)} />
            <Tile label="Completion rate" value={pct(data.totals.completionRate)} caption="Of sent agreements that reached an outcome" />
            <Tile label="Median time to complete" value={duration(data.totals.medianHours)} caption={data.totals.p90Hours !== null ? `90% within ${duration(data.totals.p90Hours)}` : undefined} />
          </div>

          <div className="mt-6">
            <ChartCard
              title="Weekly volume"
              subtitle="Agreements sent and completed per week"
              legend={<Legend items={[{ label: 'Sent', color: SERIES[0] }, { label: 'Completed', color: SERIES[1] }]} />}
              chart={
                <LineChart
                  data={data.weekly.map((w) => ({ x: w.week, values: [w.sent, w.completed] }))}
                  series={[{ label: 'Sent', color: SERIES[0] }, { label: 'Completed', color: SERIES[1] }]}
                  formatX={shortDate}
                />
              }
              table={<Table head={['Week of', 'Sent', 'Completed']} rows={data.weekly.map((w) => [shortDate(w.week), w.sent, w.completed])} />}
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <ChartCard
              title="Signer drop-off"
              subtitle="Everyone asked to sign or approve in this period"
              chart={<HBars rows={funnelRows} colors={ORDINAL_BLUE} />}
              table={<Table head={['Step', 'People', 'Share']} rows={funnelRows.map((r) => [r.label, r.value, r.note ?? '—'])} />}
            />
            <ChartCard
              title="Outcomes"
              subtitle="Current status of agreements sent in this period"
              chart={<HBars rows={statusRows} colors={[SERIES[0]]} />}
              table={<Table head={['Status', 'Agreements']} rows={statusRows.map((r) => [r.label, r.value])} />}
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
            <Card className="p-5">
              <h2 className="font-semibold">By sender</h2>
              <div className="mt-3">
                {data.bySender.length === 0 ? (
                  <p className="text-sm text-gray-500">Nothing sent in this period.</p>
                ) : (
                  <Table
                    head={['Sender', 'Sent', 'Completed', 'Median time']}
                    rows={data.bySender.map((s) => [s.name, s.sent, s.completed, duration(s.medianHours)])}
                  />
                )}
              </div>
            </Card>
            <Card className="p-5">
              <h2 className="font-semibold">Recent declines</h2>
              {data.declines.length === 0 ? (
                <p className="mt-3 text-sm text-gray-500">No declines in this period.</p>
              ) : (
                <ul className="mt-3 divide-y divide-gray-100 text-sm">
                  {data.declines.map((d, i) => (
                    <li key={i} className="py-2.5">
                      <Link href={`/envelopes/${d.envelopeId}`} className="font-medium text-gray-900 hover:underline">
                        {d.title}
                      </Link>
                      <div className="text-gray-600">&ldquo;{d.reason ?? 'No reason given'}&rdquo;</div>
                      <div className="text-xs text-gray-400">
                        {d.signer} · {formatDate(d.at)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}

export default function ReportsPage() {
  return (
    <AppShell>
      <Reports />
    </AppShell>
  );
}
