import type { Metadata } from 'next';
import Link from 'next/link';
import { CtaBand, PageHero, Section, SectionHeading } from '@/components/marketing/Site';

export const metadata: Metadata = {
  title: 'Partners',
  description: 'Referral, reseller, system integrator, OEM and trust-service partnerships.',
};

const TYPES = [
  { name: 'Referral partners', role: 'Introduce qualified customers', get: 'Referral commission and co-branded marketing material' },
  { name: 'Resellers & distributors', role: 'Sell and bill the platform in your region', get: 'Reseller margin, deal registration, sales training and a demo environment' },
  { name: 'System integrators', role: 'Implement workflows and integrations for enterprises', get: 'Certification programme, implementation toolkits and a partner sandbox' },
  { name: 'ISV / OEM partners', role: 'Embed signing inside your own software', get: 'Full API, volume pricing and technical support' },
  { name: 'Technology & trust partners', role: 'Provide certificates, identity, notary or payment services', get: 'Integration through our adapter layer, revenue share and joint go-to-market' },
];

export default function PartnersPage() {
  return (
    <>
      <PageHero
        eyebrow="Partners"
        title="Grow with us"
        intro="We reach new markets through partners: licensed trust providers, identity services, integrators and resellers who know their region."
      >
        <Link href="/contact?interest=partnership" className="rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700">
          Become a partner
        </Link>
      </PageHero>
      <Section>
        <SectionHeading eyebrow="Programme" title="Ways to partner" />
        <div className="mt-10 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {TYPES.map((t) => (
            <div key={t.name} className="flex flex-col rounded-2xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900">{t.name}</h3>
              <p className="mt-2 text-sm text-gray-600">{t.role}</p>
              <p className="mt-4 border-t border-gray-100 pt-4 text-sm text-gray-500">
                <span className="font-medium text-gray-700">You get: </span>
                {t.get}
              </p>
            </div>
          ))}
        </div>
      </Section>
      <Section tone="muted">
        <div className="grid gap-10 lg:grid-cols-2">
          <SectionHeading
            eyebrow="Trust & identity providers"
            title="Plug your service into every agreement"
            intro="Qualified trust service providers, Aadhaar eSign service providers, certificate authorities and ID-verification vendors connect through one adapter interface. When an agreement needs your service, the compliance engine routes it to you."
          />
          <ul className="space-y-3 text-sm text-gray-700">
            {['Qualified and advanced signatures (eIDAS, CSC API)', 'Aadhaar eSign and DSC tokens (India)', 'ID document, liveness and video KYC', 'National eIDs: BankID, itsme, SPID, UAE Pass, Singpass', 'E-stamping, notarisation and payments'].map((x) => (
              <li key={x} className="rounded-lg border border-gray-200 bg-white px-4 py-3">
                {x}
              </li>
            ))}
          </ul>
        </div>
      </Section>
      <CtaBand title="Let's talk partnership" intro="Tell us about your business and region, and we will get back to you." />
    </>
  );
}
