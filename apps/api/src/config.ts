import 'dotenv/config';

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

export const config = {
  cellRegion: env('CELL_REGION', 'local'),
  port: Number(env('PORT', '4000')),
  appUrl: env('APP_URL', 'http://localhost:3000').replace(/\/$/, ''),
  corsOrigins: env('CORS_ORIGINS', 'http://localhost:3000').split(',').map((s) => s.trim()),
  s3: {
    endpoint: env('S3_ENDPOINT', 'http://localhost:9000'),
    region: env('S3_REGION', 'us-east-1'),
    accessKeyId: env('S3_ACCESS_KEY', 'docsign'),
    secretAccessKey: env('S3_SECRET_KEY', 'docsign-secret'),
    bucket: env('S3_BUCKET', 'docsign-documents'),
  },
  smtp: {
    host: env('SMTP_HOST', 'localhost'),
    port: Number(env('SMTP_PORT', '1025')),
    from: env('MAIL_FROM', 'DocSign <no-reply@docsign.local>'),
  },
  gotenbergUrl: env('GOTENBERG_URL', 'http://localhost:3100'),
  tsaUrl: process.env.TSA_URL ?? '',
  keysDir: env('KEYS_DIR', '.keys'),
  /** Platform seal key: local (dev key on disk) | aws-kms (HSM-backed key in AWS KMS) */
  seal: {
    provider: env('SEAL_KEY_PROVIDER', 'local') as 'local' | 'aws-kms',
    kmsKeyId: process.env.SEAL_KMS_KEY_ID ?? '',
    kmsRegion: env('SEAL_KMS_REGION', process.env.AWS_REGION ?? 'ap-south-1'),
    /** PEM bundle: seal certificate first, then intermediates */
    certChainPath: process.env.SEAL_CERT_CHAIN_PATH ?? '',
  },
  appSecret: env('APP_SECRET', 'change-me-to-a-long-random-string-at-least-32-chars'),
  salesEmail: env('SALES_EMAIL', 'sales@docsign.local'),
  supportEmail: env('SUPPORT_EMAIL', 'support@docsign.local'),
  messaging: {
    /** console (development, shows in Mailpit) | twilio | msg91 */
    smsProvider: env('SMS_PROVIDER', 'console'),
    /** console | twilio */
    whatsappProvider: env('WHATSAPP_PROVIDER', 'console'),
    twilio: {
      accountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
      authToken: process.env.TWILIO_AUTH_TOKEN ?? '',
      from: process.env.TWILIO_FROM ?? '',
      whatsappFrom: process.env.TWILIO_WHATSAPP_FROM ?? '',
    },
    msg91: {
      authKey: process.env.MSG91_AUTH_KEY ?? '',
      templateId: process.env.MSG91_TEMPLATE_ID ?? '',
    },
  },
  esign: {
    /**
     * off | sandbox | production. sandbox uses the built-in test ESP (signatures
     * are NOT legally valid); production posts to a licensed ESP.
     */
    mode: env('ESIGN_MODE', 'sandbox') as 'off' | 'sandbox' | 'production',
    /** ESP gateway URL the signer's browser is sent to (production) */
    espUrl: process.env.ESIGN_ESP_URL ?? '',
    /** ASP id issued by the ESP */
    aspId: env('ESIGN_ASP_ID', 'DOCSIGN-SANDBOX'),
    /** PEM path of the ESP's response-signing certificate (production) */
    espCertPath: process.env.ESIGN_ESP_CERT ?? '',
    /** Directory of trusted root/intermediate PEMs for DSC certificates (e.g. CCA India). Empty = chain not checked. */
    dscTrustDir: process.env.DSC_TRUST_DIR ?? '',
  },
  payments: {
    /** sandbox (built-in test checkout) | stripe | razorpay */
    provider: env('PAYMENT_PROVIDER', 'sandbox') as 'sandbox' | 'stripe' | 'razorpay',
    stripe: { secretKey: process.env.STRIPE_SECRET_KEY ?? '', webhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '' },
    razorpay: { keyId: process.env.RAZORPAY_KEY_ID ?? '', keySecret: process.env.RAZORPAY_KEY_SECRET ?? '' },
  },
  /** Signer identity checks (India) */
  kyc: {
    /** sandbox | cashfree (PAN and bank account) */
    provider: env('KYC_PROVIDER', 'sandbox') as 'sandbox' | 'cashfree',
    cashfree: {
      clientId: process.env.CASHFREE_CLIENT_ID ?? '',
      clientSecret: process.env.CASHFREE_CLIENT_SECRET ?? '',
      baseUrl: env('CASHFREE_VERIFICATION_URL', 'https://sandbox.cashfree.com/verification'),
    },
    digilocker: {
      /** sandbox | production */
      mode: env('DIGILOCKER_MODE', 'sandbox') as 'sandbox' | 'production',
      clientId: process.env.DIGILOCKER_CLIENT_ID ?? '',
      clientSecret: process.env.DIGILOCKER_CLIENT_SECRET ?? '',
      baseUrl: env('DIGILOCKER_BASE_URL', 'https://digilocker.meripehchaan.gov.in/public/oauth2'),
    },
  },
  /** Qualified signatures through a QTSP's Cloud Signature Consortium API v2 */
  csc: {
    /** sandbox = built-in test trust service (NOT qualified) | production */
    mode: env('CSC_MODE', 'sandbox') as 'sandbox' | 'production',
    /** CSC API base, e.g. https://qtsp.example.com/csc/v2 */
    apiUrl: process.env.CSC_API_URL ?? '',
    /** OAuth 2.0 authorization server base (…/oauth2/authorize and …/oauth2/token) */
    oauthUrl: process.env.CSC_OAUTH_URL ?? '',
    clientId: process.env.CSC_CLIENT_ID ?? '',
    clientSecret: process.env.CSC_CLIENT_SECRET ?? '',
  },
  /** eNACH e-mandates: sandbox | razorpay (uses the Razorpay keys) */
  enach: { provider: env('ENACH_PROVIDER', 'sandbox') as 'sandbox' | 'razorpay' },
  /** CRM connections (HubSpot uses per-organisation private app tokens; Salesforce needs a connected app) */
  crm: {
    salesforceClientId: process.env.SALESFORCE_CLIENT_ID ?? '',
    salesforceClientSecret: process.env.SALESFORCE_CLIENT_SECRET ?? '',
    salesforceLoginUrl: env('SALESFORCE_LOGIN_URL', 'https://login.salesforce.com'),
  },
  /** Cloud file pickers (public client identifiers; leave empty to hide a provider) */
  cloud: {
    googleClientId: process.env.GOOGLE_PICKER_CLIENT_ID ?? '',
    googleApiKey: process.env.GOOGLE_PICKER_API_KEY ?? '',
    googleAppId: process.env.GOOGLE_PICKER_APP_ID ?? '',
    dropboxAppKey: process.env.DROPBOX_APP_KEY ?? '',
    onedriveClientId: process.env.ONEDRIVE_CLIENT_ID ?? '',
  },
  billing: {
    /** sandbox (built-in test checkout) | stripe | razorpay. Uses the Stripe/Razorpay keys above. */
    provider: env('BILLING_PROVIDER', 'sandbox') as 'sandbox' | 'stripe' | 'razorpay',
    /** Signing secret of the Stripe endpoint <APP_URL>/api/v1/billing/stripe/webhook */
    stripeWebhookSecret: process.env.STRIPE_BILLING_WEBHOOK_SECRET ?? '',
    /** Secret of the Razorpay webhook <APP_URL>/api/v1/billing/razorpay/webhook */
    razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? '',
    /** GST percentage on INR invoices; 0 if the business is not GST-registered */
    gstRate: Number(env('BILLING_GST_RATE', '18')),
    seller: {
      name: env('BILLING_SELLER_NAME', '[Company Name]'),
      address: process.env.BILLING_SELLER_ADDRESS ?? '',
      taxId: process.env.BILLING_SELLER_GSTIN ?? '',
    },
  },
  ai: {
    /**
     * AI features call the Claude API. Enabled when ANTHROPIC_API_KEY is set (or
     * AI_ENABLED=true with another Anthropic credential source); organisations
     * must still opt in under Settings.
     */
    enabled: process.env.AI_ENABLED === 'true' || Boolean(process.env.ANTHROPIC_API_KEY),
    model: env('AI_MODEL', 'claude-opus-5-5'),
  },
  estamp: {
    /** sandbox (specimen certificates, not valid) | off */
    provider: env('ESTAMP_PROVIDER', 'sandbox'),
  },
  /** Renew PAdES archive timestamps (B-LTA) older than this many days */
  ltaRenewAfterDays: Number(env('LTA_RENEW_AFTER_DAYS', String(5 * 365))),
  /** 'inline' runs background jobs inside the API process; 'off' expects `npm run worker`. */
  workerMode: env('WORKER_MODE', 'inline') as 'inline' | 'off',
  clamav: {
    host: process.env.CLAMAV_HOST ?? '',
    port: Number(env('CLAMAV_PORT', '3310')),
  },
  isProduction: process.env.NODE_ENV === 'production',
};
