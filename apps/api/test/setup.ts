import { vi } from 'vitest';
import type { Mail } from '../src/lib/mailer.js';

/** Emails are captured here instead of being sent (see `outbox()` in helpers). */
const g = globalThis as unknown as { __outbox: Mail[] };
g.__outbox = [];

vi.mock('../src/lib/mailer.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/lib/mailer.js')>();
  return {
    ...actual,
    sendMail: async (mail: Mail) => {
      (globalThis as unknown as { __outbox: Mail[] }).__outbox.push(mail);
    },
  };
});
