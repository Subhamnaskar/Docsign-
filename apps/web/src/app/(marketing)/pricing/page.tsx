import type { Metadata } from 'next';
import Link from 'next/link';
import { Check, CtaBand, PageHero, Section } from '@/components/marketing/Site';
import { cx } from '@/lib/cx';
import { apiPricing, plans } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Plans for teams, growing companies and regulated enterprises, plus usage-based API pricing.',
};

const FAQ = [
  ['Do signers need an account?', 'No. Signers open a personal link from their email, confirm a one-time code and sign. Only senders need an account.'],
  ['Which countries are supported?', 'Compliance profiles cover the United States, United Kingdom, European Union and India today. More are added as configuration and partner integrations.'],
  ['Can I try it first?', 'Yes. Create an account to try every feature with your own documents, then contact us to choose a plan.'],
  ['Can we embed signing in our product?', 'Yes. Everything in the app is available through the REST API, with webhooks for status updates and usage-based pricing for software vendors.'],
];

export default function PricingPage() {
  return (
    <>
      <PageHero eyebrow="Pricing" title="Plans that grow with you" intro="Start free, then choose the plan that matches your volume and compliance needs." />
      <Section>
        <div className="grid gap-6 lg:grid-cols-3">
          {plans.map((p) => (
            <div
              key={p.id}
              className={cx(
                'flex flex-col rounded-2xl border p-7',
                p.highlighted ? 'border-brand-500 shadow-lg ring-1 ring-brand-500' : 'border-gray-200',
              )}
            >
              {p.highlighted && <span className="mb-3 self-start rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">Most popular</span>}
              <h2 className="text-xl font-semibold text-gray-900">{p.name}</h2>
              <p className="mt-1 text-sm text-gray-500">{p.audience}</p>
              <div className="mt-6">
                {p.price ? (
                  <>
                    <span className="text-4xl font-bold text-gray-900">{p.price}</span>
                    {p.period && <span className="ml-1 text-sm text-gray-500">{p.period}</span>}
                  </>
                ) : (
                  <span className="text-2xl font-semibold text-gray-900">Contact us</span>
                )}
              </div>
              <ul className="mt-6 flex-1 space-y-3 text-sm text-gray-700">
                {p.features.map((f) => (
                  <Check key={f}>{f}</Check>
                ))}
              </ul>
              <Link
                href={p.cta.href}
                className={cx(
                  'mt-8 rounded-lg px-4 py-3 text-center text-sm font-semibold',
                  p.highlighted ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-gray-300 text-gray-800 hover:bg-gray-50',
                )}
              >
                {p.cta.label}
              </Link>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-7 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">API & embedded signing</h2>
            <p className="mt-1 text-sm text-gray-600">
              {apiPricing.price ? `${apiPricing.price} ${apiPricing.unit}. ` : `Usage-based, ${apiPricing.unit}. `}
              {apiPricing.note}
            </p>
          </div>
          <Link href="/contact?interest=api" className="shrink-0 rounded-lg bg-gray-900 px-5 py-3 text-sm font-semibold text-white hover:bg-gray-800">
            Get API pricing
          </Link>
        </div>
        <p className="mt-4 text-sm text-gray-500">
          Premium trust services (Aadhaar eSign, DSC, e-stamping, SMS codes, and later qualified signatures and ID verification) are billed per transaction.
        </p>
      </Section>

      <Section tone="muted">
        <h2 className="text-2xl font-bold text-gray-900">Questions</h2>
        <dl className="mt-8 grid gap-8 md:grid-cols-2">
          {FAQ.map(([q, a]) => (
            <div key={q}>
              <dt className="font-semibold text-gray-900">{q}</dt>
              <dd className="mt-2 text-sm leading-relaxed text-gray-600">{a}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <CtaBand />
    </>
  );
}
