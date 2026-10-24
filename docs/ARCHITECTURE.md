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
2. **Policy**: `resolvePolicy()` picks the level (SES today) and provider (`platform-seal`).
3. **Sign**: `CadesSigner` builds CAdES signed attributes (content-type, message-digest, signing-certificate-v2). Only the encoded attributes go to the `KeyProvider`, never the document.
4. **Timestamp**: an RFC 3161 token over the signature value is embedded as an unsigned attribute (PAdES-B-T).
5. **Store**: the sealed PDF is written to S3 with Object Lock retention for the policy's retention period.
6. **Evidence**: the hash-chained audit log, plus a certificate of completion that is itself sealed.

## Phase roadmap from here

| Phase | Adds | Seams already in place |
|---|---|---|
| 2. Trust | AES/QES via QTSP partners (CSC API), Aadhaar eSign ESP adapter, ID verification, mobile apps, Salesforce/M365/Google | `registerSignatureProvider` / `registerIdentityProvider`; policy rules already require AES for EU/IN loan agreements and block until an adapter exists |
| 3. Enterprise | Workflow builder (Temporal), CLM repository, AI extraction, BYOK, dedicated cells, SOC 2 | `KeyProvider` interface for BYOK/HSM; outbox → Kafka |
| 4. Regulated | RON, e-stamping, FedRAMP cell, on-prem, ICP-Brasil, national eIDs | Jurisdiction packs + adapters; cell config |
| 5. Full suite | Negotiation/redlining, marketplace, advanced AI, EUDI Wallet, China stack | — |

## Phase 1 status

Done since the first cut: automated tests + CI, standalone worker (`WORKER_MODE=off` + `npm run worker`), ClamAV upload scanning, templates and bulk send, 10 signer languages.

Still open:

- **HSM/KMS key provider**: `LocalKeyProvider` keeps a dev key on disk. Production needs a cloud KMS or HSM implementation of `KeyProvider` and a publicly trusted (AATL/EUTL) seal certificate. Needs a cloud account and a CA to complete.
- **LTV**: seals are B-T. B-LT/B-LTA (embedded revocation data, re-timestamping) come with the Phase 2 trust work.
- **SSO/SCIM**: email + password sessions only. Needs an identity provider (Google/Microsoft/Okta) to configure and test against.
- **Sender UI language**: the sender app is English; signers get their language.
- **Bulk send scale**: batches run synchronously, capped at 100 rows. Move to a queued job for larger batches.
