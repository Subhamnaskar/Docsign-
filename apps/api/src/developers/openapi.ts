import { config } from '../config.js';

/**
 * OpenAPI 3.1 description of the public API (the parts integrators use).
 * Kept by hand next to the routes; validated in tests against live responses.
 */

const id = { type: 'string', example: 'cmabc123def456' };
const err = { $ref: '#/components/responses/Error' };
const json = (schema: object) => ({ 'application/json': { schema } });
const ok = (schema: object, description = 'OK') => ({ description, content: json(schema) });
const pathId = (name: string) => ({ name, in: 'path', required: true, schema: { type: 'string' } });

export function openApiSpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'DocSign API',
      version: '1.0.0',
      description:
        'Create, send and track agreements. Authenticate with `Authorization: Bearer <key>`. Keys starting `dsk_test_` create watermarked test agreements that are not billed; `dsk_` keys are live.',
    },
    servers: [{ url: `${config.appUrl}/api/v1` }],
    security: [{ apiKey: [] }],
    components: {
      securitySchemes: { apiKey: { type: 'http', scheme: 'bearer', description: 'API key from Settings → API & webhooks' } },
      responses: {
        Error: {
          description: 'Error',
          content: json({
            type: 'object',
            properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} }, required: ['code', 'message'] } },
          }),
        },
      },
      schemas: {
        Recipient: {
          type: 'object',
          required: ['name', 'email'],
          properties: {
            id: id,
            name: { type: 'string' },
            email: { type: 'string', format: 'email' },
            role: { type: 'string', enum: ['SIGNER', 'APPROVER', 'CC'], default: 'SIGNER' },
            routingOrder: { type: 'integer', minimum: 1, default: 1 },
            locale: { type: 'string', example: 'hi', description: 'Language for emails and the signing page' },
            authMethod: { type: 'string', enum: ['EMAIL_OTP', 'SMS_OTP', 'WHATSAPP_OTP', 'ACCESS_CODE'] },
            phone: { type: 'string', example: '+919876543210' },
            signatureMethod: { type: 'string', enum: ['ELECTRONIC', 'AADHAAR_ESIGN', 'DSC'] },
            idChecks: { type: 'array', items: { type: 'string', enum: ['PAN', 'BANK', 'DIGILOCKER', 'VIDEO'] } },
            embedded: { type: 'boolean', description: 'Sign inside your app via an embedded session' },
            clientUserId: { type: 'string' },
            status: { type: 'string', readOnly: true },
          },
        },
        Field: {
          type: 'object',
          required: ['documentId', 'recipientId', 'type', 'page', 'x', 'y', 'width', 'height'],
          properties: {
            documentId: id,
            recipientId: id,
            type: { type: 'string', enum: ['SIGNATURE', 'INITIALS', 'DATE_SIGNED', 'NAME', 'EMAIL', 'TEXT', 'CHECKBOX', 'DROPDOWN', 'RADIO', 'NUMBER', 'FORMULA', 'ATTACHMENT', 'PAYMENT', 'MANDATE'] },
            page: { type: 'integer', minimum: 0, description: 'Zero-based page index' },
            x: { type: 'number', minimum: 0, maximum: 1, description: 'Fractions of the page from the top-left corner' },
            y: { type: 'number', minimum: 0, maximum: 1 },
            width: { type: 'number', minimum: 0, maximum: 1 },
            height: { type: 'number', minimum: 0, maximum: 1 },
            required: { type: 'boolean', default: true },
            label: { type: 'string' },
            options: { type: 'array', items: { type: 'string' } },
            formula: { type: 'string', example: '{Qty} * {Price}' },
            amount: { type: 'integer', description: 'PAYMENT / MANDATE: minor units' },
            currency: { type: 'string', example: 'INR' },
          },
        },
        Document: {
          type: 'object',
          properties: { id, name: { type: 'string' }, pageCount: { type: 'integer' }, sha256: { type: 'string' }, finalSha256: { type: ['string', 'null'] }, completed: { type: 'boolean' } },
        },
        Envelope: {
          type: 'object',
          properties: {
            id,
            title: { type: 'string' },
            message: { type: ['string', 'null'] },
            status: { type: 'string', enum: ['DRAFT', 'SENT', 'COMPLETED', 'DECLINED', 'VOIDED', 'EXPIRED'] },
            jurisdiction: { type: 'string', example: 'IN' },
            documentType: { type: 'string', example: 'employment_offer' },
            testMode: { type: 'boolean' },
            sentAt: { type: ['string', 'null'], format: 'date-time' },
            completedAt: { type: ['string', 'null'], format: 'date-time' },
            documents: { type: 'array', items: { $ref: '#/components/schemas/Document' } },
            recipients: { type: 'array', items: { $ref: '#/components/schemas/Recipient' } },
            fields: { type: 'array', items: { $ref: '#/components/schemas/Field' } },
            readiness: { type: 'array', items: { type: 'string' }, description: 'Problems that block sending (drafts)' },
          },
        },
        EnvelopeInput: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string', maxLength: 200 },
            message: { type: 'string' },
            jurisdiction: { type: 'string' },
            documentType: { type: 'string' },
            routing: { type: 'string', enum: ['SEQUENTIAL', 'PARALLEL'] },
            reminderDays: { type: 'integer', minimum: 0, maximum: 30 },
            expiresAt: { type: 'string', format: 'date-time' },
          },
        },
        WebhookEvent: {
          type: 'object',
          description: 'Signed with `X-DocSign-Signature: t=<unix>,v1=<hex HMAC-SHA256(secret, "t.body")>`',
          properties: {
            id: { type: 'string' },
            event: { type: 'string', enum: ['envelope.sent', 'recipient.viewed', 'recipient.signed', 'recipient.declined', 'envelope.completed', 'envelope.voided', 'envelope.expired'] },
            createdAt: { type: 'string', format: 'date-time' },
            data: { type: 'object' },
          },
        },
      },
    },
    paths: {
      '/envelopes': {
        get: {
          summary: 'List agreements',
          parameters: [
            { name: 'status', in: 'query', schema: { type: 'string' } },
            { name: 'search', in: 'query', schema: { type: 'string' } },
            { name: 'limit', in: 'query', schema: { type: 'integer', maximum: 100 } },
            { name: 'cursor', in: 'query', schema: { type: 'string' } },
          ],
          responses: { 200: ok({ type: 'object', properties: { data: { type: 'array', items: { $ref: '#/components/schemas/Envelope' } }, nextCursor: { type: ['string', 'null'] } } }), 401: err },
        },
        post: { summary: 'Create a draft', requestBody: { required: true, content: json({ $ref: '#/components/schemas/EnvelopeInput' }) }, responses: { 201: ok({ $ref: '#/components/schemas/Envelope' }, 'Created'), 400: err } },
      },
      '/envelopes/{id}': {
        parameters: [pathId('id')],
        get: { summary: 'Get an agreement', responses: { 200: ok({ $ref: '#/components/schemas/Envelope' }), 404: err } },
        patch: { summary: 'Update a draft', requestBody: { content: json({ $ref: '#/components/schemas/EnvelopeInput' }) }, responses: { 200: ok({ $ref: '#/components/schemas/Envelope' }), 409: err } },
        delete: { summary: 'Delete a draft', responses: { 204: { description: 'Deleted' }, 409: err } },
      },
      '/envelopes/{id}/documents': {
        parameters: [pathId('id')],
        post: {
          summary: 'Upload a document (PDF, Word, Excel, PowerPoint, ODT, RTF, TXT; up to 25 MB)',
          requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } }, required: ['file'] } } } },
          responses: { 201: ok({ $ref: '#/components/schemas/Document' }, 'Created'), 400: err },
        },
      },
      '/envelopes/{id}/recipients': {
        parameters: [pathId('id')],
        put: { summary: 'Set recipients (include `id` to keep a recipient and their fields)', requestBody: { required: true, content: json({ type: 'array', items: { $ref: '#/components/schemas/Recipient' } }) }, responses: { 200: ok({ $ref: '#/components/schemas/Envelope' }), 400: err } },
      },
      '/envelopes/{id}/fields': {
        parameters: [pathId('id')],
        put: { summary: 'Replace all fields', requestBody: { required: true, content: json({ type: 'array', items: { $ref: '#/components/schemas/Field' } }) }, responses: { 200: ok({ $ref: '#/components/schemas/Envelope' }), 400: err } },
      },
      '/envelopes/{id}/send': {
        parameters: [pathId('id')],
        post: { summary: 'Send for signature', responses: { 200: ok({ $ref: '#/components/schemas/Envelope' }), 402: err, 422: err } },
      },
      '/envelopes/{id}/remind': { parameters: [pathId('id')], post: { summary: 'Email pending signers again', responses: { 200: ok({ type: 'object' }) } } },
      '/envelopes/{id}/void': {
        parameters: [pathId('id')],
        post: { summary: 'Cancel an agreement out for signature', requestBody: { content: json({ type: 'object', properties: { reason: { type: 'string' } }, required: ['reason'] }) }, responses: { 200: ok({ $ref: '#/components/schemas/Envelope' }), 409: err } },
      },
      '/envelopes/{id}/documents/{docId}/file': {
        parameters: [pathId('id'), pathId('docId'), { name: 'version', in: 'query', schema: { type: 'string', enum: ['original'] } }],
        get: { summary: 'Download the sealed PDF (or the original)', responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } } } },
      },
      '/envelopes/{id}/certificate': {
        parameters: [pathId('id')],
        get: { summary: 'Download the certificate of completion', responses: { 200: { description: 'PDF', content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } } } } },
      },
      '/envelopes/{id}/audit': { parameters: [pathId('id')], get: { summary: 'Audit events with hash-chain verification', responses: { 200: ok({ type: 'object' }) } } },
      '/envelopes/{id}/recipients/{rid}/embedded-session': {
        parameters: [pathId('id'), pathId('rid')],
        post: { summary: 'One-time URL for embedded signing in an iframe', requestBody: { content: json({ type: 'object', properties: { returnUrl: { type: 'string', format: 'uri' } } }) }, responses: { 200: ok({ type: 'object', properties: { url: { type: 'string' }, expiresAt: { type: 'string' } } }) } },
      },
      '/templates': { get: { summary: 'List templates and their roles', responses: { 200: ok({ type: 'array', items: { type: 'object' } }) } } },
      '/templates/{id}/envelopes': {
        parameters: [pathId('id')],
        post: {
          summary: 'Create (and optionally send) an agreement from a template',
          requestBody: { content: json({ type: 'object', properties: { send: { type: 'boolean' }, recipients: { type: 'array', items: { type: 'object', properties: { roleId: id, name: { type: 'string' }, email: { type: 'string' } } } } } }) },
          responses: { 201: ok({ $ref: '#/components/schemas/Envelope' }, 'Created') },
        },
      },
      '/doc-templates/{id}/generate': {
        parameters: [pathId('id')],
        post: {
          summary: 'Fill a Word template and add the PDF to a (new) draft',
          requestBody: { content: json({ type: 'object', required: ['data'], properties: { data: { type: 'object', additionalProperties: true }, envelopeId: id, title: { type: 'string' } } }) },
          responses: { 201: ok({ type: 'object', properties: { envelopeId: id, document: { $ref: '#/components/schemas/Document' } } }, 'Created') },
        },
      },
      '/webhooks': {
        post: {
          summary: 'Register a webhook endpoint (signed with HMAC-SHA256)',
          requestBody: { content: json({ type: 'object', required: ['url'], properties: { url: { type: 'string', format: 'uri' }, events: { type: 'array', items: { type: 'string' } } } }) },
          responses: { 201: ok({ type: 'object', properties: { id, url: { type: 'string' }, secret: { type: 'string' } } }, 'Created') },
          callbacks: { event: { '{$request.body#/url}': { post: { requestBody: { content: json({ $ref: '#/components/schemas/WebhookEvent' }) }, responses: { 200: { description: 'Received' } } } } } },
        },
      },
      '/verify': {
        post: {
          summary: 'Verify a signed PDF (public, no key needed)',
          security: [],
          requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } } } },
          responses: { 200: ok({ type: 'object' }) },
        },
      },
    },
  };
}
