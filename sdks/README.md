# DocSign SDKs

| Language | Folder | Install | Dependencies |
|---|---|---|---|
| Node.js / TypeScript (18+) | [`node/`](node) | `npm install ./sdks/node` (publish as `@docsign/sdk`) | none (uses `fetch`) |
| Python (3.9+) | [`python/`](python) | `pip install ./sdks/python` | none (standard library) |
| Other languages | generate from the OpenAPI spec | `openapi-generator-cli generate -i https://<your-app>/api/v1/openapi.json -g java -o docsign-java` | — |

Both SDKs cover agreements (create, upload, recipients, fields, send, remind, void, download, embedded signing), templates, Word template generation and webhooks, and include `verifyWebhook` / `verify_webhook` for the `X-DocSign-Signature` header.

## Test mode

Create a **test key** under Settings → API & webhooks. Keys starting `dsk_test_`:

- work on every plan, so you can build before choosing a plan,
- create agreements watermarked "TEST - NOT LEGALLY BINDING", with "[TEST]" email subjects,
- are not counted towards your plan's agreement allowance,
- only see test agreements (live keys only see live ones).

Switch to a live `dsk_` key when you go to production.

## Node example

```ts
import { DocSign, verifyWebhook } from '@docsign/sdk';

const ds = new DocSign({ apiKey: process.env.DOCSIGN_API_KEY!, baseUrl: 'https://app.example.com' });
let env = await ds.envelopes.create({ title: 'Offer letter', jurisdiction: 'IN' });
const doc = await ds.envelopes.uploadDocument(env.id, await readFile('offer.pdf'), 'offer.pdf');
env = await ds.envelopes.setRecipients(env.id, [{ name: 'Priya Shah', email: 'priya@example.com', locale: 'hi' }]);
await ds.envelopes.setFields(env.id, [
  { documentId: doc.id, recipientId: env.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.8, width: 0.3, height: 0.06 },
]);
await ds.envelopes.send(env.id);

// Express webhook handler (use express.raw so the body is not re-serialised)
app.post('/docsign', express.raw({ type: 'application/json' }), (req, res) => {
  const event = verifyWebhook(req.body, req.header('X-DocSign-Signature'), process.env.DOCSIGN_WEBHOOK_SECRET!);
  if (event.event === 'envelope.completed') {
    // download the sealed PDF with ds.envelopes.downloadDocument(...)
  }
  res.sendStatus(200);
});
```

See [`python/README.md`](python/README.md) for Python.
