/**
 * Solution pages (/solutions/<slug>) and the Solutions menu. Every claim here
 * must match something the product does today.
 */

export interface Solution {
  slug: string;
  name: string;
  group: 'team' | 'industry';
  /** One line for menus and cards */
  summary: string;
  headline: string;
  intro: string;
  useCases: { title: string; body: string }[];
  features: string[];
  /** Typical documents, shown as chips */
  documents: string[];
}

export const SOLUTIONS: Solution[] = [
  {
    slug: 'sales',
    name: 'Sales',
    group: 'team',
    summary: 'Close deals faster with quotes and contracts signed in minutes.',
    headline: 'Close deals while the buyer is still excited',
    intro: 'Send order forms, quotes and MSAs from your CRM, see the moment they are opened, and get signatures the same day.',
    useCases: [
      { title: 'Quotes and order forms', body: 'Turn a template into a ready-to-sign order form with the customer’s details filled in, and collect the first payment as part of signing.' },
      { title: 'Contract negotiation', body: 'Customers comment on clauses, you upload a revised version, and every version stays in one place with a full history.' },
      { title: 'CRM updates', body: 'HubSpot and Salesforce records get a note and the signed PDF the moment an agreement completes.' },
    ],
    features: ['HubSpot and Salesforce integration', 'Reminders and expiry dates', 'Payments collected during signing', 'Comments and revised versions', 'Approval before sending for discounts', 'Signing on any phone'],
    documents: ['Order forms', 'Quotes', 'MSAs', 'NDAs', 'Renewals'],
  },
  {
    slug: 'hr',
    name: 'Human resources',
    group: 'team',
    summary: 'Offer letters, onboarding and policies, signed from anywhere.',
    headline: 'Hire and onboard without the paperwork',
    intro: 'Send offer letters in the candidate’s language, collect onboarding forms in bulk and keep every signed policy on record.',
    useCases: [
      { title: 'Offer letters', body: 'Generate offer letters from a Word template with the candidate’s salary and start date filled in, then send for signature in one step.' },
      { title: 'Onboarding packs', body: 'Bundle the employment contract, NDA and policy acknowledgements into one agreement the new hire signs in a few minutes.' },
      { title: 'Policy acknowledgements', body: 'Send an updated policy to the whole company from a CSV with bulk send and see who has signed.' },
    ],
    features: ['Word templates with fields filled in', 'Bulk send from a CSV', 'Signer languages including Hindi', 'Identity checks with PAN or Aadhaar', 'Departments with their own agreements', 'Retention rules for HR records'],
    documents: ['Offer letters', 'Employment contracts', 'NDAs', 'Policy acknowledgements', 'Exit forms'],
  },
  {
    slug: 'legal',
    name: 'Legal',
    group: 'team',
    summary: 'Evidence that holds up, and a searchable repository of contracts.',
    headline: 'Agreements that hold up, and that you can find again',
    intro: 'Every signature comes with a tamper-evident audit trail and a sealed PDF anyone can verify, and every contract lands in a searchable repository.',
    useCases: [
      { title: 'Court-ready evidence', body: 'A hash-chained audit trail and a certificate of completion record who signed, when, from where and how they proved their identity.' },
      { title: 'Contract repository', body: 'Search signed contracts, pull out parties, dates and values with AI, and get reminded before renewals and notice periods.' },
      { title: 'The right signature for each law', body: 'The compliance engine picks the signature level, consent wording and retention for India, the US, the UK and the EU, and blocks documents that cannot be e-signed.' },
    ],
    features: ['Tamper-evident audit trail', 'PAdES seal with trusted timestamps', 'Public verification page', 'Contract repository with AI extraction', 'Renewal reminders', 'Qualified and Aadhaar signatures via licensed partners'],
    documents: ['Contracts', 'Board resolutions', 'Settlements', 'Powers of attorney', 'Consents'],
  },
  {
    slug: 'procurement',
    name: 'Procurement',
    group: 'team',
    summary: 'Vendor contracts and purchase agreements with approvals built in.',
    headline: 'Vendor agreements with approvals built in',
    intro: 'Route supplier contracts for approval before they go out, negotiate changes in one place and keep every version on record.',
    useCases: [
      { title: 'Approvals before sending', body: 'Require a manager or legal approval before an agreement goes to a supplier, with the approval recorded in the audit trail.' },
      { title: 'Supplier negotiation', body: 'Suppliers comment and you upload revisions, without email chains and attachments.' },
      { title: 'Renewals', body: 'The repository reminds you before contracts renew or notice periods start, so nothing rolls over by accident.' },
    ],
    features: ['Approval workflows', 'Comments and versions', 'Contract repository', 'Renewal reminders', 'Templates with roles', 'Audit trail export'],
    documents: ['Supplier agreements', 'Purchase orders', 'SLAs', 'NDAs', 'Rate cards'],
  },
  {
    slug: 'banking',
    name: 'Banking and lending',
    group: 'industry',
    summary: 'Loan agreements, KYC and e-mandates in one signing journey.',
    headline: 'Loan agreements, KYC and e-mandates in one journey',
    intro: 'Verify the borrower, collect their signature and set up repayments in a single flow, with stamp duty worked out for each state.',
    useCases: [
      { title: 'Borrower verification', body: 'Check PAN, bank account and Aadhaar details before signing, and record the results in the audit trail.' },
      { title: 'e-NACH mandates', body: 'Borrowers set up repayment mandates as part of signing the loan agreement.' },
      { title: 'Stamp duty', body: 'The duty calculator works out stamp duty by state and document type, with e-stamping through a partner.' },
    ],
    features: ['Aadhaar eSign via licensed partners', 'PAN and bank account checks', 'e-NACH mandates', 'Stamp duty by state', 'Data stored in India', 'Customer-managed encryption keys'],
    documents: ['Loan agreements', 'Sanction letters', 'KYC forms', 'e-Mandates', 'Guarantees'],
  },
  {
    slug: 'real-estate',
    name: 'Real estate',
    group: 'industry',
    summary: 'Leases and sale agreements signed by every party, from anywhere.',
    headline: 'Leases and sale agreements, signed from anywhere',
    intro: 'Send rent agreements and sale documents to owners, tenants and witnesses, in the order they need to sign.',
    useCases: [
      { title: 'Rent agreements', body: 'Use a template, fill in the property and rent, and send to landlord and tenant with a witness if needed.' },
      { title: 'Collect deposits', body: 'Collect the security deposit or booking amount as part of signing.' },
      { title: 'Guardrails', body: 'Documents that the law says need registration or notarisation are flagged before you send.' },
    ],
    features: ['Signing order with witnesses', 'Payments during signing', 'Stamp duty by state', 'Templates with roles', 'Reminders', 'Mobile-friendly signing'],
    documents: ['Rent agreements', 'Leave and licence', 'Sale agreements', 'Booking forms', 'Brokerage agreements'],
  },
  {
    slug: 'software',
    name: 'Software vendors',
    group: 'industry',
    summary: 'Embed signing in your product with the API and webhooks.',
    headline: 'Put signing inside your product',
    intro: 'Create agreements from your app, embed the signing page, and get signed webhooks as each step completes.',
    useCases: [
      { title: 'Embedded signing', body: 'Your users sign inside your app; you choose where they land afterwards.' },
      { title: 'Templates over the API', body: 'Create agreements from templates with one API call and fill in fields from your data.' },
      { title: 'Webhooks', body: 'Signed webhooks tell your system when agreements are viewed, signed, declined or completed.' },
    ],
    features: ['REST API and OpenAPI spec', 'Node and Python SDKs', 'Test-mode API keys', 'Embedded signing', 'Signed webhooks', 'MCP server for AI agents'],
    documents: ['Customer agreements', 'Terms acceptance', 'Partner contracts', 'Consent forms'],
  },
];

export const solutionBySlug = (slug: string) => SOLUTIONS.find((s) => s.slug === slug);
