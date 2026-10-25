import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { sandboxCsc } from './sandbox.js';

/**
 * Client for a Qualified Trust Service Provider's Cloud Signature Consortium
 * API v2 (remote qualified signatures under eIDAS). The signer authorises
 * twice through OAuth 2.0: once to use the service (we read their
 * certificate) and once for the specific hashes being signed (PIN/OTP at the
 * QTSP). The production adapter follows the CSC v2 specification and is
 * untested without a QTSP contract.
 */

const SHA256_OID = '2.16.840.1.101.3.4.2.1';
const SHA256_WITH_RSA_OID = '1.2.840.113549.1.1.11';

export const cscRedirectUri = () => `${config.appUrl}/api/v1/qes/callback`;

const oauthBase = () => (config.csc.mode === 'sandbox' ? `${config.appUrl}/api/v1/dev/csc/oauth2` : `${config.csc.oauthUrl.replace(/\/$/, '')}`);
const apiBase = () => (config.csc.mode === 'sandbox' ? `${config.appUrl}/api/v1/dev/csc/csc/v2` : config.csc.apiUrl.replace(/\/$/, ''));
const clientId = () => (config.csc.mode === 'sandbox' ? 'docsign-sandbox' : config.csc.clientId);

function requireConfigured() {
  if (config.csc.mode === 'production' && (!config.csc.apiUrl || !config.csc.oauthUrl || !config.csc.clientId)) {
    throw new HttpError(503, 'Qualified signatures are not configured.', 'qes_unavailable');
  }
}

/** Step 1: access to the service, to list the signer's credentials. */
export function serviceAuthorizeUrl(state: string, loginHint: string) {
  requireConfigured();
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId(), redirect_uri: cscRedirectUri(), scope: 'service', state, login_hint: loginHint });
  return `${oauthBase()}/authorize?${q}`;
}

/** Step 2: authorisation for exactly these hashes with this credential (the signer's PIN/OTP). */
export function credentialAuthorizeUrl(state: string, credentialID: string, hashes: string[]) {
  const q = new URLSearchParams({
    response_type: 'code',
    client_id: clientId(),
    redirect_uri: cscRedirectUri(),
    scope: 'credential',
    state,
    credentialID,
    numSignatures: String(hashes.length),
    // base64url in the URL; the signHash call uses standard base64
    hashes: hashes.map((h) => Buffer.from(h, 'base64').toString('base64url')).join(','),
    hashAlgorithmOID: SHA256_OID,
  });
  return `${oauthBase()}/authorize?${q}`;
}

const sandbox = () => config.csc.mode === 'sandbox';
const refused = () => new HttpError(502, 'The trust service refused the request.', 'qes_error');

export async function exchangeCode(code: string): Promise<string> {
  if (sandbox()) {
    const token = sandboxCsc.token(code);
    if (!token) throw new HttpError(502, 'The trust service did not complete the sign-in.', 'qes_error');
    return token;
  }
  const res = await fetch(`${oauthBase()}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId(), client_secret: config.csc.clientSecret, redirect_uri: cscRedirectUri() }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new HttpError(502, 'The trust service did not complete the sign-in.', 'qes_error');
  return ((await res.json()) as { access_token: string }).access_token;
}

async function api<T>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(`${apiBase()}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new HttpError(502, `The trust service refused the request (${res.status}).`, 'qes_error');
  return (await res.json()) as T;
}

export async function firstCredential(token: string): Promise<string> {
  if (sandbox()) {
    const ids = sandboxCsc.list(token);
    if (!ids) throw refused();
    return ids[0];
  }
  const { credentialIDs } = await api<{ credentialIDs: string[] }>('/credentials/list', token, { maxResults: 10 });
  if (!credentialIDs?.length) throw new HttpError(422, 'You have no signing certificate with this trust service.', 'qes_no_credential');
  return credentialIDs[0];
}

/** Certificate chain (DER), signer certificate first. RSA keys only. */
export async function credentialChain(token: string, credentialID: string): Promise<Buffer[]> {
  if (sandbox()) {
    const chain = sandboxCsc.chain(token, credentialID);
    if (!chain) throw refused();
    return chain.map((c) => Buffer.from(c, 'base64'));
  }
  const info = await api<{ cert?: { certificates?: string[] }; key?: { algo?: string[] } }>('/credentials/info', token, { credentialID, certificates: 'chain' });
  const certs = info.cert?.certificates ?? [];
  if (!certs.length) throw new HttpError(502, 'The trust service did not return a certificate.', 'qes_error');
  if (info.key?.algo && !info.key.algo.some((a) => a.startsWith('1.2.840.113549.1.1'))) {
    throw new HttpError(422, 'Only RSA signing certificates are supported for now.', 'qes_unsupported_key');
  }
  return certs.map((c) => Buffer.from(c, 'base64'));
}

export async function signHashes(token: string, credentialID: string, hashes: string[]): Promise<Buffer[]> {
  if (sandbox()) {
    const res = sandboxCsc.signHash(token, credentialID, hashes);
    if (typeof res === 'string') throw refused();
    return res.map((s) => Buffer.from(s, 'base64'));
  }
  const { signatures } = await api<{ signatures: string[] }>('/signatures/signHash', token, {
    credentialID,
    hashes,
    hashAlgorithmOID: SHA256_OID,
    signAlgo: SHA256_WITH_RSA_OID,
  });
  if (signatures?.length !== hashes.length) throw new HttpError(502, 'The trust service returned the wrong number of signatures.', 'qes_error');
  return signatures.map((s) => Buffer.from(s, 'base64'));
}
