import type { ReactNode } from 'react';

/** Small illustrations of real product screens for the website's feature cards (decorative). */

function Window({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={`overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl ${className ?? ''}`} aria-hidden>
      <div className="flex items-center gap-1.5 border-b border-gray-100 bg-gray-50 px-3 py-2">
        <span className="h-2 w-2 rounded-full bg-gray-300" />
        <span className="h-2 w-2 rounded-full bg-gray-300" />
        <span className="h-2 w-2 rounded-full bg-gray-300" />
        <span className="ml-2 truncate text-[11px] font-medium text-gray-500">{title}</span>
      </div>
      <div className="p-4 text-[12px] text-gray-700">{children}</div>
    </div>
  );
}

const Lines = ({ widths }: { widths: number[] }) => (
  <div className="space-y-1.5">
    {widths.map((w, i) => (
      <div key={i} className="h-1.5 rounded bg-gray-100" style={{ width: `${w}%` }} />
    ))}
  </div>
);

export function SigningMock() {
  return (
    <Window title="Mutual NDA · 2 of 3 signed">
      <Lines widths={[100, 94, 97, 70]} />
      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="rounded-lg border-2 border-brand-400 bg-brand-50 p-2">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-brand-700">Signed · Priya S.</div>
          <svg viewBox="0 0 120 30" className="mt-1 h-6 w-full text-[#1d1a4d]">
            <path d="M4 22c10-2 14-16 22-16s2 14 10 14 8-9 14-9 4 7 10 7 10-5 16-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </div>
        <div className="rounded-lg border-2 border-dashed border-amber-400 bg-amber-50 p-2">
          <div className="text-[9px] font-semibold uppercase tracking-wide text-amber-800">Sign here · Daniel M.</div>
          <div className="mt-2 h-5 rounded bg-amber-100" />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 px-3 py-2">
        <span className="font-medium">Next field</span>
        <span className="rounded-md bg-gold px-2 py-1 text-[10px] font-bold text-ink">Finish signing</span>
      </div>
    </Window>
  );
}

export function RepositoryMock() {
  const rows = [
    ['Acme supply agreement', '₹18,40,000', 'Renews 12 Jan', 'text-amber-700'],
    ['Office lease, Pune', '₹2,10,000/mo', 'Notice by 3 Mar', 'text-red-700'],
    ['Cloud services MSA', '$48,000', 'Renews 30 Jun', 'text-gray-600'],
    ['Distributor contract', '₹6,25,000', 'Ends 15 Aug', 'text-gray-600'],
  ];
  return (
    <Window title="Repository · 4 contracts need attention">
      <div className="mb-2 flex items-center gap-2 rounded-md border border-gray-200 px-2 py-1.5 text-gray-400">⌕ Search contracts, parties, values</div>
      <table className="w-full">
        <tbody className="divide-y divide-gray-100">
          {rows.map(([name, value, when, tone]) => (
            <tr key={name}>
              <td className="py-1.5 font-medium text-ink">{name}</td>
              <td className="py-1.5 text-right tabular-nums">{value}</td>
              <td className={`py-1.5 pl-2 text-right ${tone}`}>{when}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Window>
  );
}

export function WorkflowMock() {
  const Step = ({ icon, title, note }: { icon: string; title: string; note: string }) => (
    <div className="w-40 rounded-xl border border-gray-200 bg-white p-3 shadow-lg">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-gold text-sm">{icon}</span>
      <p className="mt-2 text-[13px] font-semibold text-ink">{title}</p>
      <p className="text-[11px] text-gray-500">{note}</p>
    </div>
  );
  return (
    <div className="relative flex flex-col items-center gap-6" aria-hidden>
      <Step icon="📄" title="Generate document" note="From a Word template" />
      <div className="absolute left-1/2 top-[92px] h-6 w-px bg-brand-300" />
      <div className="flex gap-4">
        <Step icon="✅" title="Approve" note="Manager signs off" />
        <Step icon="✍️" title="Sign" note="In the right order" />
      </div>
    </div>
  );
}

export function CodeMock() {
  return (
    <pre className="overflow-hidden rounded-xl bg-night p-5 text-[12px] leading-relaxed text-gray-300 shadow-xl" aria-hidden>
      <code>
        <span className="text-brand-300">const</span> envelope = <span className="text-brand-300">await</span> client.envelopes.<span className="text-emerald-300">fromTemplate</span>({'{'}
        {'\n'}  templateId: <span className="text-amber-200">&apos;offer-letter&apos;</span>,{'\n'}  send: <span className="text-brand-300">true</span>,{'\n'}  recipients: [{'{'}
        {'\n'}    role: <span className="text-amber-200">&apos;Candidate&apos;</span>,{'\n'}    email: <span className="text-amber-200">&apos;asha@example.com&apos;</span>,{'\n'}    locale: <span className="text-amber-200">&apos;hi&apos;</span>,{'\n'}  {'}'}],{'\n'}
        {'}'});{'\n\n'}
        <span className="text-gray-500">{'// webhook: envelope.completed → signed PDF'}</span>
      </code>
    </pre>
  );
}

export function AiMock() {
  return (
    <Window title="AI summary · Services agreement.pdf">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Extracted terms</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
        {[
          ['Parties', 'Kaveri Textiles, Acme Supplies'],
          ['Value', '₹18,40,000 per year'],
          ['Term', '24 months, auto-renews'],
          ['Notice', '60 days before renewal'],
        ].map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-gray-500">{k}</dt>
            <dd className="font-medium text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11px] text-amber-900">Renewal reminder set for 1 Nov</div>
    </Window>
  );
}

export function VerifyMock() {
  return (
    <Window title="Signer verification">
      {[
        ['Email code', 'Verified'],
        ['PAN check', 'Name matches'],
        ['Aadhaar eSign', 'Signed via licensed partner'],
        ['Consent', 'IT Act 2000 wording recorded'],
      ].map(([k, v]) => (
        <div key={k} className="flex items-center justify-between border-b border-gray-100 py-1.5 last:border-0">
          <span className="font-medium text-ink">{k}</span>
          <span className="flex items-center gap-1 text-emerald-700">
            <span aria-hidden>✓</span> {v}
          </span>
        </div>
      ))}
    </Window>
  );
}

export function PaymentMock() {
  return (
    <Window title="Order form · pay and sign">
      <div className="flex items-baseline justify-between">
        <span className="font-medium text-ink">Annual subscription</span>
        <span className="text-lg font-bold text-ink">₹59,000</span>
      </div>
      <p className="text-[11px] text-gray-500">incl. 18% GST</p>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
        {['UPI', 'Card', 'Net banking'].map((m, i) => (
          <span key={m} className={`rounded-md border px-2 py-1.5 ${i === 0 ? 'border-brand-400 bg-brand-50 font-semibold text-brand-700' : 'border-gray-200'}`}>
            {m}
          </span>
        ))}
      </div>
      <div className="mt-3 rounded-md bg-gold py-2 text-center text-[12px] font-bold text-ink">Pay and sign</div>
    </Window>
  );
}

export function BulkMock() {
  return (
    <Window title="Bulk send · policy-update.csv">
      <table className="w-full">
        <tbody className="divide-y divide-gray-100">
          {[
            ['Ananya Rao', 'Signed'],
            ['Vikram Shah', 'Signed'],
            ['Fatima Khan', 'Viewed'],
            ['Rohan Das', 'Sent'],
          ].map(([n, s]) => (
            <tr key={n}>
              <td className="py-1.5 font-medium text-ink">{n}</td>
              <td className={`py-1.5 text-right ${s === 'Signed' ? 'text-emerald-700' : 'text-gray-500'}`}>{s}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full w-1/2 rounded-full bg-gold" />
      </div>
      <p className="mt-1 text-[11px] text-gray-500">212 of 420 signed</p>
    </Window>
  );
}

export function AuditMock() {
  return (
    <Window title="Audit trail · hash chain intact">
      {[
        ['Sent to Priya S.', '10:02'],
        ['Email code verified', '10:14'],
        ['Consent recorded', '10:14'],
        ['Signed', '10:16'],
        ['Sealed with timestamp', '10:16'],
      ].map(([e, t]) => (
        <div key={e} className="flex items-center gap-2 py-1">
          <span className="h-1.5 w-1.5 rounded-full bg-brand-500" />
          <span className="flex-1 text-ink">{e}</span>
          <span className="tabular-nums text-gray-400">{t}</span>
        </div>
      ))}
    </Window>
  );
}

export const MOCKS = {
  signing: SigningMock,
  repository: RepositoryMock,
  ai: AiMock,
  verify: VerifyMock,
  payment: PaymentMock,
  bulk: BulkMock,
  audit: AuditMock,
  code: CodeMock,
} as const;
export type MockId = keyof typeof MOCKS;
