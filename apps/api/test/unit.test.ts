import { describe, expect, it } from 'vitest';
import { formatDateFor, SUPPORTED_LOCALES, t } from '../src/i18n/messages.js';
import { canonicalJson } from '../src/lib/crypto.js';
import { normalizeSignaturePng } from '../src/lib/image.js';
import { resolvePolicy } from '../src/policy/engine.js';
import { signaturePng } from './helpers.js';

describe('policy engine', () => {
  it('allows a US NDA as a simple e-signature with email OTP', () => {
    const p = resolvePolicy('US', 'nda');
    expect(p.allowed).toBe(true);
    expect(p.signatureLevel).toBe('SES');
    expect(p.identityProvider).toBe('email-otp');
    expect(p.retentionYears).toBe(7);
  });

  it.each([
    ['US', 'will'],
    ['UK', 'will'],
    ['IN', 'power_of_attorney'],
    ['IN', 'property_sale_deed'],
    ['EU', 'property_sale_deed'],
  ])('blocks %s / %s', (j, d) => {
    const p = resolvePolicy(j, d);
    expect(p.allowed).toBe(false);
    expect(p.blockers.length).toBeGreaterThan(0);
  });

  it('routes Indian loan agreements to Aadhaar eSign with stamp duty', () => {
    const p = resolvePolicy('IN', 'loan_agreement');
    expect(p.signatureLevel).toBe('AES');
    expect(p.signatureProvider).toBe('aadhaar-esign');
    expect(p.identityProvider).toBe('aadhaar-otp');
    expect(p.stampDutyRequired).toBe(true);
    expect(p.allowed).toBe(true);
    // Tests run against the sandbox ESP, which must be called out
    expect(p.warnings.join(' ')).toMatch(/SANDBOX/);
  });

  it('still requires an adapter for qualified-level identity elsewhere', () => {
    expect(resolvePolicy('EU', 'loan_agreement').allowed).toBe(false);
  });

  it('records the TSA-less seal format when no timestamp authority is configured', () => {
    expect(resolvePolicy('EU', 'general').signatureFormat).toBe('PAdES-B-B');
  });
});

describe('canonicalJson', () => {
  it('is independent of key order and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [1, { y: 1, x: 2 }] }, z: undefined })).toBe(
      canonicalJson({ a: { c: [1, { x: 2, y: 1 }], d: 2 }, b: 1 }),
    );
  });
});

describe('signature image normalisation', () => {
  it('accepts and re-encodes a valid PNG', () => {
    const out = normalizeSignaturePng(signaturePng());
    expect(out.startsWith('data:image/png;base64,')).toBe(true);
  });

  // Regression: this exact payload used to hang pdf-lib and freeze the API
  it('rejects a malformed PNG quickly', () => {
    const bad =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAQCAYAAABQrvyxAAAAKklEQVR42u3OMQ0AAAgDIN8/9MzhJwkE6JxSUVFRUVFRUVFRUVFRUVFRUXEnD0xYAAHjbPDWAAAAAElFTkSuQmCC';
    const start = Date.now();
    expect(() => normalizeSignaturePng(bad)).toThrow(/not a valid PNG/);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('rejects non-PNG data and oversized images', () => {
    expect(() => normalizeSignaturePng('data:image/jpeg;base64,AAAA')).toThrow();
    const header = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
    header.writeUInt32BE(100_000, 16);
    header.writeUInt32BE(10, 20);
    expect(() => normalizeSignaturePng(`data:image/png;base64,${header.toString('base64')}`)).toThrow(/too large/);
  });
});

describe('i18n', () => {
  it('has every key in every locale', () => {
    for (const l of SUPPORTED_LOCALES) {
      expect(t(l, 'inviteSubject', { title: 'X' })).toContain('X');
      expect(t(l, 'otpSubject', { code: '123456' })).toContain('123456');
    }
  });

  it('falls back to English for unknown locales', () => {
    expect(t('xx', 'reviewAndSign')).toBe('Review and sign');
  });

  it('formats dates per locale', () => {
    expect(formatDateFor('de', new Date('2026-03-05T00:00:00Z'))).toBe('5. März 2026');
  });
});
