import { findIdentityProvider, findSignatureProvider } from '../adapters/registry.js';
import { config } from '../config.js';
import {
  DOCUMENT_TYPES,
  JURISDICTIONS,
  type IdentityAssurance,
  type SignatureLevel,
} from './jurisdictions.js';

export interface ResolvedPolicy {
  jurisdiction: string;
  jurisdictionName: string;
  documentType: string;
  laws: string[];
  signatureLevel: SignatureLevel;
  identityAssurance: IdentityAssurance;
  signatureProvider: string | null;
  identityProvider: string | null;
  signatureFormat: string;
  retentionYears: number;
  dataRegion: string;
  /** False when this cell is not the legal home for the jurisdiction's data. */
  residencySatisfied: boolean;
  consentText: string;
  allowed: boolean;
  blockers: string[];
  warnings: string[];
}

/**
 * Policy & Compliance Engine: decides signature level, identity strength,
 * format, retention and data region for a document before it is sent.
 */
export function resolvePolicy(jurisdiction: string, documentType: string): ResolvedPolicy {
  const pack = JURISDICTIONS[jurisdiction];
  if (!pack) throw new Error(`Unknown jurisdiction ${jurisdiction}`);
  const rule = pack.documentRules[documentType] ?? {};
  const level = rule.level ?? pack.defaultLevel;
  const identity = rule.identity ?? pack.defaultIdentity;

  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!DOCUMENT_TYPES[documentType]) blockers.push(`Unknown document type "${documentType}".`);
  if (rule.blocked) blockers.push(rule.blocked);
  if (rule.warning) warnings.push(rule.warning);

  const sigProvider = findSignatureProvider(level, jurisdiction);
  if (!sigProvider) {
    blockers.push(
      `${level} signatures in ${pack.name} need a trust-service adapter that is not enabled yet (Phase 2: qualified/advanced signatures via partners).`,
    );
  }
  const idProvider = findIdentityProvider(identity, jurisdiction);
  if (!idProvider) {
    blockers.push(
      `Identity assurance "${identity}" in ${pack.name} needs an identity adapter that is not enabled yet (Phase 2: ID verification, national eIDs).`,
    );
  }

  // 'local' is the development cell and may hold any jurisdiction's data.
  const residencySatisfied = config.cellRegion === 'local' || config.cellRegion === pack.dataRegion;
  if (!residencySatisfied) {
    warnings.push(
      `${pack.name} data should reside in the "${pack.dataRegion}" cell; this cell is "${config.cellRegion}".`,
    );
  }

  return {
    jurisdiction: pack.code,
    jurisdictionName: pack.name,
    documentType,
    laws: pack.laws,
    signatureLevel: level,
    identityAssurance: identity,
    signatureProvider: sigProvider?.id ?? null,
    identityProvider: idProvider?.id ?? null,
    signatureFormat: config.tsaUrl ? 'PAdES-B-T' : 'PAdES-B-B',
    retentionYears: rule.retentionYears ?? pack.retentionYears,
    dataRegion: pack.dataRegion,
    residencySatisfied,
    consentText: pack.consentText,
    allowed: blockers.length === 0,
    blockers,
    warnings,
  };
}

export function listJurisdictions() {
  return Object.values(JURISDICTIONS).map((j) => ({ code: j.code, name: j.name, laws: j.laws, dataRegion: j.dataRegion }));
}

export function listDocumentTypes() {
  return Object.entries(DOCUMENT_TYPES).map(([code, name]) => ({ code, name }));
}
