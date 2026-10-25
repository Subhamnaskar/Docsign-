import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { CtaBand, PageHero, Section, SectionHeading } from '@/components/marketing/Site';
import { brand } from '@/lib/brand';

export const metadata: Metadata = {
  title: 'Developers',
  description: 'REST API, API keys and signed webhooks for sending, tracking and verifying agreements.',
};

const BASE = `https://${brand.domain}/api/v1`;

function Code({ children }: { children: string }) {
  return (
    <pre className="mt-4 overflow-x-auto rounded-xl bg-gray-950 p-5 text-xs leading-relaxed text-gray-200 sm:text-sm">
      <code>{children}</code>
    </pre>
  );
}

function Endpoint({ method, path, children }: { method: string; path: string; children: ReactNode }) {
  const color = { GET: 'bg-green-50 text-green-700', POST: 'bg-blue-50 text-blue-700', PUT: 'bg-amber-50 text-amber-700', PATCH: 'bg-amber-50 text-amber-700', DELETE: 'bg-red-50 text-red-700' }[method];
  return (
    <div className="grid gap-1 px-5 py-3.5 sm:grid-cols-[minmax(0,340px)_1fr] sm:gap-6">
      <div className="flex items-center gap-2 font-mono text-xs">
        <span className={`w-14 shrink-0 rounded px-1.5 py-0.5 text-center font-semibold ${color}`}>{method}</span>
        <span className="break-all text-gray-900">{path}</span>
      </div>
      <div className="text-sm text-gray-600">{children}</div>
    </div>
  );
}

const EVENTS = [
  ['envelope.sent', 'The envelope was sent to its first signers.'],
  ['recipient.viewed', 'A signer opened their signing link.'],
  ['recipient.signed', 'A signer finished signing.'],
  ['recipient.declined', 'A signer declined; the envelope is closed.'],
  ['envelope.completed', 'Everyone signed and the sealed documents are ready.'],
  ['envelope.voided', 'The sender voided the envelope.'],
  ['envelope.expired', 'The envelope passed its expiry date.'],
];

export default function DevelopersPage() {
  return (
    <>
      <PageHero
        eyebrow="Developers"
        title="An API for every step of the agreement"
        intro="Our own web app is built on the same REST API you use. Create envelopes, send from templates, track progress with webhooks and download sealed PDFs."
      >
        <div className="flex flex-wrap gap-3">
          <Link href="/register" className="rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700">
            Get an API key
          </Link>
          <a href="#quickstart" className="rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-800 hover:bg-gray-50">
            Quickstart
          </a>
        </div>
      </PageHero>

      <Section id="quickstart">
        <SectionHeading eyebrow="Quickstart" title="Send your first envelope" intro="Create an API key under Settings → API keys, then:" />
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="font-semibold text-gray-900">1. Create a draft and upload a document</h3>
            <Code>{`curl ${BASE}/envelopes \\
  -H "Authorization: Bearer $API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"title": "Offer letter", "jurisdiction": "IN",
       "documentType": "employment_offer"}'

curl ${BASE}/envelopes/$ENVELOPE/documents \\
  -H "Authorization: Bearer $API_KEY" \\
  -F file=@offer.pdf`}</Code>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">2. Add a signer and a signature field, then send</h3>
            <Code>{`curl -X PUT ${BASE}/envelopes/$ENVELOPE/recipients \\
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '[{"name": "Priya Sharma", "email": "priya@example.com",
        "role": "SIGNER", "routingOrder": 1, "locale": "hi"}]'

curl -X PUT ${BASE}/envelopes/$ENVELOPE/fields \\
  -H "Authorization: Bearer $API_KEY" -H "Content-Type: application/json" \\
  -d '[{"documentId": "$DOC", "recipientId": "$RECIPIENT",
        "type": "SIGNATURE", "page": 0,
        "x": 0.1, "y": 0.8, "width": 0.3, "height": 0.06}]'

curl -X POST ${BASE}/envelopes/$ENVELOPE/send \\
  -H "Authorization: Bearer $API_KEY"`}</Code>
          </div>
        </div>
        <p className="mt-6 text-sm text-gray-500">
          Field positions are fractions (0–1) of the page, measured from the top-left corner. <code>page</code> is zero-based. Field types:{' '}
          <code>SIGNATURE</code>, <code>INITIALS</code>, <code>DATE_SIGNED</code>, <code>NAME</code>, <code>EMAIL</code>, <code>TEXT</code>,{' '}
          <code>CHECKBOX</code>, <code>NUMBER</code>, <code>DROPDOWN</code>, <code>RADIO</code>, <code>FORMULA</code>, <code>ATTACHMENT</code>,{' '}
          <code>PAYMENT</code> (with <code>amount</code> in minor units and <code>currency</code>).
        </p>
      </Section>

      <Section tone="muted">
        <SectionHeading eyebrow="Reference" title="Endpoints" intro={`All endpoints live under ${BASE} and accept and return JSON unless noted.`} />
        <h3 className="mt-10 text-sm font-semibold uppercase tracking-wide text-gray-500">Envelopes</h3>
        <div className="mt-3 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
          <Endpoint method="GET" path="/envelopes">List envelopes. Query: <code>status</code>, <code>search</code>, <code>limit</code>, <code>cursor</code>.</Endpoint>
          <Endpoint method="POST" path="/envelopes">Create a draft: <code>title</code>, <code>message</code>, <code>jurisdiction</code>, <code>documentType</code>, <code>routing</code>, <code>reminderDays</code>, <code>expiresAt</code>.</Endpoint>
          <Endpoint method="GET" path="/envelopes/:id">Envelope with documents, recipients, fields, compliance policy and readiness problems.</Endpoint>
          <Endpoint method="PATCH" path="/envelopes/:id">Update a draft.</Endpoint>
          <Endpoint method="POST" path="/envelopes/:id/documents">Upload a file (multipart, field <code>file</code>, up to 25 MB). Office formats are converted to PDF.</Endpoint>
          <Endpoint method="PUT" path="/envelopes/:id/recipients">Set recipients. Include <code>id</code> to keep an existing recipient and their fields.</Endpoint>
          <Endpoint method="PUT" path="/envelopes/:id/fields">Replace all fields.</Endpoint>
          <Endpoint method="POST" path="/envelopes/:id/send">Validate against the compliance policy and send. Returns 422 with <code>details.problems</code> if blocked.</Endpoint>
          <Endpoint method="POST" path="/envelopes/:id/remind">Email pending signers again.</Endpoint>
          <Endpoint method="POST" path="/envelopes/:id/void">Cancel an envelope that is out for signature: <code>reason</code>.</Endpoint>
          <Endpoint method="GET" path="/envelopes/:id/documents/:docId/file">Download the sealed PDF (or <code>?version=original</code>).</Endpoint>
          <Endpoint method="GET" path="/envelopes/:id/certificate">Download the sealed certificate of completion.</Endpoint>
          <Endpoint method="GET" path="/envelopes/:id/audit">Audit events plus hash-chain verification.</Endpoint>
        </div>

        <h3 id="templates" className="mt-10 scroll-mt-24 text-sm font-semibold uppercase tracking-wide text-gray-500">Templates</h3>
        <div className="mt-3 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
          <Endpoint method="POST" path="/envelopes/:id/save-as-template">Save an envelope as a template: <code>name</code>, <code>roleNames</code>.</Endpoint>
          <Endpoint method="GET" path="/templates">List templates with their roles.</Endpoint>
          <Endpoint method="POST" path="/templates/:id/envelopes">Create an envelope from a template: <code>recipients</code> (one per role), <code>send</code>.</Endpoint>
          <Endpoint method="POST" path="/templates/:id/bulk-send">Up to 100 <code>rows</code>, each creating and sending one envelope. Returns per-row results.</Endpoint>
        </div>

        <h3 id="embedded" className="mt-10 scroll-mt-24 text-sm font-semibold uppercase tracking-wide text-gray-500">Embedded signing & integrations</h3>
        <div className="mt-3 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
          <Endpoint method="POST" path="/envelopes/:id/recipients/:rid/embedded-session">One-time URL to load in an <code>&lt;iframe&gt;</code> on a site your organisation allows.</Endpoint>
          <Endpoint method="POST" path="/envelopes/:id/recipients/:rid/correct">Change a recipient&apos;s name or email after sending. The old link stops working.</Endpoint>
          <Endpoint method="POST" path="/hooks">Subscribe a URL to one event (Zapier-style REST hook): <code>target_url</code>, <code>event</code>.</Endpoint>
          <Endpoint method="POST" path="/mcp">MCP server (Streamable HTTP) for AI assistants: list and look up agreements, send from templates, remind, void.</Endpoint>
        </div>

        <h3 className="mt-10 text-sm font-semibold uppercase tracking-wide text-gray-500">Compliance & verification</h3>
        <div className="mt-3 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
          <Endpoint method="GET" path="/policy/options">Supported jurisdictions and document types.</Endpoint>
          <Endpoint method="GET" path="/policy/resolve">Preview the compliance decision for a <code>jurisdiction</code> and <code>documentType</code>.</Endpoint>
          <Endpoint method="POST" path="/verify">Public, no key needed. Upload a PDF to check its signature, timestamp and audit trail.</Endpoint>
        </div>

        <h3 className="mt-10 text-sm font-semibold uppercase tracking-wide text-gray-500">Errors</h3>
        <Code>{`HTTP/1.1 422 Unprocessable Entity
{
  "error": {
    "code": "policy_violation",
    "message": "This document cannot be sent under the selected compliance profile.",
    "details": { "problems": ["Excluded by the First Schedule of the IT Act 2000."] }
  }
}`}</Code>
      </Section>

      <Section id="webhooks">
        <SectionHeading
          eyebrow="Webhooks"
          title="Get notified when things happen"
          intro="Add endpoints under Settings → Webhooks. Deliveries are retried with exponential backoff for up to 8 attempts."
        />
        <div className="mt-10 grid gap-10 lg:grid-cols-2">
          <div>
            <h3 className="font-semibold text-gray-900">Events</h3>
            <dl className="mt-4 divide-y divide-gray-100 rounded-2xl border border-gray-200">
              {EVENTS.map(([e, d]) => (
                <div key={e} className="grid gap-1 px-5 py-3 sm:grid-cols-[180px_1fr]">
                  <dt className="font-mono text-xs text-gray-900">{e}</dt>
                  <dd className="text-sm text-gray-600">{d}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <h3 className="font-semibold text-gray-900">Verify the signature</h3>
            <p className="mt-2 text-sm text-gray-600">
              Each request carries <code>X-DocSign-Signature: t=&lt;unix&gt;,v1=&lt;hex&gt;</code>, an HMAC-SHA256 of <code>&quot;t.body&quot;</code> with your
              endpoint secret. Reject requests older than a few minutes.
            </p>
            <Code>{`// Node.js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verify(rawBody, header, secret, toleranceSec = 300) {
  const { t, v1 } = Object.fromEntries(
    header.split(',').map((kv) => kv.split('=')),
  );
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const expected = createHmac('sha256', secret)
    .update(\`\${t}.\${rawBody}\`).digest('hex');
  return timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'));
}`}</Code>
            <Code>{`# Python
import hmac, hashlib, time

def verify(raw_body: bytes, header: str, secret: str, tolerance=300) -> bool:
    parts = dict(kv.split("=", 1) for kv in header.split(","))
    if abs(time.time() - int(parts["t"])) > tolerance:
        return False
    expected = hmac.new(secret.encode(), f"{parts['t']}.".encode() + raw_body,
                        hashlib.sha256).hexdigest()
    return hmac.compare_digest(parts["v1"], expected)`}</Code>
          </div>
        </div>
      </Section>
      <Section>
        <SectionHeading eyebrow="Tools" title="SDKs, OpenAPI and test mode" />
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {[
            ['Node.js and Python SDKs', 'Typed clients with no dependencies, including webhook signature verification. Other languages can be generated from the OpenAPI spec.'],
            ['OpenAPI 3.1', 'A machine-readable description of the API at /api/v1/openapi.json, for Postman, code generators and API gateways.'],
            ['Test mode', 'Keys starting dsk_test_ create watermarked agreements that are not billed and work on every plan, so you can build before you buy.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-gray-600">{d}</p>
            </div>
          ))}
        </div>
      </Section>
      <CtaBand title="Building an integration?" intro="Tell us about your product and volumes, and we will help you get set up with embedded signing." />
    </>
  );
}
