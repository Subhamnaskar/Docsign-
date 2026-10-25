# Architecture: blueprint to code

This repository implements **Phase 1 (Core, months 0–6)** of the blueprint and lays down the seams the later phases plug into. This document maps blueprint concepts to code and lists what each later phase adds.

## Design principles: how each is honoured

| Blueprint principle | In this codebase |
|---|---|
| Core plus jurisdiction plug-ins | One envelope/signing engine. Markets are data in `apps/api/src/policy/jurisdictions.ts`; licensed capabilities register in `apps/api/src/adapters/registry.ts`. |
| Policy-driven compliance | `resolvePolicy()` (`src/policy/engine.ts`) runs on every draft read and at send time; the resolved profile is snapshotted onto the envelope and drives consent text, retention, seal format and certificate content. Sending is refused when a blocker exists. |
| Cell-based sovereign deployment | `CELL_REGION` identifies the cell; organisations record their `dataRegion`; the policy engine warns when a jurisdiction's data belongs in a different cell. `docker-compose.yml` is one cell. |
| Event-sourced agreements | Every state change appends to the hash-chained `AuditEvent` log in the same transaction; webhooks are written to an outbox in that transaction too. Today state is also kept in tables (event log + state, not pure event sourcing). |
| API-first | The web app only calls `/api/v1` (proxied by Next.js); the same endpoints accept API keys. |
| Partner where a licence is required | `KeyProvider` (HSM/KMS seam), signature-provider and identity-provider registries. Phase 2 adapters register without changing the engine. |

## Signing pipeline (blueprint §8.1)

1. **Fingerprint**: uploads are hashed (SHA-256) at ingestion; the hash goes in the audit log.
2. **Policy**: `resolvePolicy()` picks the level and provider: SES with the `platform-seal`, or AES through `aadhaar-esign` / `dsc` where the jurisdiction pack requires it (India loan agreements, for example).
3. **Sign**: `CadesSigner` builds CAdES signed attributes (content-type, message-digest, signing-certificate-v2). Only the encoded attributes go to the `KeyProvider`, never the document.
4. **Timestamp**: an RFC 3161 token over the signature value is embedded as an unsigned attribute (PAdES-B-T).
5. **Store**: the sealed PDF is written to S3 with Object Lock retention for the policy's retention period.
6. **Evidence**: the hash-chained audit log, plus a certificate of completion that is itself sealed.

### AES (incremental) envelopes

When any signer signs with Aadhaar eSign or a DSC, the envelope switches to incremental mode (`src/trust/incremental.ts`):

- At send, the PDF is normalised once (and the e-stamp page prepended when the policy needs stamp duty). That file is the base every signature builds on.
- Each signer's field values are appended as locked stamp annotations in a new incremental update, which PDF readers accept as a permitted change after earlier signatures.
- An AES signer's signature goes into its own signature field: the server computes the ByteRange digest, the ESP (or the DSC token) returns a CMS signature, and it is embedded without rewriting earlier bytes.
- The final platform seal is one more incremental signature, so every earlier signature still validates.

## Phase roadmap from here

| Phase | Status in this repository | Still to do |
|---|---|---|
| 2. Trust | Aadhaar eSign 2.1 (sandbox ESP + production adapter), DSC tokens, SMS/WhatsApp/access-code identity, incremental signing, PAdES B-LT/B-LTA with archive-timestamp renewal | QES via QTSP partners (CSC API), ID document verification, native mobile apps, Salesforce/M365/Google integrations |
| 3. Enterprise | Roles, OIDC SSO, SCIM, branding, activity log, reports, AI (Claude API), web forms, conditional and calculated fields, REST hooks, MCP server, contract repository with renewal reminders, Word template generation, comments and revisions, internal approval | Visual workflow builder, BYOK, dedicated cells, SOC 2 audit (see [compliance/soc2-readiness.md](compliance/soc2-readiness.md)) |
| 4. Regulated | e-stamp interface with a sandbox provider, payments at signing | RON, real e-stamp vendor, FedRAMP cell, on-prem, ICP-Brasil, national eIDs |
| 5. Full suite | — | Negotiation/redlining, marketplace, EUDI Wallet (see below), China stack |

## EU Digital Identity Wallet

The EUDI Wallet cannot be integrated yet. Member states must offer wallets from late 2026, but production wallets, the relying-party registration process and the remote QES flow through the wallet are still being rolled out country by country. When they are available, the wallet plugs in as:

- an **identity provider** (OpenID4VP presentation of PID attributes) registered with `registerIdentityProvider`, giving HIGH identity assurance for EU signers;
- a **signature provider** for QES, either through the wallet's own signing or a QTSP over the CSC API, registered with `registerSignatureProvider` and selected by the EU jurisdiction pack.

Neither needs changes to the envelope engine.

## Still open

- **Seal key and certificate**: an AWS KMS `KeyProvider` exists (`SEAL_KEY_PROVIDER=aws-kms`) but is untested without an account; production still needs a publicly trusted (AATL/EUTL) seal certificate.
- **Real-provider testing**: ESP, Twilio/MSG91, Stripe/Razorpay and OIDC adapters are written to the providers' published APIs but only tested against sandboxes and stubs.
- **e-Stamp vendor**: only the interface and a specimen provider exist.
- **Sender UI language**: the sender app is English; signers get their language. Translations need native-speaker review.
- **Bulk send scale**: batches run synchronously, capped at 100 rows. Move to a queued job for larger batches.
- **Legal pages**: the website's legal pages are outlines.
- **Billing**: prices in `src/billing/plans.ts` are placeholders; GST handling on invoices needs an accountant's review (CGST/SGST split by place of supply is not done); Stripe/Razorpay subscription adapters are untested against the real services.
