import { describe, expect, it } from 'vitest';
import { appendAudit, verifyChain } from '../src/audit/audit.js';
import { prisma } from '../src/db.js';
import { sealPdf } from '../src/trust/pades.js';
import { verifyPdfSignatures } from '../src/trust/verify.js';
import { makePdf, registerSender, getApp } from './helpers.js';

describe('PAdES seal', () => {
  it('produces a valid signature covering the whole file', async () => {
    const sealed = await sealPdf(await makePdf(), { reason: 'test' });
    expect(sealed.format).toBe('PAdES-B-B');
    const [sig] = await verifyPdfSignatures(sealed.pdf);
    expect(sig).toMatchObject({
      subFilter: 'ETSI.CAdES.detached',
      signerName: 'DocSign Platform Seal',
      integrityValid: true,
      coversWholeDocument: true,
    });
  });

  it('detects a single changed byte', async () => {
    const sealed = await sealPdf(await makePdf(), { reason: 'test' });
    const tampered = Buffer.from(sealed.pdf);
    tampered[300] ^= 1;
    const [sig] = await verifyPdfSignatures(tampered);
    expect(sig.integrityValid).toBe(false);
  });

  it('detects content appended after signing', async () => {
    const sealed = await sealPdf(await makePdf(), { reason: 'test' });
    const [sig] = await verifyPdfSignatures(Buffer.concat([sealed.pdf, Buffer.from('\n% appended\n')]));
    expect(sig.integrityValid).toBe(true);
    expect(sig.coversWholeDocument).toBe(false);
  });
});

describe('audit hash chain', () => {
  it('verifies an intact chain and pinpoints tampering', async () => {
    const app = await getApp();
    const { c } = await registerSender(app);
    const env = await c.json('POST', '/envelopes', { json: { title: 'Chain test' } });
    for (let i = 0; i < 3; i++) {
      await prisma.$transaction((tx) => appendAudit(tx, { envelopeId: env.id, type: 'test.event', actor: { kind: 'system' }, data: { i } }));
    }
    expect(await verifyChain(env.id)).toMatchObject({ valid: true, count: 4 });

    await prisma.auditEvent.updateMany({ where: { envelopeId: env.id, seq: 3 }, data: { data: { i: 99 } } });
    expect(await verifyChain(env.id)).toMatchObject({ valid: false, brokenAtSeq: 3 });

    await prisma.auditEvent.deleteMany({ where: { envelopeId: env.id, seq: 3 } });
    expect((await verifyChain(env.id)).valid).toBe(false);
  });
});
