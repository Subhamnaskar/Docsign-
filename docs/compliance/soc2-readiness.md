# SOC 2 / ISO 27001 readiness

Certification is an audit of how the **company** operates (policies, people,
vendors, monitoring over a period of time), not only of the code. This page
maps what the product already provides as evidence, and lists what the
organisation still has to put in place before engaging an auditor.

Nothing here means a certification is held.

## What the product provides

| Control area (SOC 2 TSC / ISO 27001 Annex A) | Evidence in the product |
|---|---|
| Logical access (CC6.1, A.5.15–5.18) | Roles (owner/admin/member), least-privilege envelope visibility, SSO via OIDC, SCIM de-provisioning, session revocation on deactivation, API keys hashed and revocable |
| Authentication (CC6.1, A.8.5) | bcrypt passwords, SSO enforcement per domain, signer one-time codes with expiry and lockout, signed-cookie SSO flow with PKCE/state/nonce |
| Audit logging (CC7.2, A.8.15) | Hash-chained per-agreement audit trail (tamper-evident); organisation activity log of admin actions (users, keys, webhooks, SSO, branding) |
| Data integrity (PI1, A.8.24) | PAdES seals with trusted timestamps, incremental signing that preserves earlier signatures, public verification portal |
| Encryption (CC6.7, A.8.24) | TLS in transit (deployment), secrets encrypted at rest (AES-256-GCM), write-once object storage with retention locks |
| Malware protection (CC6.8, A.8.7) | ClamAV scanning of every upload and signer attachment; uploads refused when the scanner is down |
| Input validation / secure development (CC8.1, A.8.25–8.28) | Schema validation on every endpoint, SSRF-safe URL imports, PNG re-encoding, clickjacking protection, automated test suite (80+ tests) in CI |
| Change management (CC8.1, A.8.32) | Git history, CI on every push and pull request, migrations versioned in the repository |
| Data residency (C1, A.5.34) | Regional cell model; jurisdiction-aware residency warnings |
| Vendor data flows (CC9.2, A.5.19–5.22) | AI features are off per organisation until an admin opts in; payment and messaging providers are explicit adapters |

## What the organisation must add

- **Policies:** information security, access control, acceptable use, incident
  response, business continuity / disaster recovery, data retention and
  deletion, vendor management, change management, risk assessment.
- **People:** background checks, security training records, onboarding and
  offboarding checklists, quarterly access reviews (the activity log helps).
- **Operations:** production infrastructure as code, centralised logging and
  alerting, backups with tested restores, vulnerability scanning, annual
  penetration test, on-call and incident records.
- **Vendors:** due diligence and DPAs for hosting, email, SMS, payments,
  timestamp authority, eSign providers and Anthropic (if AI is enabled).
- **Production keys:** move the seal key into an HSM or cloud KMS
  (`KeyProvider` in `apps/api/src/trust/keys.ts`) and use a publicly trusted
  certificate.

## Suggested path

1. Pick a compliance-automation platform (e.g. Vanta, Drata, Secureframe) to
   collect evidence continuously.
2. Write and approve the policies above; start access reviews and training.
3. Run a SOC 2 **Type I** (design of controls at a point in time).
4. Operate the controls for 3–12 months, then a **Type II** audit.
5. ISO 27001 can reuse most of the same evidence.
