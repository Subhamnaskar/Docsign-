import type { FastifyInstance } from 'fastify';
import { StandardFonts } from 'pdf-lib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { getObject } from '../src/lib/storage.js';
import { renewArchiveTimestamps } from '../src/trust/archive.js';
import { incrementalUpdate } from '../src/trust/incremental.js';
import { inspectLtv } from '../src/trust/ltv.js';
import { sealPdf } from '../src/trust/pades.js';
import { verifyPdfSignatures } from '../src/trust/verify.js';
import { client, getApp, lastMail, makePdf, multipart, registerSender, signaturePng, uid, waitFor } from './helpers.js';
import { startTestTsa } from './tsa.js';

let app: FastifyInstance;
let tsa: Awaited<ReturnType<typeof startTestTsa>>;
beforeAll(async () => {
  app = await getApp();
  tsa = await startTestTsa();
});
afterAll(async () => {
  config.tsaUrl = '';
  await tsa.close();
});

/** Runs `fn` with the test timestamp authority configured. */
async function withTsa<T>(fn: () => Promise<T>): Promise<T> {
  config.tsaUrl = tsa.url;
  try {
    return await fn();
  } finally {
    config.tsaUrl = '';
  }
}

describe('long-term validation', () => {
  it('embeds certificates and revocation data after the seal (B-LT data)', async () => {
    const sealed = await sealPdf(await makePdf('LTV'), { reason: 'test' });
    // Without a timestamp the baseline level stays B-B, but the DSS is complete
    expect(sealed.format).toBe('PAdES-B-B');
    expect(sealed.ltv).toMatchObject({ level: 'PAdES-B-LT', certificates: 2, crls: 1, missing: [] });
    expect(inspectLtv(sealed.pdf)).toEqual({ dss: true, documentTimestamps: 0 });

    const [sig] = await verifyPdfSignatures(sealed.pdf);
    expect(sig).toMatchObject({ kind: 'signature', integrityValid: true, laterChanges: 'validation-data', coversWholeDocument: true });
  });

  it('still flags real edits made after the validation data', async () => {
    const sealed = await sealPdf(await makePdf('LTV'), { reason: 'test' });
    const edited = await incrementalUpdate(sealed.pdf, async (doc) => {
      const font = await doc.embedFont(StandardFonts.Helvetica);
      doc.getPage(0).drawText('PAID IN FULL', { x: 50, y: 50, size: 20, font });
    });
    const [sig] = await verifyPdfSignatures(edited);
    expect(sig.integrityValid).toBe(true);
    expect(sig).toMatchObject({ laterChanges: 'other', coversWholeDocument: false });
  });

  it('reaches B-LTA with a document timestamp when a timestamp authority is set', async () => {
    const input = await makePdf('LTA');
    const sealed = await withTsa(() => sealPdf(input, { reason: 'test' }));
    expect(sealed.format).toBe('PAdES-B-LTA');
    expect(sealed.timestamp.timestamped).toBe(true);
    expect(sealed.ltv.documentTimestamp).toBeInstanceOf(Date);
    expect(inspectLtv(sealed.pdf)).toEqual({ dss: true, documentTimestamps: 1 });

    const [seal, archive] = await verifyPdfSignatures(sealed.pdf);
    expect(seal).toMatchObject({ kind: 'signature', integrityValid: true, coversWholeDocument: true, timestamp: { valid: true } });
    expect(archive).toMatchObject({ kind: 'document-timestamp', subFilter: 'ETSI.RFC3161', signerName: 'Test TSA', integrityValid: true, laterChanges: 'none' });
    expect(archive.timestamp?.valid).toBe(true);
  });

  it('renews archive timestamps and keeps the earlier copy verifiable', async () => {
    // A completed agreement sealed with the timestamp authority available
    const { c } = await registerSender(app);
    const email = `ltv-${uid()}@example.test`;
    let env = await c.json('POST', '/envelopes', { json: { title: 'Archive me' } });
    const { payload, headers } = multipart('a.pdf', await makePdf('Archive'));
    const doc = await c.json('POST', `/envelopes/${env.id}/documents`, { payload, headers });
    env = await c.json('PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Signer', email }] });
    await c.json('PUT', `/envelopes/${env.id}/fields`, {
      json: [{ documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.1, width: 0.3, height: 0.06 }],
    });
    await c.json('POST', `/envelopes/${env.id}/send`);
    const link = lastMail(email, /Please sign/).text.match(/\/sign\/([\w.-]+)/)![1];
    const s = client(app);
    await s.json('POST', `/signing/${link}/otp/send`);
    await s.json('POST', `/signing/${link}/otp/verify`, { json: { code: lastMail(email, /\d{6}/).subject.match(/\d{6}/)![0] } });
    const session = await s.json('GET', `/signing/${link}`);
    config.tsaUrl = tsa.url;
    try {
      await s.json('POST', `/signing/${link}/complete`, { json: { consent: true, values: { [session.fields[0].id]: signaturePng() } } });
      await waitFor(() => c.json('GET', `/envelopes/${env.id}`), (e) => e.status === 'COMPLETED');
    } finally {
      config.tsaUrl = '';
    }
    const before = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(before.ltvLevel).toBe('PAdES-B-LTA');
    expect(before.archiveTimestampAt).not.toBeNull();
    const oldPdf = await getObject(before.finalKey!);

    // Nothing is due yet
    expect((await withTsa(() => renewArchiveTimestamps())).renewed).toBe(0);
    const { renewed } = await withTsa(() => renewArchiveTimestamps({ olderThanDays: 0, now: new Date(Date.now() + 60_000) }));
    expect(renewed).toBeGreaterThanOrEqual(2); // document and certificate

    const after = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(after.finalSha256).not.toBe(before.finalSha256);
    expect(after.priorSha256).toContain(before.finalSha256);
    const newPdf = await getObject(after.finalKey!);
    expect(inspectLtv(newPdf).documentTimestamps).toBe(2);
    const reports = await verifyPdfSignatures(newPdf);
    expect(reports.every((r) => r.integrityValid && r.coversWholeDocument)).toBe(true);

    const audit = await c.json('GET', `/envelopes/${env.id}/audit`);
    expect(audit.events.some((e: { type: string }) => e.type === 'document.archive_timestamp_renewed')).toBe(true);

    // Both copies verify publicly; the old one is marked as superseded
    for (const [pdf, superseded] of [[oldPdf, true], [newPdf, false]] as const) {
      const { payload: p, headers: h } = multipart('v.pdf', pdf);
      const res = (await app.inject({ method: 'POST', url: '/api/v1/verify', payload: p, headers: h })).json();
      expect(res.match).toMatchObject({ kind: 'document', superseded });
      expect(res.ltv.dss).toBe(true);
    }
  });
});
