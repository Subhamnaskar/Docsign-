import type { Metadata } from 'next';
import { LegalDraft } from '../LegalDraft';

export const metadata: Metadata = { title: 'Privacy policy', alternates: { canonical: '/legal/privacy' } };

export default function PrivacyPage() {
  return (
    <LegalDraft title="Privacy policy">
      <section>
        <h2>What the platform processes today</h2>
        <p>For accuracy, the final policy must describe at least the following data, which the current product collects:</p>
        <ul>
          <li>Sender accounts: name, email, organisation, hashed password, session cookies</li>
          <li>Signers: name, email, chosen language, IP address and browser at verification and signing time</li>
          <li>Documents uploaded for signature, signature images and filled-in field values</li>
          <li>One-time verification codes (stored hashed, expire after 10 minutes)</li>
          <li>Audit-trail events for each agreement, kept for the retention period of its jurisdiction</li>
          <li>Website demo requests: name, work email, company, job title, country, message, IP address</li>
        </ul>
      </section>
      <section>
        <h2>Sections to include</h2>
        <ul>
          <li>Controller and processor roles (customer as controller for signer data)</li>
          <li>Legal bases under GDPR, UK GDPR, the DPDP Act 2023 and US state laws</li>
          <li>Purposes, retention periods and data regions</li>
          <li>Sub-processors (hosting, email delivery, timestamp authority)</li>
          <li>International transfers and safeguards</li>
          <li>Data subject rights and how to exercise them</li>
          <li>Security measures and breach notification</li>
          <li>Cookies (session cookies only today)</li>
          <li>Contact details and grievance officer (required in India)</li>
        </ul>
      </section>
    </LegalDraft>
  );
}
