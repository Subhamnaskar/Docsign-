import type Anthropic from '@anthropic-ai/sdk';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setAiClientForTests } from '../src/ai/claude.js';
import { client, getApp, lastMail, makePdf, multipart, registerSender } from './helpers.js';

let app: FastifyInstance;
const calls: Record<string, unknown>[] = [];
const answers: unknown[] = [];
beforeAll(async () => {
  app = await getApp();
  setAiClientForTests({
    beta: {
      messages: {
        parse: async (params: Record<string, unknown>) => {
          calls.push(params);
          return answers.shift();
        },
      },
    },
  } as unknown as Anthropic);
});
afterAll(() => setAiClientForTests(null));

describe('help centre', () => {
  it('lists articles and serves each one', async () => {
    const list = (await app.inject({ method: 'GET', url: '/api/v1/help/articles' })).json();
    expect(list.length).toBeGreaterThanOrEqual(15);
    expect(list[0]).not.toHaveProperty('body');
    const a = (await app.inject({ method: 'GET', url: `/api/v1/help/articles/${list[0].slug}` })).json();
    expect(a.body).toContain('##');
    expect((await app.inject({ method: 'GET', url: '/api/v1/help/articles/nope' })).statusCode).toBe(404);
  });

  it('answers questions from the articles with a cached system prompt and only real article links', async () => {
    answers.push({ stop_reason: 'end_turn', parsed_output: { answer: 'Go to Settings → Security and turn on two-factor authentication.', articles: ['security', 'made-up-slug'], answered: true } });
    const res = (await app.inject({ method: 'POST', url: '/api/v1/help/ask', payload: { question: 'How do I turn on 2FA?' } })).json();
    expect(res).toMatchObject({ answered: true, articles: [{ slug: 'security', title: 'Account security' }] });
    const system = calls[0].system as { text: string; cache_control: unknown }[];
    expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(system[0].text).toContain('<article slug="billing-and-plans"');
  });

  it('takes support requests from visitors and signed-in users', async () => {
    const anon = await app.inject({ method: 'POST', url: '/api/v1/support', payload: { subject: 'Pricing for NGOs', message: 'Do you offer a discount for registered charities?' } });
    expect(anon.statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/v1/support', payload: { subject: 'Pricing for NGOs', message: 'Do you offer a discount for registered charities?', email: 'ngo@example.test' } })).statusCode).toBe(201);
    expect(lastMail('support@docsign.local', /\[Support\] Pricing for NGOs/).text).toContain('ngo@example.test');
    expect(lastMail('ngo@example.test', /We received your message/)).toBeTruthy();

    const { c, email } = await registerSender(app);
    await c.json('POST', '/support', { json: { subject: 'Cannot upload', message: 'My 30 MB scan is refused when I upload it.', page: '/envelopes/x/edit' } });
    expect(lastMail('support@docsign.local', /\[Support\] Cannot upload/).text).toContain(email);
  });
});

describe('getting-started checklist', () => {
  it('tracks progress from real activity and can be dismissed', async () => {
    const { c } = await registerSender(app);
    let ob = await c.json('GET', '/onboarding');
    expect(ob.steps.map((s: { id: string }) => s.id)).toEqual(['verify', 'upload', 'send', 'brand', 'team', 'template']);
    expect(ob.steps.find((s: { id: string }) => s.id === 'verify').done).toBe(true);
    expect(ob.steps.find((s: { id: string }) => s.id === 'upload').done).toBe(false);

    const env = await c.json('POST', '/envelopes', { json: { title: 'First' } });
    const { payload, headers } = multipart('f.pdf', await makePdf('First'));
    await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
    await c.json('PATCH', '/organization', { json: { brandColor: '#0f766e' } });
    ob = await c.json('GET', '/onboarding');
    expect(ob.done).toBe(3);
    expect(ob.dismissed).toBe(false);
    await c.json('POST', '/onboarding/dismiss');
    expect((await c.json('GET', '/onboarding')).dismissed).toBe(true);
    expect((await client(app).call('GET', '/onboarding')).statusCode).toBe(401);
  });
});
