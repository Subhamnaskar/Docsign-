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
  appSecret: env('APP_SECRET', 'change-me-to-a-long-random-string-at-least-32-chars'),
  salesEmail: env('SALES_EMAIL', 'sales@docsign.local'),
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
  /** 'inline' runs background jobs inside the API process; 'off' expects `npm run worker`. */
  workerMode: env('WORKER_MODE', 'inline') as 'inline' | 'off',
  clamav: {
    host: process.env.CLAMAV_HOST ?? '',
    port: Number(env('CLAMAV_PORT', '3310')),
  },
  isProduction: process.env.NODE_ENV === 'production',
};
