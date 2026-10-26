import type { Metadata } from 'next';
import { Check, CtaBand, PageHero, Section, SectionHeading } from '@/components/marketing/Site';
import { pageMeta } from '@/lib/seo';

export const metadata: Metadata = pageMeta({
  title: 'Legally Valid E-Signatures: IT Act, eIDAS, ESIGN',
  description: "E-signatures valid under India's IT Act 2000, the EU's eIDAS and the US ESIGN Act, with tamper-evident audit trails, sealed PDFs, data residency and security controls.",
  path: '/compliance',
  keywords: ['legally valid e-signature', 'IT Act 2000 e-signature', 'eIDAS', 'ESIGN Act', 'e-signature security'],
});

const JURISDICTIONS = [
  {
    name: 'United States',
    laws: 'ESIGN Act, UETA',
    retention: '7 years (10 for loan agreements)',
    guardrails: 'Wills, codicils and court documents are blocked; deeds are flagged for notarisation.',
  },
  {
    name: 'United Kingdom',
    laws: 'Electronic Communications Act 2000, UK eIDAS, UK GDPR',
    retention: '6 years',
    guardrails: 'Wills are blocked; Land Registry transfers and lasting powers of attorney are flagged.',
  },
  {
    name: 'European Union',
    laws: 'eIDAS (EU) 910/2014, eIDAS 2.0, GDPR',
    retention: '10 years',
    guardrails: 'Wills and property transfers are blocked; loan agreements require an advanced signature.',
  },
  {
    name: 'India',
    laws: 'Information Technology Act 2000, BSA 2023, DPDP Act 2023',
    retention: '8 years',
    guardrails: 'First Schedule exclusions (wills, powers of attorney, property sale, negotiable instruments) are blocked; loan agreements require Aadhaar eSign.',
  },
];

const PIPELINE = [
  ['Fingerprint', 'Every uploaded document is hashed with SHA-256 and the hash is recorded in the audit trail.'],
  ['Policy', 'The policy engine decides the signature level, signer checks, consent wording, retention and data region.'],
  ['Verify', 'Each signer confirms their identity with a one-time code sent to their email before seeing the document.'],
  ['Seal', 'The completed PDF is sealed with a PAdES digital signature. Only a hash of the content reaches the signing key.'],
  ['Timestamp', 'An RFC 3161 timestamp from a trusted authority proves when the document was sealed.'],
  ['Store', 'Sealed documents are written to object storage with a retention lock, so they cannot be overwritten.'],
];

const ROADMAP = [
  ['Information security', 'SOC 2 Type II, ISO 27001, 27017, 27018, 27701'],
  ['Industry', 'PCI DSS, HIPAA, 21 CFR Part 11 validation pack'],
  ['Government', 'FedRAMP, IRAP, C5, ENS, MeitY empanelment'],
  ['Trust services', 'eIDAS conformity assessment; CCA eSign licence or licensed partner (India)'],
  ['Accessibility', 'WCAG 2.2 AA, Section 508'],
];

export default function CompliancePage() {
  return (
    <>
      <PageHero
        eyebrow="Compliance & security"
        title="Legally sound in every market you sign in"
        intro="Each agreement is checked against the rules of its governing jurisdiction before it is sent, and every step leaves verifiable evidence."
      />

      <Section>
        <SectionHeading
          eyebrow="Jurisdictions"
          title="Compliance profiles"
          intro="Choose the governing law and document type; the platform applies the right rules and refuses documents that cannot legally be signed electronically."
        />
        <div className="mt-10 overflow-x-auto rounded-2xl border border-gray-200">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-gray-50 text-gray-500">
              <tr>
                <th className="px-5 py-3 font-medium">Jurisdiction</th>
                <th className="px-5 py-3 font-medium">Legal framework</th>
                <th className="px-5 py-3 font-medium">Default retention</th>
                <th className="px-5 py-3 font-medium">Guardrails</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {JURISDICTIONS.map((j) => (
                <tr key={j.name} className="align-top">
                  <td className="px-5 py-4 font-semibold text-gray-900">{j.name}</td>
                  <td className="px-5 py-4 text-gray-600">{j.laws}</td>
                  <td className="px-5 py-4 text-gray-600">{j.retention}</td>
                  <td className="px-5 py-4 text-gray-600">{j.guardrails}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-sm text-gray-500">
          Signatures are simple electronic signatures (SES) with a platform seal by default. In India, Aadhaar eSign and DSC tokens provide
          advanced signatures through licensed partners; qualified signatures (eIDAS) are on the roadmap. This page is general information, not legal advice; check requirements for your specific documents.
        </p>
      </Section>

      <Section tone="muted">
        <SectionHeading eyebrow="Trust" title="How a signature becomes evidence" />
        <ol className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PIPELINE.map(([title, body], i) => (
            <li key={title} className="rounded-2xl border border-gray-200 bg-white p-6">
              <div className="text-xs font-semibold text-brand-600">Step {i + 1}</div>
              <h3 className="mt-1 font-semibold text-gray-900">{title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{body}</p>
            </li>
          ))}
        </ol>
        <div className="mt-10 rounded-2xl border border-brand-100 bg-brand-50 p-6 text-sm text-brand-700">
          <strong>Tamper-evident audit trail.</strong> Each event (sent, viewed, verified, consented, signed, sealed) includes the hash of the one before
          it. Changing, inserting or deleting any event breaks the chain, and the certificate of completion records the final hash.
        </div>
      </Section>

      <Section id="residency">
        <div className="grid gap-12 lg:grid-cols-2">
          <SectionHeading
            eyebrow="Data residency"
            title="Your data stays in its legal zone"
            intro="The platform runs as independent regional cells. Each cell holds its own customers' documents, keys and audit trails, and data does not move between cells."
          />
          <ul className="space-y-4 text-gray-700">
            <Check>Each jurisdiction maps to a home region (US, UK, EU, India), recorded on every agreement</Check>
            <Check>Warnings when an agreement's data belongs in a different region</Check>
            <Check>Dedicated cells and on-premises deployment for banks and governments (planned)</Check>
            <Check>Customer-managed encryption keys on the roadmap</Check>
          </ul>
        </div>
      </Section>

      <Section id="security" tone="muted">
        <div className="grid gap-12 lg:grid-cols-2">
          <SectionHeading eyebrow="Security" title="Security controls" intro="Defence in depth, from upload to archive." />
          <ul className="space-y-4 text-gray-700">
            <Check>Every upload is scanned for malware before it is accepted</Check>
            <Check>Signature images are fully decoded and re-encoded to block malformed files</Check>
            <Check>Signing links are cryptographically bound to one recipient; forged links are rejected</Check>
            <Check>One-time codes expire after 10 minutes and lock after 5 wrong attempts</Check>
            <Check>Organisations are strictly isolated from each other</Check>
            <Check>API keys are stored hashed and can be revoked at any time; webhooks are HMAC-signed</Check>
            <Check>Passwords are hashed with bcrypt; sessions are HTTP-only cookies</Check>
            <Check>Single sign-on with OIDC, optional enforcement per domain, and SCIM de-provisioning</Check>
            <Check>Roles limit who sees which agreements; admin actions are kept in an activity log</Check>
            <Check>Embedding is limited to the websites each organisation allows</Check>
            <Check>AI features are off until an organisation&apos;s admin turns them on</Check>
          </ul>
        </div>
      </Section>

      <Section>
        <SectionHeading
          eyebrow="Certification roadmap"
          title="Certifications we are working towards"
          intro="We will publish reports and certificates here as audits complete. None of these are held yet."
        />
        <dl className="mt-10 divide-y divide-gray-100 rounded-2xl border border-gray-200">
          {ROADMAP.map(([area, certs]) => (
            <div key={area} className="grid gap-1 px-5 py-4 sm:grid-cols-[200px_1fr]">
              <dt className="font-medium text-gray-900">{area}</dt>
              <dd className="text-gray-600">{certs}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <CtaBand title="Have a compliance question?" intro="Tell us your jurisdictions and document types, and we will walk you through how they are handled." />
    </>
  );
}
