import type { Metadata } from 'next';
import Link from 'next/link';
import { CtaBand, PageHero, Section } from '@/components/marketing/Site';
import { type PricingData, PricingPlans } from '@/components/marketing/PricingPlans';
import { apiPricing } from '@/lib/brand';

const API_URL = process.env.API_URL ?? 'http://localhost:4000';
// Prices come from the API; refresh every 5 minutes
export const revalidate = 300;

async function loadPricing(): Promise<PricingData | null> {
  try {
    const res = await fetch(`${API_URL}/api/v1/billing/plans`, { next: { revalidate } });
    return res.ok ? ((await res.json()) as PricingData) : null;
  } catch {
    return null;
  }
}

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Plans for teams, growing companies and regulated enterprises, plus usage-based API pricing.',
};

const FAQ = [
  ['Do signers need an account?', 'No. Signers open a personal link from their email, confirm a one-time code and sign. Only senders need an account.'],
  ['Which countries are supported?', 'Compliance profiles cover the United States, United Kingdom, European Union and India today. More are added as configuration and partner integrations.'],
  ['Can I try it first?', 'Yes. Every account starts with a free trial of all features, no card needed. Choose a plan under Settings → Billing when you are ready.'],
  ['How do invoices and GST work?', 'You get a downloadable invoice for every payment. Indian customers are billed in rupees with GST shown on the invoice; add your GSTIN under Settings → Billing to claim input tax credit.'],
  ['Can I change or cancel later?', 'Yes. Add users or switch plans at any time; increases are charged pro rata. Cancelling keeps your plan until the end of the period you paid for.'],
  ['Can we embed signing in our product?', 'Yes. Everything in the app is available through the REST API, with webhooks for status updates and usage-based pricing for software vendors.'],
];

export default async function PricingPage() {
  return (
    <>
      <PageHero eyebrow="Pricing" title="Plans that grow with you" intro="Start free, then choose the plan that matches your volume and compliance needs." />
      <Section>
        <PricingPlans data={await loadPricing()} />

        <div className="mt-10 flex flex-col gap-4 rounded-2xl border border-gray-200 bg-gray-50 p-7 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">API & embedded signing</h2>
            <p className="mt-1 text-sm text-gray-600">
              {apiPricing.price ? `${apiPricing.price} ${apiPricing.unit}. ` : `Usage-based, ${apiPricing.unit}. `}
              {apiPricing.note}
            </p>
          </div>
          <Link href="/contact?interest=api" className="shrink-0 rounded-full bg-ink px-6 py-3 text-sm font-bold text-white hover:bg-black">
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
