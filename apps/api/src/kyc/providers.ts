import { createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { hmacSha256Hex, safeEqualHex } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';

/**
 * Identity verification providers (India).
 *
 *  - sandbox: deterministic answers for development and tests (rules below).
 *  - cashfree: Cashfree Verification Suite (PAN, bank account penny-drop).
 *  - DigiLocker: the government's OAuth 2.0 API (MeriPehchaan) for Aadhaar
 *    e-KYC, with its own sandbox page.
 *
 * The production adapters follow the providers' published APIs and are
 * untested without real credentials.
 *
 * Sandbox rules: PANs or account numbers containing "0000" are "not found";
 * the registered name is the name the signer enters (or the recipient's name).
 */

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export interface PanResult {
  valid: boolean;
  registeredName: string | null;
  /** 4th PAN character: P individual, C company, H HUF, F firm, T trust ... */
  holderType: string;
  ref?: string;
}

export interface BankResult {
  valid: boolean;
  nameAtBank: string | null;
  bankName?: string;
  branch?: string;
  ref?: string;
}

export interface AadhaarKyc {
  name: string;
  dob: string | null;
  gender: string | null;
  aadhaarLast4: string | null;
}

export const maskPan = (pan: string) => `${pan.slice(0, 2)}XXXXX${pan.slice(-3)}`;
export const maskAccount = (acc: string) => `XXXX${acc.slice(-4)}`;

// --- Cashfree Verification Suite ---------------------------------------------

async function cashfree<T>(path: string, body: unknown): Promise<T> {
  const { clientId, clientSecret, baseUrl } = config.kyc.cashfree;
  if (!clientId || !clientSecret) throw new HttpError(503, 'Identity verification is not configured.', 'kyc_unavailable');
  const res = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-client-id': clientId, 'x-client-secret': clientSecret },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status >= 500) throw new HttpError(502, 'The verification service is unavailable. Try again shortly.', 'kyc_error');
  return (await res.json()) as T;
}

export async function verifyPan(pan: string, name: string): Promise<PanResult> {
  const holderType = pan[3];
  if (config.kyc.provider === 'sandbox') {
    return { valid: !pan.includes('0000'), registeredName: pan.includes('0000') ? null : name, holderType, ref: `sbx_pan_${randomBytes(4).toString('hex')}` };
  }
  const r = await cashfree<{ valid?: boolean; registered_name?: string; reference_id?: number | string }>('/pan', { pan, name });
  return { valid: Boolean(r.valid), registeredName: r.registered_name ?? null, holderType, ref: r.reference_id ? String(r.reference_id) : undefined };
}

export async function verifyBankAccount(account: string, ifsc: string, name: string): Promise<BankResult> {
  if (config.kyc.provider === 'sandbox') {
    const valid = !account.includes('0000');
    return { valid, nameAtBank: valid ? name : null, bankName: `${ifsc.slice(0, 4)} Bank (sandbox)`, branch: 'Sandbox branch', ref: `sbx_bank_${randomBytes(4).toString('hex')}` };
  }
  const r = await cashfree<{ account_status?: string; name_at_bank?: string; bank_name?: string; branch?: string; reference_id?: number | string }>(
    '/bank-account/sync',
    { bank_account: account, ifsc, name },
  );
  return {
    valid: r.account_status === 'VALID',
    nameAtBank: r.name_at_bank ?? null,
    bankName: r.bank_name,
    branch: r.branch,
    ref: r.reference_id ? String(r.reference_id) : undefined,
  };
}

// --- DigiLocker (OAuth 2.0 with PKCE) ------------------------------------------

export const pkcePair = () => {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
};

export const digilockerRedirectUri = () => `${config.appUrl}/api/v1/kyc/digilocker/callback`;

export function digilockerAuthorizeUrl(state: string, codeChallenge: string): string {
  if (config.kyc.digilocker.mode === 'sandbox') return `${config.appUrl}/api/v1/dev/digilocker?state=${encodeURIComponent(state)}`;
  const { clientId, baseUrl } = config.kyc.digilocker;
  if (!clientId) throw new HttpError(503, 'DigiLocker is not configured.', 'kyc_unavailable');
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: digilockerRedirectUri(),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });
  return `${baseUrl}/1/authorize?${q}`;
}

/** Sandbox authorization codes carry the KYC data, signed so they can't be edited in transit. */
export function sandboxDigilockerCode(kyc: AadhaarKyc): string {
  const payload = Buffer.from(JSON.stringify(kyc)).toString('base64url');
  return `sbx.${payload}.${hmacSha256Hex(config.appSecret, `digilocker:${payload}`)}`;
}

function attr(xml: string, tag: string, name: string): string | null {
  const el = new RegExp(`<${tag}\\b[^>]*>`, 'i').exec(xml)?.[0];
  return el ? (new RegExp(`\\b${name}="([^"]*)"`, 'i').exec(el)?.[1] ?? null) : null;
}

export async function digilockerExchange(code: string, codeVerifier: string): Promise<AadhaarKyc> {
  if (config.kyc.digilocker.mode === 'sandbox') {
    const [prefix, payload, mac] = code.split('.');
    if (prefix !== 'sbx' || !payload || !mac || !safeEqualHex(mac, hmacSha256Hex(config.appSecret, `digilocker:${payload}`))) {
      throw new HttpError(400, 'Invalid DigiLocker response.', 'kyc_invalid');
    }
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as AadhaarKyc;
  }
  const { clientId, clientSecret, baseUrl } = config.kyc.digilocker;
  const tokenRes = await fetch(`${baseUrl}/1/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret, redirect_uri: digilockerRedirectUri(), code_verifier: codeVerifier }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!tokenRes.ok) throw new HttpError(502, 'DigiLocker did not complete the sign-in.', 'kyc_error');
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const auth = { Authorization: `Bearer ${access_token}` };
  const xmlRes = await fetch(`${baseUrl}/3/xml/eaadhaar`, { headers: auth, signal: AbortSignal.timeout(20_000) });
  if (xmlRes.ok) {
    const xml = await xmlRes.text();
    const uid = attr(xml, 'UidData', 'uid');
    return { name: attr(xml, 'Poi', 'name') ?? '', dob: attr(xml, 'Poi', 'dob'), gender: attr(xml, 'Poi', 'gender'), aadhaarLast4: uid ? uid.slice(-4) : null };
  }
  // Accounts without a linked Aadhaar still return basic profile details
  const userRes = await fetch(`${baseUrl}/1/user`, { headers: auth, signal: AbortSignal.timeout(20_000) });
  if (!userRes.ok) throw new HttpError(502, 'DigiLocker did not return your details.', 'kyc_error');
  const u = (await userRes.json()) as { name?: string; dob?: string; gender?: string };
  return { name: u.name ?? '', dob: u.dob ?? null, gender: u.gender ?? null, aadhaarLast4: null };
}
