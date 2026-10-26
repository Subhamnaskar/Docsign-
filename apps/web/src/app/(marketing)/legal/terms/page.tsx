import type { Metadata } from 'next';
import { LegalDraft } from '../LegalDraft';

export const metadata: Metadata = { title: 'Terms of service', alternates: { canonical: '/legal/terms' } };

export default function TermsPage() {
  return (
    <LegalDraft title="Terms of service">
      <section>
        <h2>Sections to include</h2>
        <ul>
          <li>Parties, acceptance and eligibility</li>
          <li>Accounts, organisations and administrator responsibilities</li>
          <li>Acceptable use, including prohibited documents and fraud</li>
          <li>Customer responsibility for the legal validity of documents in their jurisdiction</li>
          <li>Service levels, support and maintenance windows</li>
          <li>Fees, billing, taxes and renewals</li>
          <li>Data ownership, data processing agreement and sub-processors</li>
          <li>Retention of signed documents and audit trails; export on termination</li>
          <li>Confidentiality and security commitments</li>
          <li>Third-party trust and identity services</li>
          <li>Warranties, disclaimers and limitation of liability</li>
          <li>Indemnities</li>
          <li>Term, suspension and termination</li>
          <li>Governing law and dispute resolution</li>
        </ul>
      </section>
    </LegalDraft>
  );
}
