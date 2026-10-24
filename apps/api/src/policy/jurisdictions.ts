/**
 * Jurisdiction packs. Each pack describes the legal defaults for one market.
 * Adding a market = adding a pack (and, where needed, identity/trust adapters).
 */

export type SignatureLevel = 'SES' | 'AES' | 'QES';
export type IdentityAssurance = 'LOW' | 'SUBSTANTIAL' | 'HIGH';

export interface DocumentRule {
  /** Minimum signature level the law or market practice requires. */
  level?: SignatureLevel;
  identity?: IdentityAssurance;
  retentionYears?: number;
  /** Electronic signing not legally effective for this document type. */
  blocked?: string;
  /** Stamp duty must be paid (India: attach an e-stamp) */
  stampDuty?: boolean;
  warning?: string;
}

export interface JurisdictionPack {
  code: string;
  name: string;
  /** Regional cell where data for this jurisdiction must reside. */
  dataRegion: string;
  laws: string[];
  defaultLevel: SignatureLevel;
  defaultIdentity: IdentityAssurance;
  retentionYears: number;
  consentText: string;
  documentRules: Record<string, DocumentRule>;
}

export const DOCUMENT_TYPES: Record<string, string> = {
  general: 'General agreement',
  nda: 'Non-disclosure agreement',
  employment_offer: 'Employment offer / HR document',
  sales_agreement: 'Sales agreement',
  vendor_contract: 'Vendor / procurement contract',
  lease: 'Residential or commercial lease',
  loan_agreement: 'Loan agreement',
  consent_form: 'Consent form',
  power_of_attorney: 'Power of attorney',
  will: 'Will or testamentary document',
  property_sale_deed: 'Sale or conveyance of immovable property',
  negotiable_instrument: 'Negotiable instrument (promissory note, bill of exchange)',
  court_filing: 'Court order or court filing',
};

export const JURISDICTIONS: Record<string, JurisdictionPack> = {
  US: {
    code: 'US',
    name: 'United States',
    dataRegion: 'us',
    laws: ['ESIGN Act (15 U.S.C. 7001)', 'UETA'],
    defaultLevel: 'SES',
    defaultIdentity: 'LOW',
    retentionYears: 7,
    consentText:
      'I agree to use electronic records and signatures for this transaction. I understand that my electronic signature is the legal equivalent of my handwritten signature under the U.S. ESIGN Act and UETA. I may request a paper copy and may withdraw this consent by contacting the sender before signing.',
    documentRules: {
      will: { blocked: 'Wills, codicils and testamentary trusts are excluded from ESIGN/UETA in most states.' },
      court_filing: { blocked: 'Court orders and official court documents are excluded from ESIGN.' },
      property_sale_deed: {
        warning: 'Deeds usually require notarization and county recording. Remote online notarization is planned for Phase 4.',
      },
      loan_agreement: { retentionYears: 10 },
    },
  },
  UK: {
    code: 'UK',
    name: 'United Kingdom',
    dataRegion: 'uk',
    laws: ['Electronic Communications Act 2000', 'UK eIDAS', 'UK GDPR'],
    defaultLevel: 'SES',
    defaultIdentity: 'LOW',
    retentionYears: 6,
    consentText:
      'I agree to sign this document electronically. I understand that my electronic signature is admissible and binding under the Electronic Communications Act 2000 and UK eIDAS.',
    documentRules: {
      will: { blocked: 'Wills in England and Wales must be signed in the physical presence of witnesses (Wills Act 1837).' },
      property_sale_deed: {
        warning: 'Transfers of registered land require HM Land Registry-approved signing workflows.',
      },
      power_of_attorney: {
        warning: 'Lasting powers of attorney must be registered with the Office of the Public Guardian.',
      },
    },
  },
  EU: {
    code: 'EU',
    name: 'European Union',
    dataRegion: 'eu',
    laws: ['eIDAS Regulation (EU) 910/2014', 'eIDAS 2.0 (EU) 2024/1183', 'GDPR'],
    defaultLevel: 'SES',
    defaultIdentity: 'LOW',
    retentionYears: 10,
    consentText:
      'I agree to sign this document electronically. I understand that under the eIDAS Regulation an electronic signature cannot be denied legal effect solely because it is in electronic form.',
    documentRules: {
      employment_offer: {
        warning: 'Some member states (e.g. Germany for fixed-term contracts) require a qualified electronic signature (QES).',
      },
      loan_agreement: { level: 'AES', identity: 'SUBSTANTIAL' },
      will: { blocked: 'Most member states require handwritten or notarial wills.' },
      property_sale_deed: { blocked: 'Transfers of immovable property generally require a notarial deed.' },
    },
  },
  IN: {
    code: 'IN',
    name: 'India',
    dataRegion: 'in',
    laws: ['Information Technology Act 2000', 'Indian Evidence Act / BSA 2023 s.61-63', 'DPDP Act 2023'],
    defaultLevel: 'SES',
    defaultIdentity: 'LOW',
    retentionYears: 8,
    consentText:
      'I consent to sign this document electronically and agree that my electronic signature and electronic records are valid and enforceable under the Information Technology Act, 2000.',
    documentRules: {
      // First Schedule of the IT Act: documents the Act does not apply to
      negotiable_instrument: { blocked: 'Excluded by the First Schedule of the IT Act 2000 (other than cheques).' },
      power_of_attorney: { blocked: 'Excluded by the First Schedule of the IT Act 2000.' },
      will: { blocked: 'Excluded by the First Schedule of the IT Act 2000.' },
      property_sale_deed: { blocked: 'Contracts for sale or conveyance of immovable property are excluded by the IT Act 2000.' },
      loan_agreement: {
        level: 'AES',
        identity: 'HIGH',
        retentionYears: 8,
        stampDuty: true,
        warning: 'RBI digital lending rules require Aadhaar eSign, PAN eSign or DSC (not OTP-only signing) and stamp duty for the relevant state.',
      },
      lease: { stampDuty: true },
    },
  },
};
