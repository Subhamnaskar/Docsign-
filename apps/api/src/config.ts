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
  /** 'inline' runs background jobs inside the API process; 'off' expects `npm run worker`. */
  workerMode: env('WORKER_MODE', 'inline') as 'inline' | 'off',
  clamav: {
    host: process.env.CLAMAV_HOST ?? '',
    port: Number(env('CLAMAV_PORT', '3310')),
  },
  isProduction: process.env.NODE_ENV === 'production',
};
