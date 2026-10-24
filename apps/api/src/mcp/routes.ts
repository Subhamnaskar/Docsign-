import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { API_KEY_PREFIX } from '../lib/auth.js';

/**
 * MCP server (Model Context Protocol) so AI assistants such as Claude can work
 * with agreements: list and inspect them, send from templates, remind, void,
 * and read audit trails. Each tool call goes through the public REST API with
 * the caller's API key, so permissions, validation and audit trails apply as
 * for any other API client.
 *
 * Endpoint: POST /api/v1/mcp with `Authorization: Bearer dsk_...`.
 */

type Call = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>;

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });

function buildServer(call: Call): McpServer {
  const server = new McpServer({ name: 'docsign', version: '1.0.0' });

  server.registerTool(
    'list_agreements',
    {
      description: 'List agreements (envelopes), newest first. Filter by status or search by title or recipient.',
      inputSchema: {
        status: z.enum(['DRAFT', 'SENT', 'COMPLETED', 'DECLINED', 'VOIDED', 'EXPIRED']).optional(),
        search: z.string().max(100).optional(),
      },
    },
    async ({ status, search }) => {
      const qs = new URLSearchParams({ limit: '50', ...(status ? { status } : {}), ...(search ? { search } : {}) });
      return text(await call('GET', `/envelopes?${qs}`));
    },
  );

  server.registerTool(
    'get_agreement',
    { description: 'Get one agreement: status, documents, recipients and who has signed.', inputSchema: { id: z.string() } },
    async ({ id }) => {
      const env = (await call('GET', `/envelopes/${id}`)) as Record<string, unknown> & { fields?: unknown };
      // Field geometry is noise for an assistant
      delete env.fields;
      return text(env);
    },
  );

  server.registerTool('list_templates', { description: 'List templates and their roles (needed to send from a template).', inputSchema: {} }, async () =>
    text(await call('GET', '/templates')),
  );

  server.registerTool(
    'send_from_template',
    {
      description: 'Create and send an agreement from a template. Provide one recipient per template role (roleId from list_templates).',
      inputSchema: {
        templateId: z.string(),
        title: z.string().max(200).optional(),
        recipients: z.array(z.object({ roleId: z.string(), name: z.string(), email: z.string().email() })).min(1),
      },
    },
    async ({ templateId, title, recipients }) => text(await call('POST', `/templates/${templateId}/envelopes`, { title, recipients, send: true })),
  );

  server.registerTool(
    'send_reminder',
    { description: 'Email a reminder to everyone who still needs to sign an agreement.', inputSchema: { id: z.string() } },
    async ({ id }) => text(await call('POST', `/envelopes/${id}/remind`, {})),
  );

  server.registerTool(
    'void_agreement',
    {
      description: 'Cancel an agreement that is out for signature. Recipients are notified. This cannot be undone.',
      inputSchema: { id: z.string(), reason: z.string().min(1).max(500) },
      annotations: { destructiveHint: true },
    },
    async ({ id, reason }) => text(await call('POST', `/envelopes/${id}/void`, { reason })),
  );

  server.registerTool(
    'get_audit_trail',
    { description: 'Get the tamper-evident audit trail of an agreement and whether its hash chain is intact.', inputSchema: { id: z.string() } },
    async ({ id }) => text(await call('GET', `/envelopes/${id}/audit`)),
  );

  server.registerTool(
    'agreement_stats',
    { description: 'Totals, completion rate, turnaround time and signer drop-off for the last N days.', inputSchema: { days: z.number().int().min(7).max(365).optional() } },
    async ({ days }) => text(await call('GET', `/reports?days=${days ?? 90}`)),
  );

  return server;
}

export async function mcpRoutes(app: FastifyInstance) {
  app.post('/mcp', async (req, reply) => {
    const auth = req.headers.authorization ?? '';
    if (!auth.startsWith(`Bearer ${API_KEY_PREFIX}`)) {
      return reply.code(401).send({ error: { code: 'unauthorized', message: 'Use an API key: Authorization: Bearer dsk_...' } });
    }
    const call: Call = async (method, path, body) => {
      const res = await app.inject({
        method,
        url: `/api/v1${path}`,
        headers: { authorization: auth, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
        payload: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const json = res.body ? JSON.parse(res.body) : null;
      // Surface API errors as tool errors the assistant can read and act on
      if (res.statusCode >= 400) throw new Error(json?.error?.message ?? `HTTP ${res.statusCode}`);
      return json;
    };

    const server = buildServer(call);
    // Stateless: a fresh server and transport per request
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    reply.hijack();
    reply.raw.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req.raw, reply.raw, req.body);
  });

  // Stateless server: no SSE stream or session to resume or delete
  for (const method of ['GET', 'DELETE'] as const) {
    app.route({ method, url: '/mcp', handler: async (_req, reply) => reply.code(405).header('Allow', 'POST').send({ error: { code: 'method_not_allowed', message: 'Use POST.' } }) });
  }
}
