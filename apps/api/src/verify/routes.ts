import type { FastifyInstance } from 'fastify';
import { verifyChain } from '../audit/audit.js';
import { prisma } from '../db.js';
import { MAX_UPLOAD_BYTES } from '../documents/ingest.js';
import { sha256Hex } from '../lib/crypto.js';
import { badRequest } from '../lib/errors.js';
import { verifyPdfSignatures } from '../trust/verify.js';

const maskEmail = (email: string) => email.replace(/^(.{1,2})[^@]*(@.*)$/, (_, a, b) => `${a}***${b}`);

/**
 * Public verification portal: anyone holding a document can check that it is
 * an unaltered DocSign original and see who signed it. Nothing is stored.
 */
export async function verifyRoutes(app: FastifyInstance) {
  app.post('/verify', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const file = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    if (!file) throw badRequest('Attach a PDF in the "file" field.');
    const pdf = await file.toBuffer();
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw badRequest('Only PDF files can be verified.');
    const sha256 = sha256Hex(pdf);

    const [doc, certEnvelope] = await Promise.all([
      prisma.document.findFirst({ where: { finalSha256: sha256 }, include: { envelope: { include: { recipients: true } } } }),
      prisma.envelope.findFirst({ where: { certificateSha256: sha256 }, include: { recipients: true } }),
    ]);
    const envelope = doc?.envelope ?? certEnvelope;
    const signatures = await verifyPdfSignatures(pdf);

    let match = null;
    if (envelope) {
      const chain = await verifyChain(envelope.id);
      match = {
        kind: doc ? 'document' : 'certificate',
        documentName: doc?.name ?? 'Certificate of Completion',
        envelopeId: envelope.id,
        title: envelope.title,
        completedAt: envelope.completedAt,
        jurisdiction: envelope.jurisdiction,
        signers: envelope.recipients
          .filter((r) => r.role !== 'CC')
          .sort((a, b) => a.routingOrder - b.routingOrder)
          .map((r) => ({ name: r.name, email: maskEmail(r.email), signedAt: r.signedAt })),
        auditTrail: { valid: chain.valid, events: chain.count },
      };
    }
    return { sha256, size: pdf.length, match, signatures };
  });
}
