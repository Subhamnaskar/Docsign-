/**
 * Brand and commercial settings for the public website, in one place.
 *
 * "DocSign" is a working name: it is close to an existing trademark, so choose
 * the final name (and run a trademark search) before launching publicly.
 */
export const brand = {
  name: 'DocSign',
  tagline: 'Sign agreements in every market, compliant by design.',
  description:
    'One platform to send, sign and verify agreements across countries, with the right signature level, consent and data residency for each jurisdiction.',
  domain: 'docsign.example',
  salesEmail: 'sales@docsign.example',
  supportEmail: 'support@docsign.example',
  /** Registered company details for the footer and legal pages. */
  legalEntity: '[Company Name]',
};

/**
 * Marketing copy for each plan. Prices, limits and the trial come from the API
 * (`GET /api/v1/billing/plans`, defined in apps/api/src/billing/plans.ts), so
 * the website and in-app billing always agree.
 */
export const plans: {
  id: 'starter' | 'business' | 'enterprise';
  audience: string;
  highlighted?: boolean;
  features: string[];
  cta: { label: string; href: string };
}[] = [
  {
    id: 'starter',
    audience: 'Freelancers and small teams',
    features: [
      'Unlimited templates',
      'Sequential and parallel signing',
      'Email, SMS or WhatsApp codes for signers',
      'Sealed PDFs with certificate of completion',
      'Signer experience in 10 languages',
    ],
    cta: { label: 'Start free trial', href: '/register' },
  },
  {
    id: 'business',
    audience: 'Growing companies',
    highlighted: true,
    features: [
      'Everything in Starter',
      'Bulk send from CSV',
      'REST API, webhooks, Zapier and MCP',
      'Web forms, payments and embedded signing',
      'Compliance profiles for US, UK, EU and India',
    ],
    cta: { label: 'Start free trial', href: '/register' },
  },
  {
    id: 'enterprise',
    audience: 'Regulated industries and large organisations',
    features: [
      'Everything in Business',
      'Single sign-on (OIDC) and SCIM provisioning',
      'Aadhaar eSign and DSC (India) via licensed partners',
      'Invoiced billing and custom terms',
      'Dedicated regional cell and customer-managed keys (planned)',
      'Premium support and onboarding',
    ],
    cta: { label: 'Talk to sales', href: '/contact?interest=pricing' },
  },
];

/** Usage-based pricing for developers and ISVs (blueprint 14.1). */
export const apiPricing = {
  price: null as string | null,
  unit: 'per completed envelope',
  note: 'Volume bundles available for ISVs and embedded signing.',
};
