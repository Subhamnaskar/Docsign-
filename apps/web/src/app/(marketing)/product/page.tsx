import type { Metadata } from 'next';
import { Check, CtaBand, PageHero, Section, SectionHeading } from '@/components/marketing/Site';

export const metadata: Metadata = {
  title: 'Product',
  description: 'Prepare, send, sign and verify agreements, with templates, bulk send, signer languages and a full audit trail.',
};

const GROUPS = [
  {
    title: 'Prepare',
    intro: 'Get documents ready in minutes.',
    items: [
      'Upload PDF, Word, Excel, PowerPoint, ODT, RTF or text files; they are converted to PDF automatically',
      'Drag-and-drop fields: signature, initials, date signed, name, email, text and checkbox',
      'Multiple documents per agreement',
      'Signing order, or everyone at once',
      'Reminders, expiry dates and a personal message',
    ],
  },
  {
    title: 'Sign',
    intro: 'A signing experience people finish.',
    items: [
      'Personal signing link by email, with a one-time code for identity',
      'Draw, type or upload a signature, adopted once and reused',
      'Guided "next field" navigation on desktop and mobile',
      'Ten languages, including right-to-left Arabic',
      'Decline with a reason; senders are notified straight away',
    ],
  },
  {
    title: 'Scale',
    intro: 'Send the same agreement to many people.',
    items: [
      'Save any agreement as a template with named roles',
      'Create agreements from templates in the app or over the API',
      'Bulk send from a CSV: one agreement per row, with a per-row error report',
      'Duplicate past agreements',
      'Dashboard with status, search and progress at a glance',
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
      <Section tone="dark">
        <SectionHeading
          dark
          eyebrow="On the roadmap"
          title="What's coming next"
          intro="The platform is built so these plug in through partner adapters, without changing how you send agreements."
        />
        <ul className="mt-10 grid gap-4 text-gray-300 sm:grid-cols-2">
          {[
            'Advanced and qualified signatures (eIDAS) through trust service providers',
            'Aadhaar eSign and e-stamping for India',
            'ID document and selfie checks, national eIDs',
            'Single sign-on and user provisioning',
            'Salesforce, Microsoft 365 and Google Workspace integrations',
            'Contract repository with AI summaries and renewal tracking',
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
