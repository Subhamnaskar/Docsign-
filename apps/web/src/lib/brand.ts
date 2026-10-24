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
 * Plans from the blueprint (section 14.1). Set `price` once pricing is decided;
 * while it is null the page shows "Contact us" instead of a number.
 */
export const plans: {
  id: string;
  name: string;
  audience: string;
  price: string | null;
  period?: string;
  highlighted?: boolean;
  features: string[];
  cta: { label: string; href: string };
}[] = [
  {
    id: 'starter',
    name: 'Starter',
    audience: 'Freelancers and small teams',
    price: null,
    period: 'per user / month',
    features: [
      'Unlimited templates',
      'Sequential and parallel signing',
      'Email one-time passcode for signers',
      'Sealed PDFs with certificate of completion',
      'Signer experience in 10 languages',
    ],
    cta: { label: 'Start free', href: '/register' },
  },
  {
    id: 'business',
    name: 'Business',
    audience: 'Growing companies',
    price: null,
    period: 'per user / month',
    highlighted: true,
    features: [
      'Everything in Starter',
      'Bulk send from CSV',
      'REST API, API keys and webhooks',
      'Automatic reminders and expiry',
      'Compliance profiles for US, UK, EU and India',
    ],
    cta: { label: 'Start free', href: '/register' },
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    audience: 'Regulated industries and large organisations',
    price: null,
    features: [
      'Everything in Business',
      'Single sign-on (OIDC) and SCIM provisioning',
      'Roles, branding and an activity log',
      'Aadhaar eSign and DSC (India) via licensed partners',
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
