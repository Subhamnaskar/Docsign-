import type Anthropic from '@anthropic-ai/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setAiClientForTests } from '../src/ai/claude.js';
import { buildApp } from '../src/app.js';
import { client, getApp, lastMail, makePdf, multipart, registerSender, uid } from './helpers.js';

let app: FastifyInstance;

/** Records requests and answers with canned responses, in place of the Claude API. */
const fake = {
  calls: [] as { kind: 'parse' | 'create'; params: Record<string, unknown> }[],
  next: [] as unknown[],
};
const fakeClient = {
  beta: {
    messages: {
      parse: async (params: Record<string, unknown>) => {
        fake.calls.push({ kind: 'parse', params });
        return fake.next.shift();
      },
      create: async (params: Record<string, unknown>) => {
        fake.calls.push({ kind: 'create', params });
        return fake.next.shift();
      },
    },
  },
} as unknown as Anthropic;

const parsed = (output: unknown, stop = 'end_turn') => ({ stop_reason: stop, stop_details: stop === 'refusal' ? { category: 'cyber' } : null, parsed_output: output, content: [] });

beforeAll(async () => {
  app = await getApp();
  setAiClientForTests(fakeClient);
});
afterAll(() => setAiClientForTests(null));
beforeEach(() => {
  fake.calls = [];
  fake.next = [];
});

async function draftWithDoc(c: ReturnType<typeof client>, pdf?: Buffer) {
  const env = await c.json('POST', '/envelopes', { json: { title: `AI ${uid()}`, documentType: 'nda' } });
  const { payload, headers } = multipart('nda.pdf', pdf ?? (await makePdf(`NDA ${uid()}`)));
  await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
  return env;
}

describe('AI contract review', () => {
  it('requires the organisation to opt in, then calls Claude with the right request and caches', async () => {
    const { c } = await registerSender(app);
    const env = await draftWithDoc(c);
    expect((await c.call('POST', `/envelopes/${env.id}/ai/review`)).statusCode).toBe(403);

    await c.json('PATCH', '/organization', { json: { aiEnabled: true } });
    const review = { overallRisk: 'medium', overview: 'Mostly standard.', findings: [{ clause: 'Term', issue: 'Perpetual', severity: 'medium', suggestion: 'Limit to 3 years', page: 1 }], missingClauses: ['Governing law'] };
    fake.next.push(parsed(review));
    const res = await c.json('POST', `/envelopes/${env.id}/ai/review`);
    expect(res).toMatchObject(review);
    expect(res.disclaimer).toBeTruthy();

    const p = fake.calls[0].params as {
      model: string;
      fallbacks: string;
      betas: string[];
      output_config: { effort: string };
      messages: { content: { type: string; source?: { media_type: string }; cache_control?: unknown }[] }[];
    };
    expect(p.model).toBe('claude-opus-5-5');
    expect(p.fallbacks).toBe('default');
    expect(p.betas).toContain('server-side-fallback-2026-07-01');
    expect(p.output_config.effort).toBe('high');
    const doc = p.messages[0].content[0];
    expect(doc).toMatchObject({ type: 'document', source: { media_type: 'application/pdf' }, cache_control: { type: 'ephemeral' } });

    // Same documents → cached, no second call
    await c.json('POST', `/envelopes/${env.id}/ai/review`);
    expect(fake.calls).toHaveLength(1);
  });

  it('reports refusals instead of returning empty output', async () => {
    const { c } = await registerSender(app);
    await c.json('PATCH', '/organization', { json: { aiEnabled: true } });
    const env = await draftWithDoc(c);
    fake.next.push(parsed(null, 'refusal'));
    const res = await c.call('POST', `/envelopes/${env.id}/ai/review`);
    expect(res.statusCode).toBe(422);
    expect(res.json().error.code).toBe('ai_refused');
  });

  it('answers questions with page citations', async () => {
    const { c } = await registerSender(app);
    await c.json('PATCH', '/organization', { json: { aiEnabled: true } });
    const env = await draftWithDoc(c);
    fake.next.push({
      stop_reason: 'end_turn',
      stop_details: null,
      content: [
        { type: 'text', text: 'The term is two years.', citations: [{ type: 'page_location', cited_text: 'for a period of two years', document_index: 0, document_title: 'nda.pdf', start_page_number: 1, end_page_number: 2 }] },
      ],
    });
    const res = await c.json('POST', `/envelopes/${env.id}/ai/ask`, { json: { question: 'How long is the term?' } });
    expect(res).toEqual({ text: 'The term is two years.', citations: [{ document: 'nda.pdf', page: 1, quote: 'for a period of two years' }] });
    const doc = (fake.calls[0].params.messages as { content: { citations?: unknown }[] }[])[0].content[0];
    expect(doc.citations).toEqual({ enabled: true });
  });
});

describe('AI signer summary', () => {
  it('summarises in the signer language for verified signers only', async () => {
    const { c } = await registerSender(app);
    await c.json('PATCH', '/organization', { json: { aiEnabled: true } });
    const email = `sum-${uid()}@example.test`;
    let env = await draftWithDoc(c);
    env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Priya', email, locale: 'hi' }] });
    await c.json('PUT', `/envelopes/${env.id}/fields`, {
      json: [{ documentId: env.documents[0].id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }],
    });
    await c.json('POST', `/envelopes/${env.id}/send`);
    const link = lastMail(email, /./).text.match(/\/sign\/([\w.-]+)/)![1];

    const s = client(app);
    expect((await s.call('POST', `/signing/${link}/ai/summary`, { json: {} })).statusCode).toBe(401);
    await s.json('POST', `/signing/${link}/otp/send`);
    await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: lastMail(email, /\d{6}/).subject.match(/\d{6}/)![0] } });

    fake.next.push(parsed({ summary: 'सारांश', keyTerms: [], yourObligations: [], datesAndAmounts: [], worthCheckingBeforeSigning: [] }));
    const res = await s.json('POST', `/signing/${link}/ai/summary`, { json: {} });
    expect(res.summary).toBe('सारांश');
    expect(res.language).toBe('Hindi');
    expect(String(fake.calls[0].params.system)).toContain('Write in Hindi');
  });
});

describe('field detection', () => {
  async function signaturePagePdf() {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([612, 792]);
    const lines = ['This Agreement is made between the Company and the Employee.', '', 'Company Signature: ____________________', 'Date: ____________', '', 'Employee Signature: ____________________', 'Date: ____________'];
    lines.forEach((l, i) => page.drawText(l, { x: 72, y: 700 - i * 30, size: 12, font }));
    return Buffer.from(await doc.save());
  }

  it('suggests fields from the PDF layout with rules, and with AI when enabled', async () => {
    const { c } = await registerSender(app);
    let env = await draftWithDoc(c, await signaturePagePdf());
    env = await c.json('PUT', `/envelopes/${env.id}/recipients`, {
      json: [
        { name: 'Company Rep', email: `co-${uid()}@example.test`, routingOrder: 1 },
        { name: 'New Hire', email: `emp-${uid()}@example.test`, routingOrder: 2 },
      ],
    });
    const [co, emp] = env.recipients;

    const rules = await c.json('POST', `/envelopes/${env.id}/ai/detect-fields`);
    expect(rules.method).toBe('rules');
    const sigs = rules.fields.filter((f: { type: string }) => f.type === 'SIGNATURE');
    expect(sigs).toHaveLength(2);
    expect(sigs.map((f: { recipientId: string }) => f.recipientId)).toEqual([co.id, emp.id]);
    expect(rules.fields.filter((f: { type: string }) => f.type === 'DATE_SIGNED')).toHaveLength(2);
    // Boxes sit on the page, near the underlines
    for (const f of rules.fields) expect(f.x + f.width).toBeLessThanOrEqual(1.0001);
    expect(sigs[0].y).toBeLessThan(sigs[1].y);

    // AI mode: the model assigns roles; coordinates still come from the parser
    await c.json('PATCH', '/organization', { json: { aiEnabled: true } });
    fake.next.push(parsed({ fields: [{ candidateId: 'c2', type: 'SIGNATURE', recipientIndex: 1, label: null }, { candidateId: 'c99', type: 'SIGNATURE', recipientIndex: 0, label: null }] }));
    const ai = await c.json('POST', `/envelopes/${env.id}/ai/detect-fields`);
    expect(ai.method).toBe('ai');
    expect(ai.fields).toHaveLength(1); // unknown candidate ignored
    expect(ai.fields[0].recipientId).toBe(emp.id);
    expect(String((fake.calls[0].params.messages as { content: { text: string }[] }[])[0].content[0].text)).toContain('Employee Signature');
  });
});

describe('MCP server', () => {
  it('exposes agreement tools to MCP clients over HTTP with API keys', async () => {
    const live = await buildApp({ logger: false });
    await live.listen({ port: 0, host: '127.0.0.1' });
    const port = (live.server.address() as { port: number }).port;
    try {
      const { c } = await registerSender(app);
      const env = await c.json('POST', '/envelopes', { json: { title: 'MCP visible draft' } });
      const { key } = await c.json('POST', '/api-keys', { json: { name: 'Claude' } });

      const mcp = new Client({ name: 'test', version: '1.0.0' });
      await mcp.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/v1/mcp`), { requestInit: { headers: { Authorization: `Bearer ${key}` } } }));
      const tools = (await mcp.listTools()).tools.map((t) => t.name);
      expect(tools).toEqual(expect.arrayContaining(['list_agreements', 'get_agreement', 'send_from_template', 'void_agreement', 'get_audit_trail']));

      const list = await mcp.callTool({ name: 'list_agreements', arguments: { status: 'DRAFT' } });
      expect((list.content as { text: string }[])[0].text).toContain('MCP visible draft');
      const one = await mcp.callTool({ name: 'get_agreement', arguments: { id: env.id } });
      expect((one.content as { text: string }[])[0].text).toContain(env.id);
      const missing = await mcp.callTool({ name: 'get_agreement', arguments: { id: 'nope' } });
      expect(missing.isError).toBe(true);
      await mcp.close();

      const anon = await fetch(`http://127.0.0.1:${port}/api/v1/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      expect(anon.status).toBe(401);
    } finally {
      await live.close();
    }
  });
});
