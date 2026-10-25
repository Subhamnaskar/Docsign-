'use client';

import Link from 'next/link';
import { useState } from 'react';
import { cx } from '../ui';
import { MOCKS, type MockId } from './Mocks';

interface FeatureCard {
  title: string;
  body: string;
  link: { href: string; label: string };
  mock: MockId;
}

const TABS: { id: string; label: string; cards: [FeatureCard, FeatureCard] }[] = [
  {
    id: 'featured',
    label: 'Featured',
    cards: [
      {
        title: 'Send, sign and track agreements',
        body: 'Get signatures from anyone on any device. Signers verify with a one-time code, follow guided fields and finish in minutes; you see every step as it happens.',
        link: { href: '/product', label: 'Explore eSignature' },
        mock: 'signing',
      },
      {
        title: 'Find and act on every agreement',
        body: 'Signed contracts land in a searchable repository. AI pulls out parties, values and dates, and reminds you before renewals and notice periods.',
        link: { href: '/solutions/legal', label: 'Explore the repository' },
        mock: 'repository',
      },
    ],
  },
  {
    id: 'sales',
    label: 'Sales',
    cards: [
      {
        title: 'Order forms that collect payment',
        body: 'Customers review, pay by UPI or card, and sign in one step. The signed PDF and payment receipt arrive together.',
        link: { href: '/solutions/sales', label: 'Explore sales' },
        mock: 'payment',
      },
      {
        title: 'Your CRM stays up to date',
        body: 'HubSpot and Salesforce get a note and the signed PDF the moment an agreement completes, without anyone copying files around.',
        link: { href: '/partners', label: 'See integrations' },
        mock: 'audit',
      },
    ],
  },
  {
    id: 'hr',
    label: 'Human resources',
    cards: [
      {
        title: 'Offer letters in minutes',
        body: 'Generate offer letters from a Word template with the details filled in, in the candidate’s language, and send them for signature in one step.',
        link: { href: '/solutions/hr', label: 'Explore HR' },
        mock: 'signing',
      },
      {
        title: 'Policies to the whole company',
        body: 'Send a policy acknowledgement to hundreds of employees from a CSV and watch the signatures come in.',
        link: { href: '/solutions/hr', label: 'See bulk send' },
        mock: 'bulk',
      },
    ],
  },
  {
    id: 'banking',
    label: 'Banking and lending',
    cards: [
      {
        title: 'Verify borrowers before they sign',
        body: 'PAN and bank account checks, Aadhaar eSign through licensed partners, and IT Act consent, all recorded in the audit trail.',
        link: { href: '/solutions/banking', label: 'Explore banking' },
        mock: 'verify',
      },
      {
        title: 'Evidence that holds up',
        body: 'A tamper-evident, hash-chained audit trail and a sealed PDF with a trusted timestamp that anyone can verify, years later.',
        link: { href: '/compliance', label: 'How compliance works' },
        mock: 'audit',
      },
    ],
  },
  {
    id: 'legal',
    label: 'Legal',
    cards: [
      {
        title: 'Understand contracts at a glance',
        body: 'AI summarises agreements and extracts the key terms, so you can find what matters without reading every page.',
        link: { href: '/solutions/legal', label: 'Explore legal' },
        mock: 'ai',
      },
      {
        title: 'The right signature for each law',
        body: 'The compliance engine picks the signature level, consent wording and retention for India, the US, the UK and the EU.',
        link: { href: '/compliance', label: 'See the compliance engine' },
        mock: 'verify',
      },
    ],
  },
  {
    id: 'developers',
    label: 'Developers',
    cards: [
      {
        title: 'Signing inside your product',
        body: 'Create agreements from templates with one API call, embed the signing page in your app and get signed webhooks for every step.',
        link: { href: '/developers', label: 'Read the API overview' },
        mock: 'code',
      },
      {
        title: 'Test before you go live',
        body: 'Test-mode API keys, Node and Python SDKs and an OpenAPI spec let you build and test without sending real agreements.',
        link: { href: '/solutions/software', label: 'Explore for software vendors' },
        mock: 'audit',
      },
    ],
  },
];

/** "View solutions" tabs with two feature cards each. */
export function HomeSolutions() {
  const [tab, setTab] = useState(TABS[0].id);
  const current = TABS.find((t) => t.id === tab)!;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-center gap-2" role="tablist" aria-label="View solutions">
        <span className="mr-2 hidden text-sm font-medium text-gray-600 sm:inline">View solutions</span>
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={cx('rounded-lg border px-4 py-2 text-sm font-medium transition', tab === t.id ? 'border-brand-200 bg-brand-100 text-ink' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300')}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="mt-10 grid gap-6 lg:grid-cols-2" role="tabpanel">
        {current.cards.map((c) => {
          const Mock = MOCKS[c.mock];
          return (
            <article key={c.title} className="flex flex-col overflow-hidden rounded-2xl bg-brand-50 ring-1 ring-brand-100">
              <div className="p-8 sm:p-10">
                <h3 className="text-2xl font-bold tracking-tight text-ink">{c.title}</h3>
                <p className="mt-4 text-[17px] leading-relaxed text-gray-600">{c.body}</p>
                <Link href={c.link.href} className="mt-6 inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-ink">
                  {c.link.label} <span aria-hidden>›</span>
                </Link>
              </div>
              <div className="mt-auto px-8 sm:px-10">
                <div className="translate-y-6">
                  <Mock />
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
