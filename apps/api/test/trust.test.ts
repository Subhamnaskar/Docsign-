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

describe('incremental signatures', () => {
  it('keeps earlier signatures valid as later ones are appended', async () => {
    const { normalizeForSigning } = await import('../src/trust/incremental.js');
    const { signIncremental, sealPdfIncremental } = await import('../src/trust/pades.js');
    const { CadesSigner } = await import('../src/trust/cades.js');
    const { sealKeyProvider } = await import('../src/trust/keys.js');
    const { signaturePng } = await import('./helpers.js');
    const signer = new CadesSigner(sealKeyProvider(), '');

    let pdf = await normalizeForSigning(await makePdf('Multi-signer', 2));
    for (const [i, who] of ['Asha', 'Ben'].entries()) {
      pdf = await signIncremental(
        pdf,
        {
          fieldName: `Signer ${i + 1}`,
          reason: 'Agreement',
          name: who,
          appearance: { page: 1, rect: [72, 100 + i * 80, 272, 160 + i * 80], lines: [`Signed by ${who}`, '2026-10-24'], image: Buffer.from(signaturePng().split(',')[1], 'base64') },
        },
        (c) => signer.sign(c),
      );
    }
    pdf = (await sealPdfIncremental(pdf, { reason: 'Seal' })).pdf;

    const sigs = await verifyPdfSignatures(pdf);
    expect(sigs).toHaveLength(3);
    expect(sigs.every((s) => s.integrityValid)).toBe(true);
    expect(sigs.map((s) => s.coversWholeDocument)).toEqual([false, false, true]);

    // Still a valid PDF for other tools, with both signature fields
    const { PDFDocument } = await import('pdf-lib');
    const loaded = await PDFDocument.load(pdf);
    expect(loaded.getForm().getFields().length).toBe(3);

    // Tampering with the first revision breaks the first signature
    const tampered = Buffer.from(pdf);
    tampered[200] ^= 1;
    expect((await verifyPdfSignatures(tampered)).every((s) => !s.integrityValid)).toBe(true);
  });
});
