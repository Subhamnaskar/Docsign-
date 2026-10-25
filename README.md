# DocSign

A global e-signature platform: **Phase 1 (Core)** of the *E-Sign Platform Architecture Blueprint*.

Upload a document, place fields, send it to signers, and get back a sealed, verifiable PDF with a hash-chained audit trail and a certificate of completion.

## What works today

| Area | Implemented |
|---|---|
| Documents | PDF upload, Office/ODT/RTF/TXT → PDF conversion (Gotenberg), import from Google Drive, Dropbox and OneDrive pickers or any public share link (SSRF-safe), ClamAV malware scanning, SHA-256 fingerprint, multi-document envelopes |
| Templates & forms | Templates with named roles, create-from-template, bulk send from CSV (100 rows per batch), public web forms (`/f/<slug>`) that create and route an agreement when someone fills them in |
| Languages | Per-recipient language for emails and the signing page: English, Hindi, Spanish, French, German, Portuguese, Italian, Dutch, Arabic (RTL), Japanese |
| Workflow | Sequential or parallel routing, signers + CC, reminders, expiry, void, decline, duplicate, correct a recipient after sending (old link stops working), signer-initiated reassign, folders, bulk ZIP download, CSV export |
| Field editor | Signature, initials, date signed, name, email, text, number, checkbox, dropdown, radio, formula (calculated), attachment upload, payment; required/optional, conditional show/hide, AI field detection |
| Signer experience | Email link → identity check (email, SMS or WhatsApp code, or an access code) → e-sign consent → guided signing (draw / type / upload), mobile-friendly, in-person (host) signing, embedded signing in your own site |
| India | Aadhaar eSign 2.1 (ESP XML protocol, built-in sandbox ESP), DSC USB-token signing via a local utility, sandbox e-stamp certificates; signatures are applied as incremental PDF updates so each one stays valid |
| Billing | 14-day free trial, Starter / Business / Enterprise plans with agreement and user limits, monthly or yearly subscriptions, pro-rata plan changes, cancel at period end, GST tax invoices (PDF), Settings → Billing; prices in `apps/api/src/billing/plans.ts` (placeholders) feed the website pricing page |
| Payments | Collect a fee as part of signing: built-in sandbox checkout, Stripe Checkout and Razorpay Payment Links adapters |
| Compliance engine | Jurisdiction packs for US, UK, EU and India; resolves signature level, identity strength, retention, data region and consent text; blocks documents that cannot legally be e-signed |
| Trust | PAdES (ETSI.CAdES.detached) seal with RFC 3161 timestamp, plus long-term validation: certificates and OCSP/CRL revocation data in a DSS (B-LT) and a document timestamp (B-LTA), renewed automatically before it ages out; key behind a `KeyProvider` interface (HSM-ready) |
| Evidence | Append-only SHA-256 hash-chained audit log, certificate of completion (also sealed), write-once storage via S3 Object Lock |
| Verification portal | Public `/verify`: fingerprint lookup, CMS signature check, timestamp check, tamper detection, audit chain status |
| Account security | Email verification before sending, password reset and change, TOTP two-factor authentication with recovery codes, organisation-wide 2FA requirement, signed-in device list with remote sign-out, security notification emails |
| Teams & admin | Owner / admin / member roles (members see only their own agreements), invitations, OIDC single sign-on with optional enforcement, SCIM 2.0 user provisioning, branding (logo, colour, email footer), organisation activity log, reports dashboard |
| AI (opt-in) | On the Claude API: document summaries for signers, contract review for senders, field detection, Q&A over an agreement. Off until an admin turns it on for the organisation |
| API & integrations | REST API (`/api/v1`), API keys, HMAC-signed webhooks with retries, REST hooks (Zapier style), Slack and Microsoft Teams channel notifications, MCP server at `/api/v1/mcp` so AI assistants can look up, send (from templates), remind and void agreements |

## Sandbox vs production providers

Everything that depends on an outside contract ships with a working sandbox so the whole flow runs locally. The production adapters follow each provider's published API but have **not been tested against the real services**; test each one with your own credentials before going live.

| Capability | Sandbox (default) | Production adapter | What you need |
|---|---|---|---|
| SMS / WhatsApp codes | Messages land in Mailpit (`sms-<number>@sms.local`) | Twilio, MSG91 | Twilio account or MSG91 key + DLT-approved template |
| Aadhaar eSign | Built-in test ESP: any 12-digit number, OTP `123456`. **Not legally valid** | eSign 2.1 XML to a licensed ESP | ESP contract (eMudhra, NSDL, C-DAC…), ASP ID, ESP certificate |
| DSC tokens | — | Local signing utility protocol (`docs/dsc-utility.md`) | The desktop utility, CCA root certificates in `DSC_TRUST_DIR` |
| e-Stamp | Specimen certificate page. **Not valid** | — (interface only) | SHCIL or state e-stamp vendor agreement |
| Payments | Built-in test checkout at `/api/v1/dev/pay/...` | Stripe Checkout, Razorpay Payment Links | Stripe or Razorpay keys and webhook secret |
| Subscriptions | Built-in test checkout at `/api/v1/dev/billing/...`; renewals run in the worker | Stripe Billing, Razorpay Subscriptions | Same keys plus `STRIPE_BILLING_WEBHOOK_SECRET` or `RAZORPAY_WEBHOOK_SECRET`; seller name, address and GSTIN for invoices |
| Single sign-on | — | Any OIDC provider (Okta, Entra ID, Google) | An app registration at your identity provider |
| Cloud pickers | Hidden until configured; share links always work | Google Picker, Dropbox Chooser, OneDrive picker | App credentials from each provider (see `.env.example`) |
| AI | Off | Claude API | `ANTHROPIC_API_KEY`, and an admin opts the organisation in |

The sandbox ESP and payment pages (`/api/v1/dev/*`) are only served while `ESIGN_MODE=sandbox` and `PAYMENT_PROVIDER=sandbox` respectively.

## Website

Public pages live in the same Next.js app (`apps/web/src/app/(marketing)`): home, product, compliance & security, developers (API reference), pricing, partners, contact (demo requests, stored and emailed to `SALES_EMAIL`), and legal outlines, plus `sitemap.xml` and `robots.txt`.

Brand name, domain, contact emails and plan prices are in `apps/web/src/lib/brand.ts`. Plans show "Contact us" until a price is set. Before launch: pick the final name (the working name "DocSign" is close to an existing trademark), set the domain, and replace the legal outlines with lawyer-approved text.

## Running locally

Requirements: Node 20+ and Docker Desktop.

```bash
npm install                        # also generates the Prisma client and copies the pdf.js worker
cp apps/api/.env.example apps/api/.env   # then set APP_SECRET to a random string
npm run infra:up                   # Postgres, RustFS (S3), Mailpit, Gotenberg, ClamAV
npm run db:migrate                 # create the database schema
npm run dev                        # API on :4000, web app on :3000
```

| URL | What |
|---|---|
| http://localhost:3000 | Web app |
| http://localhost:8025 | Mailpit: every email (signing links, OTP codes, completed documents) lands here |
| http://localhost:9001 | RustFS console (user `docsign`, password `docsign-secret`) |
| http://localhost:4000/health | API health |

**Try it:** register → *New agreement* → upload a PDF → add yourself and a second email as signers → place fields → send. Open Mailpit, click the signing link, enter the code from the next email, sign. When the last signer finishes, the envelope page shows the sealed PDF and certificate; drop either into `/verify`.

On npm 11+, the install scripts for Prisma and esbuild are pre-approved in the root `package.json` (`allowScripts`).

ClamAV takes 1–2 minutes to load its virus database after `infra:up`; uploads return "scanner unavailable" until then. To develop without it, set `CLAMAV_HOST=` (empty) in `apps/api/.env`.

## Tests

```bash
npm test                                   # API suite against a separate docsign_test database
CLAMAV_HOST=localhost npm test             # also runs the malware-scanning tests
```

The suite covers the policy engine, crypto, PAdES sealing, incremental signing and tamper detection, audit-chain tampering, the full signing flow, tenant isolation and roles, forged links, OTP lockout, API keys, templates, bulk send, fields and formulas, SMS/access-code identity, Aadhaar eSign against the sandbox ESP, SSO and SCIM, AI endpoints (with a stubbed model), payments and webhook signature checks. CI (`.github/workflows/ci.yml`) runs typechecks, the API tests and the web build on every push and pull request.

## Billing

- New organisations start on a 14-day trial (25 agreements, 5 users, every feature). When it ends, sending stops until an admin picks a plan; existing agreements stay available.
- Limits are enforced by the API: agreements per billing period at send time, users at invite / SSO / SCIM time, and features (API keys, webhooks, bulk send, SSO) per plan. API keys stop working on plans without the API.
- Enterprise is not sold online. Sales sets it up with `npm run billing:set-plan -w @docsign/api -- <org id or email> enterprise --seats 50 --months 12` (also extends trials: `... trial --months 1`).
- Indian (INR) invoices add GST at `BILLING_GST_RATE` (default 18%); set it to 0 if the business is not GST-registered, and have an accountant confirm the invoice format (place of supply, CGST/SGST vs IGST) before launch.

## Running more than one API instance

Background jobs (webhook delivery, reminders, expiry, sealing retries) run inside the API by default (`WORKER_MODE=inline`). For multiple API replicas set `WORKER_MODE=off` and run exactly one worker process: `npm run worker`.

## API quick start

Create a key under **Settings → API keys**, then:

```bash
KEY=dsk_...
curl -s -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '{"title":"Offer letter","documentType":"employment_offer"}' localhost:4000/api/v1/envelopes
curl -s -H "Authorization: Bearer $KEY" -F file=@offer.pdf localhost:4000/api/v1/envelopes/<id>/documents
curl -s -X PUT -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '[{"name":"Sam","email":"sam@example.com","role":"SIGNER","routingOrder":1}]' localhost:4000/api/v1/envelopes/<id>/recipients
curl -s -X PUT -H "Authorization: Bearer $KEY" -H 'content-type: application/json' \
  -d '[{"documentId":"<doc>","recipientId":"<rcpt>","type":"SIGNATURE","page":0,"x":0.1,"y":0.8,"width":0.3,"height":0.06}]' \
  localhost:4000/api/v1/envelopes/<id>/fields
curl -s -X POST -H "Authorization: Bearer $KEY" localhost:4000/api/v1/envelopes/<id>/send
```

Field coordinates are fractions (0–1) of the page, measured from the top-left corner. Recipients accept an optional `"locale"` (`en`, `hi`, `es`, `fr`, `de`, `pt`, `it`, `nl`, `ar`, `ja`).

From a template (`roleId`s come from `GET /api/v1/templates/<id>`):

```bash
curl -s -H "Authorization: Bearer $KEY" -H 'content-type: application/json'   -d '{"send":true,"recipients":[{"roleId":"<role>","name":"Sam","email":"sam@example.com","locale":"es"}]}'   localhost:4000/api/v1/templates/<id>/envelopes
```

Embedded signing: `POST /api/v1/envelopes/<id>/recipients/<rid>/embedded-session` returns a one-time URL to put in an `<iframe>`. Add your site's origin to the allowed embedding origins under **Settings → Organization** first.

MCP: point an MCP client at `<APP_URL>/api/v1/mcp` with `Authorization: Bearer <API key>`.

Webhook payloads carry `X-DocSign-Signature: t=<unix>,v1=<hex>`, where `v1 = HMAC_SHA256(secret, "<t>.<raw body>")`.

## Repository layout

```
apps/api      Fastify + Prisma (PostgreSQL) — domain services, policy engine, trust layer, worker
  src/policy      Jurisdiction packs and the policy resolver
  src/adapters    Adapter registry (signature providers, identity providers)
  src/trust       Key provider, CAdES signer + RFC 3161 client, PAdES sealing, signature verification
  src/audit       Hash-chained audit log
  src/documents   Ingestion/conversion, field rendering, certificate of completion
  src/envelopes   Envelope API and workflow (send, routing, finalisation)
  src/signing     Public signer API (OTP, consent, complete, decline)
  src/verify      Public verification portal API
  src/webhooks    Outbox + delivery with retries
  src/templates   Templates, create-from-template, bulk send
  src/i18n        Signer email translations
  src/esign       Aadhaar eSign (ASP request/ESP response XML, sandbox ESP) and DSC signing
  src/estamp      e-Stamp provider interface (sandbox)
  src/messaging   SMS / WhatsApp providers
  src/payments    Payment providers (sandbox, Stripe, Razorpay)
  src/billing     Plans and limits, subscriptions, invoices
  src/sso         OIDC single sign-on and SCIM 2.0
  src/ai          Claude API features; src/mcp is the MCP server
  src/team        Members, roles, invitations; src/organization holds settings and branding
  src/integrations  Share-link import, REST hooks
  src/reports     Reports dashboard data
  test/           Vitest unit + integration tests
apps/web      Next.js — sender app, signer app, verification portal
docs/         Architecture notes and roadmap mapping
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how this maps to the blueprint and what comes next.

## Development notes

- The dev platform seal key and a private dev root CA are generated on first start into `apps/api/.keys/` (git-ignored). Adobe Reader will show the seal as "validity unknown" until that root is trusted; production uses an HSM-held key with a publicly trusted certificate.
- Set `TSA_URL=` (empty) to work offline; seals then fall back to PAdES-B-B (with the validation data still embedded) and the audit trail records why. With a TSA, documents reach PAdES-B-LTA; the worker renews archive timestamps after `LTA_RENEW_AFTER_DAYS` (default 5 years) and keeps earlier copies verifiable.
- The dev CA publishes an empty revocation list at `/api/v1/trust/dev-ca.crl`. Dev key folders created before this existed are regenerated once on start, because the CA key is now kept.
- Translations (emails and signing page) are first drafts. Have native speakers review them, and have legal review the consent wording, before production. The consent disclosure itself stays in the governing jurisdiction's wording.
- Signer-supplied signature images are fully decoded and re-encoded before storage (`src/lib/image.ts`). A malformed PNG otherwise hangs pdf-lib's decoder and blocks the API's event loop.
