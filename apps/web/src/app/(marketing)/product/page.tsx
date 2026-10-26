import type { Metadata } from 'next';
import { Check, CtaBand, PageHero, Section, SectionHeading } from '@/components/marketing/Site';
import { pageMeta } from '@/lib/seo';

export const metadata: Metadata = pageMeta({
  title: 'E-Signature Features: Templates, Forms, Aadhaar eSign',
  description: 'Prepare, send, sign and verify agreements online: templates, bulk send, web forms, payments, Aadhaar eSign, signing in 10 languages and a full audit trail.',
  path: '/product',
  keywords: ['e-signature features', 'document signing software', 'bulk send for signature', 'online forms with signature'],
});

const GROUPS = [
  {
    title: 'Prepare',
    intro: 'Get documents ready in minutes.',
    items: [
      'Upload PDF, Word, Excel, PowerPoint, ODT, RTF or text files; they are converted to PDF automatically',
      'Drag-and-drop fields: signature, initials, date, name, email, text, number, checkbox, dropdown, radio, attachment and payment',
      'Calculated fields and fields that show or hide based on earlier answers',
      'Optional AI field detection and contract review (off until an admin turns it on)',
      'Multiple documents per agreement, or import from a share link',
      'Signing order, or everyone at once',
      'Reminders, expiry dates and a personal message',
    ],
  },
  {
    title: 'Sign',
    intro: 'A signing experience people finish.',
    items: [
      'Personal signing link by email, verified with an email, SMS or WhatsApp code, or an access code',
      'In-person signing on your device, and signing embedded in your own website',
      'Collect a payment as part of signing',
      'Draw, type or upload a signature, adopted once and reused',
      'Guided "next field" navigation on desktop and mobile',
      'Ten languages, including right-to-left Arabic',
      'Decline with a reason, or hand off to the right person; senders are notified straight away',
    ],
  },
  {
    title: 'Scale',
    intro: 'Send the same agreement to many people.',
    items: [
      'Save any agreement as a template with named roles',
      'Create agreements from templates in the app or over the API',
      'Bulk send from a CSV: one agreement per row, with a per-row error report',
      'Public web forms that turn a filled-in form into a signed agreement',
      'Folders, bulk download, CSV export and a reports dashboard',
      'Teams with roles, single sign-on (OIDC) and SCIM user provisioning',
    ],
  },
  {
    title: 'Prove',
    intro: 'Evidence that stands up later.',
    items: [
      'Completed PDFs sealed with a PAdES digital signature and trusted timestamp',
      'Hash-chained audit trail: any edited, inserted or deleted event is detected',
      'Certificate of completion with signers, IP addresses, timestamps and hashes',
      'Write-once storage for the retention period of each jurisdiction',
      'Public verification page for anyone who receives a signed PDF',
    ],
  },
];

export default function ProductPage() {
  return (
    <>
      <PageHero
        eyebrow="Product"
        title="Everything from first draft to verified signature"
        intro="Prepare documents, collect signatures in the signer's language, and keep evidence that holds up, all in one place."
      />
      {GROUPS.map((g, i) => (
        <Section key={g.title} tone={i % 2 ? 'muted' : 'white'}>
          <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
            <SectionHeading eyebrow={`0${i + 1}`} title={g.title} intro={g.intro} />
            <ul className="space-y-4 text-gray-700">
              {g.items.map((item) => (
                <Check key={item}>{item}</Check>
              ))}
            </ul>
          </div>
        </Section>
      ))}
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.4fr]">
          <SectionHeading eyebrow="India" title="Aadhaar eSign, DSC and e-stamping" intro="Built for lending, HR and property documents in India." />
          <ul className="space-y-4 text-gray-700">
            <Check>Aadhaar eSign 2.1 with OTP, through a licensed eSign service provider</Check>
            <Check>DSC USB tokens for directors and authorised signatories</Check>
            <Check>e-Stamp certificate attached as the first page when stamp duty applies</Check>
            <Check>Each signature is added without invalidating the ones before it</Check>
          </ul>
        </div>
        <p className="mt-6 text-sm text-gray-500">Production Aadhaar eSign and e-stamping are switched on per customer once the licensed partner integration is live.</p>
      </Section>
      <Section tone="dark">
        <SectionHeading
          dark
          eyebrow="On the roadmap"
          title="What's coming next"
          intro="The platform is built so these plug in through partner adapters, without changing how you send agreements."
        />
        <ul className="mt-10 grid gap-4 text-gray-300 sm:grid-cols-2">
          {[
            'Qualified signatures (eIDAS) through trust service providers',
            'Licensed Aadhaar eSign and e-stamp partners in production',
            'ID document and selfie checks, national eIDs',
            'Salesforce, Microsoft 365 and Google Workspace integrations',
            'Contract repository with renewal tracking',
            'Native mobile apps',
          ].map((r) => (
            <Check dark key={r}>
              {r}
            </Check>
          ))}
        </ul>
      </Section>
      <CtaBand />
    </>
  );
}
