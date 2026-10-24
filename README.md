# DocSign

A global e-signature platform: **Phase 1 (Core)** of the *E-Sign Platform Architecture Blueprint*.

Upload a document, place fields, send it to signers, and get back a sealed, verifiable PDF with a hash-chained audit trail and a certificate of completion.

## What works today

| Area | Implemented |
|---|---|
| Documents | PDF upload, Office/ODT/RTF/TXT → PDF conversion (Gotenberg), SHA-256 fingerprint, multi-document envelopes |
| Workflow | Sequential or parallel routing, signers + CC, automatic reminders, expiry, void, decline, duplicate |
| Field editor | Signature, initials, date signed, name, email, text, checkbox; click to place, drag to move/resize |
| Signer experience | Email link → email OTP → e-sign consent → guided signing (draw / type / upload signature) |
| Compliance engine | Jurisdiction packs for US, UK, EU and India; resolves signature level, identity strength, retention, data region and consent text; blocks documents that cannot legally be e-signed (wills, certain property deeds, etc.) |
| Trust | PAdES (ETSI.CAdES.detached) platform seal over the whole completed PDF with RFC 3161 timestamp (PAdES-B-T); key behind a `KeyProvider` interface (HSM-ready) |
| Evidence | Append-only SHA-256 hash-chained audit log, certificate of completion (also sealed), write-once storage via S3 Object Lock |
| Verification portal | Public `/verify`: fingerprint lookup, CMS signature check, timestamp check, tamper detection, audit chain status |
| API & webhooks | REST API (`/api/v1`) used by the web app itself, API keys, HMAC-signed webhooks with retries (transactional outbox) |

## Running locally

Requirements: Node 20+ and Docker Desktop.

```bash
npm install                        # also generates the Prisma client and copies the pdf.js worker
cp apps/api/.env.example apps/api/.env   # then set APP_SECRET to a random string
npm run infra:up                   # Postgres, RustFS (S3), Mailpit, Gotenberg
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

Field coordinates are fractions (0–1) of the page, measured from the top-left corner.

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
apps/web      Next.js — sender app, signer app, verification portal
docs/         Architecture notes and roadmap mapping
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for how this maps to the blueprint and what comes next.

## Development notes

- The dev platform seal key and a private dev root CA are generated on first start into `apps/api/.keys/` (git-ignored). Adobe Reader will show the seal as "validity unknown" until that root is trusted; production uses an HSM-held key with a publicly trusted certificate.
- Set `TSA_URL=` (empty) to work offline; seals then fall back to PAdES-B-B and the audit trail records why.
- Signer-supplied signature images are fully decoded and re-encoded before storage (`src/lib/image.ts`). A malformed PNG otherwise hangs pdf-lib's decoder and blocks the API's event loop.
