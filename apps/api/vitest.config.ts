import { defineConfig } from 'vitest/config';

// Tests run against a separate database and bucket, with the timestamp
// authority disabled so they don't depend on the network.
const testDb = process.env.TEST_DATABASE_URL ?? 'postgresql://docsign:docsign@localhost:5432/docsign_test?schema=public';

export default defineConfig({
  test: {
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // Integration tests share one database
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: testDb,
      S3_BUCKET: 'docsign-test',
      TSA_URL: '',
      WORKER_MODE: 'off',
      APP_URL: 'http://localhost:3000',
      APP_SECRET: 'test-secret-test-secret-test-secret',
      KEYS_DIR: '.keys-test',
      CLAMAV_HOST: process.env.CLAMAV_HOST ?? '',
    },
  },
});
