import type { IdentityAssurance, SignatureLevel } from '../policy/jurisdictions.js';

/**
 * Adapter layer. Licensed functions (certificates, identity checks, notaries,
 * e-stamping, payments) plug in here. Phase 1 ships the platform-owned adapters;
 * partner adapters (QTSPs, Aadhaar eSign ESPs, BankID, ...) register the same way.
 */

export interface SignatureProviderInfo {
  id: string;
  name: string;
  levels: SignatureLevel[];
  /** Jurisdiction codes, or '*' for all. */
  jurisdictions: string[] | '*';
}

export interface IdentityProviderInfo {
  id: string;
  name: string;
  assurance: IdentityAssurance;
  jurisdictions: string[] | '*';
}

const signatureProviders: SignatureProviderInfo[] = [
  {
    id: 'platform-seal',
    name: 'Platform electronic seal (PAdES, HSM-protected key)',
    levels: ['SES'],
    jurisdictions: '*',
  },
];

const identityProviders: IdentityProviderInfo[] = [
  { id: 'email-otp', name: 'Email one-time passcode', assurance: 'LOW', jurisdictions: '*' },
  { id: 'sms-otp', name: 'SMS one-time passcode', assurance: 'LOW', jurisdictions: '*' },
  { id: 'whatsapp-otp', name: 'WhatsApp one-time passcode', assurance: 'LOW', jurisdictions: '*' },
  { id: 'access-code', name: 'Access code shared by the sender', assurance: 'LOW', jurisdictions: '*' },
];

export function registerSignatureProvider(p: SignatureProviderInfo) {
  signatureProviders.push(p);
}

export function registerIdentityProvider(p: IdentityProviderInfo) {
  identityProviders.push(p);
}

const LEVEL_RANK: Record<SignatureLevel, number> = { SES: 0, AES: 1, QES: 2 };
const ASSURANCE_RANK: Record<IdentityAssurance, number> = { LOW: 0, SUBSTANTIAL: 1, HIGH: 2 };

const covers = (list: string[] | '*', code: string) => list === '*' || list.includes(code);

export function findSignatureProvider(level: SignatureLevel, jurisdiction: string) {
  return signatureProviders.find(
    (p) => covers(p.jurisdictions, jurisdiction) && p.levels.some((l) => LEVEL_RANK[l] >= LEVEL_RANK[level]),
  );
}

export function findIdentityProvider(assurance: IdentityAssurance, jurisdiction: string) {
  return identityProviders.find(
    (p) => covers(p.jurisdictions, jurisdiction) && ASSURANCE_RANK[p.assurance] >= ASSURANCE_RANK[assurance],
  );
}

export function listAdapters() {
  return { signatureProviders, identityProviders };
}
