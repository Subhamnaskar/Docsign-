// Every server call the mobile app makes, in order, against a live server.
// Leaves nothing behind: the draft it creates is deleted at the end.
//   node mobile-live-check.mjs <server> <email> <password>
import { PDFDocument, StandardFonts } from 'pdf-lib';

const [API = 'https://docsign-puce-six.vercel.app', email, password] = process.argv.slice(2);
let token = null;
const results = [];

async function call(name, method, path, { json, form, expect = [200, 201, 204] } = {}) {
  const headers = { Accept: 'application/json', ...(token ? { 'x-session-token': token } : {}), ...(json ? { 'Content-Type': 'application/json' } : {}) };
  const started = Date.now();
  let res;
  try {
    res = await fetch(`${API}/api/v1${path}`, { method, headers, body: form ?? (json ? JSON.stringify(json) : undefined) });
  } catch (err) {
    results.push({ step: name, ok: false, detail: `network: ${err.message}` });
    return null;
  }
  const text = await res.text();
  const body = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  const ok = expect.includes(res.status);
  results.push({ step: name, ok, detail: `${res.status} in ${Date.now() - started} ms${ok ? '' : ` → ${typeof body === 'object' ? body?.error?.message ?? JSON.stringify(body).slice(0, 160) : String(body).slice(0, 160)}`}` });
  return ok ? body : null;
}

async function pdf() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  page.drawText('App check', { x: 60, y: 760, size: 18, font: await doc.embedFont(StandardFonts.HelveticaBold) });
  return Buffer.from(await doc.save());
}

// Sign in (login screen)
const login = await call('Sign in (mobile/login)', 'POST', '/mobile/login', { json: { email, password, platform: 'android' } });
token = login?.token ?? null;
const me = await call('Who am I (auth/me)', 'GET', '/auth/me');
if (me) results.push({ step: '  email confirmed?', ok: me.user.emailVerified, detail: me.user.emailVerified ? 'yes' : 'NO: sending and signing are blocked until confirmed' });
if (me) results.push({ step: '  Word files offered?', ok: true, detail: String(me.features?.officeFiles) + `, upload limit ${me.features?.uploadLimitMb} MB` });

// Tabs
await call('Home tab (home)', 'GET', '/home');
await call('To sign tab (mobile/to-sign)', 'GET', '/mobile/to-sign');
await call('Agreements tab (envelopes)', 'GET', '/envelopes?limit=50');
await call('Agreements search', 'GET', '/envelopes?limit=50&search=lease');

// New agreement: create, upload, signers
const env = await call('New agreement (envelopes)', 'POST', '/envelopes', { json: { title: 'Mobile app check' } });
if (env) {
  const form = new FormData();
  form.append('file', new Blob([await pdf()], { type: 'application/pdf' }), 'check.pdf');
  await call('  upload PDF', 'POST', `/envelopes/${env.id}/documents`, { form });
  await call('  add signer', 'PUT', `/envelopes/${env.id}/recipients`, { json: [{ name: 'Test Signer', email: 'signer@example.test', routingOrder: 1 }] });
  const handoff = await call('  open "place fields" page (mobile/web-session)', 'POST', '/mobile/web-session', { json: { next: `/envelopes/${env.id}/edit?step=fields` } });
  if (handoff) {
    const page = await fetch(`${API}${handoff.path}`, { redirect: 'manual' });
    const cookie = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    const where = page.headers.get('location');
    results.push({ step: '  one-time link signs the web view in', ok: page.status === 302 && /ds_session=/.test(cookie) && where?.includes('/edit'), detail: `${page.status} → ${where}` });
    const editor = await fetch(`${API}${where}`, { headers: { cookie } });
    results.push({ step: '  editor page loads in the web view', ok: editor.status === 200, detail: String(editor.status) });
  }
  await call('  agreement details (envelopes/:id)', 'GET', `/envelopes/${env.id}`);
  await call('  send (without fields, expect a clear refusal)', 'POST', `/envelopes/${env.id}/send`, { expect: [400, 403, 409, 422] });
  await call('  delete draft', 'DELETE', `/envelopes/${env.id}`);
}

// Sign it yourself
const self = await call('Sign it yourself (self-sign)', 'POST', '/self-sign', { json: { title: 'Mobile self-sign check' } });
if (self) await call('  delete draft', 'DELETE', `/envelopes/${self.id}`);

await call('Sign out (mobile/logout)', 'POST', '/mobile/logout', { json: {} });
await call('Token stops working', 'GET', '/auth/me', { expect: [401] });

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step.padEnd(52)} ${r.detail}`);
