'use client';

import Link from 'next/link';
import { useState } from 'react';
import { brand } from '@/lib/brand';
import { cx } from '../ui';
import { Icon, type IconName } from './Icons';

/** Interactive pieces of the home page: email start, feature tabs and the API code tabs. */

export function EmailStart({ dark = true, id = 'start-email' }: { dark?: boolean; id?: string }) {
  return (
    <div>
      <form action="/register" method="get" className="flex flex-col gap-2 sm:flex-row sm:gap-0">
        <label htmlFor={id} className="sr-only">
          Work email
        </label>
        <div className="relative w-full sm:flex-1">
          <Icon name="mail" className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            id={id}
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="Enter your work email"
            className="h-14 w-full rounded-lg border border-gray-200 bg-white pl-12 pr-4 text-[15px] text-ink placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-brand-400/30 sm:rounded-r-none"
          />
        </div>
        <button type="submit" className="inline-flex h-14 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-gold px-6 text-[15px] font-bold text-ink hover:brightness-105 sm:rounded-l-none">
          Get started free <Icon name="arrow" className="h-4 w-4" />
        </button>
      </form>
      <ul className={cx('mt-4 flex flex-wrap gap-x-6 gap-y-2 text-sm', dark ? 'text-gray-300' : 'text-gray-600')}>
        {['Free 14-day trial', 'No credit card required', 'Cancel anytime'].map((t) => (
          <li key={t} className="inline-flex items-center gap-1.5">
            <Icon name="check" className="h-4 w-4 text-brand-400" />
            {t}
          </li>
        ))}
      </ul>
    </div>
  );
}

// --- Features ------------------------------------------------------------------

type Category = 'sign' | 'organize' | 'automate' | 'ai' | 'developers' | 'security';

const CATEGORIES: { id: 'all' | Category; label: string }[] = [
  { id: 'all', label: 'All features' },
  { id: 'sign', label: 'Sign & send' },
  { id: 'organize', label: 'Organise' },
  { id: 'automate', label: 'Automate' },
  { id: 'ai', label: 'AI' },
  { id: 'developers', label: 'Developers' },
  { id: 'security', label: 'Security' },
];

const FEATURES: { category: Category; icon: IconName; title: string; body: string; href: string; featured?: boolean }[] = [
  { category: 'sign', icon: 'pen', title: 'E-sign & send', body: 'Get documents signed in minutes with a simple, secure signing experience for you and your recipients.', href: '/product', featured: true },
  { category: 'organize', icon: 'folder', title: 'Contract repository', body: 'Keep every agreement organised, searchable and accessible in one secure place.', href: '/solutions/legal', featured: true },
  { category: 'automate', icon: 'flow', title: 'Automated workflows', body: 'Route documents for approval, send reminders and keep deals moving automatically.', href: '/product', featured: true },
  { category: 'developers', icon: 'code', title: 'API & developer tools', body: `Build ${brand.name} into your product with the REST API, SDKs and signed webhooks.`, href: '/developers', featured: true },
  { category: 'ai', icon: 'sparkle', title: 'AI document insights', body: 'Summarise contracts, extract key terms and find critical information instantly.', href: '/solutions/legal', featured: true },
  { category: 'security', icon: 'shield', title: 'Enterprise-grade security', body: 'Encryption, a tamper-evident audit trail, single sign-on and data stored in India.', href: '/compliance', featured: true },
  { category: 'sign', icon: 'layers', title: 'Templates & bulk send', body: 'Save layouts with named roles and send one agreement or hundreds from a CSV.', href: '/product' },
  { category: 'sign', icon: 'cart', title: 'Payments while signing', body: 'Collect a deposit or the first invoice by UPI or card as part of signing.', href: '/solutions/sales' },
  { category: 'organize', icon: 'bell', title: 'Renewal reminders', body: 'Get reminded before contracts renew or notice periods start.', href: '/solutions/procurement' },
  { category: 'organize', icon: 'users', title: 'Teams & departments', body: 'Departments with their own agreements, managers and approval rules.', href: '/product' },
  { category: 'automate', icon: 'document', title: 'Documents from Word templates', body: 'Fill offer letters and contracts from your data, then send them for signature.', href: '/solutions/hr' },
  { category: 'automate', icon: 'check', title: 'Approvals before sending', body: 'Require a manager or legal approval before an agreement goes out.', href: '/solutions/procurement' },
  { category: 'ai', icon: 'pen', title: 'AI field detection', body: 'Suggests where signature, date and name fields go on your document.', href: '/product' },
  { category: 'ai', icon: 'globe', title: 'Ask the help centre', body: 'Answers to how-to questions in plain language, from our own guides.', href: '/help' },
  { category: 'developers', icon: 'box', title: 'Embedded signing', body: 'Let customers sign inside your app and choose where they land afterwards.', href: '/solutions/software' },
  { category: 'developers', icon: 'flow', title: 'Zapier & MCP', body: 'Connect thousands of apps without code, or let AI agents work with agreements.', href: '/partners' },
  { category: 'security', icon: 'idcard', title: 'Identity verification', body: 'Email, SMS and WhatsApp codes, PAN checks and Aadhaar eSign via licensed partners.', href: '/compliance' },
  { category: 'security', icon: 'lock', title: 'Sealed, verifiable PDFs', body: 'Every signed PDF carries a digital seal and trusted timestamp anyone can check.', href: '/verify' },
];

export function FeatureTabs() {
  const [tab, setTab] = useState<'all' | Category>('all');
  const shown = FEATURES.filter((f) => (tab === 'all' ? f.featured : f.category === tab));
  return (
    <div>
      <div className="flex flex-wrap justify-center gap-2" role="tablist" aria-label="Feature categories">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={tab === c.id}
            onClick={() => setTab(c.id)}
            className={cx('rounded-full px-5 py-2 text-sm font-medium transition', tab === c.id ? 'bg-gold font-semibold text-ink shadow-sm' : 'border border-gray-200 bg-white text-gray-600 hover:border-gray-300')}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3" role="tabpanel">
        {shown.map((f) => (
          <Link key={f.title} href={f.href} className="group relative flex gap-4 rounded-2xl border border-gray-200 bg-white p-6 transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-lg">
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-500 ring-1 ring-brand-100">
              <Icon name={f.icon} className="h-7 w-7" />
            </span>
            <div className="min-w-0">
              <h3 className="pr-6 font-bold text-ink">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-500">{f.body}</p>
              <span className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-brand-700">
                Learn more <Icon name="arrow" className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
              </span>
            </div>
            <span className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-full border border-gray-200 text-gray-400 group-hover:border-brand-300 group-hover:text-brand-600">
              <Icon name="arrow" className="h-3.5 w-3.5" />
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}

// --- API code tabs ---------------------------------------------------------------

const BASE = `https://${brand.domain}/api/v1`;

const SNIPPETS: Record<string, string> = {
  cURL: `curl -X POST ${BASE}/templates/$TEMPLATE_ID/envelopes \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "NDA",
    "send": true,
    "recipients": [
      { "roleId": "$SIGNER_ROLE", "name": "Sara Khan",
        "email": "sara@company.com" }
    ]
  }'`,
  'Node.js': `import { DocSign } from '@docsign/sdk';

const client = new DocSign({ apiKey: process.env.API_KEY, baseUrl: '${`https://${brand.domain}`}' });

const envelope = await client.templates.createEnvelope(templateId, {
  title: 'NDA',
  send: true,
  recipients: [{ roleId: signerRole, name: 'Sara Khan', email: 'sara@company.com' }],
});
console.log(envelope.status); // "SENT"`,
  Python: `import os
from docsign import DocSign

client = DocSign(api_key=os.environ["API_KEY"], base_url="https://${brand.domain}")

envelope = client.templates.create_envelope(
    template_id,
    recipients=[{"roleId": signer_role, "name": "Sara Khan", "email": "sara@company.com"}],
    send=True,
    title="NDA",
)
print(envelope["status"])  # "SENT"`,
  REST: `POST   /envelopes                     Create a draft
POST   /envelopes/{id}/documents      Upload a document
PUT    /envelopes/{id}/recipients     Set signers
POST   /envelopes/{id}/send           Send for signature
POST   /templates/{id}/envelopes      Create from a template
GET    /envelopes/{id}/audit          Audit trail
Webhooks: envelope.sent · viewed · signed · completed`,
};

export function CodeTabs() {
  const [tab, setTab] = useState('cURL');
  const [copied, setCopied] = useState(false);
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#0d0f1c] shadow-2xl shadow-black/40">
      <div className="flex items-center gap-1 border-b border-white/10 px-3 py-2">
        {Object.keys(SNIPPETS).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)} className={cx('rounded-md px-3 py-1 text-xs font-medium', tab === t ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-white')}>
            {t}
          </button>
        ))}
        <button
          type="button"
          onClick={() => {
            navigator.clipboard?.writeText(SNIPPETS[tab]).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          className="ml-auto text-xs text-gray-400 hover:text-white"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="h-64 overflow-auto p-5 text-[12px] leading-relaxed text-emerald-200/90">
        <code>{SNIPPETS[tab]}</code>
      </pre>
      <div className="m-3 flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 p-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold text-ink">
          <Icon name="code" className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-semibold text-white">Build, customise and scale</p>
          <p className="text-xs text-gray-400">REST API, signed webhooks, Node and Python SDKs, test-mode keys.</p>
        </div>
      </div>
    </div>
  );
}
