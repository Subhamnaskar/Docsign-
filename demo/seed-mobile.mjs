// Sample data for app screenshots, against a local API (npm run dev) and Mailpit.
//   node seed-mobile.mjs  → prints the email and password to sign in with
import { createRequire } from 'node:module';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const API = process.env.API ?? 'http://localhost:4000';
const MAIL = process.env.MAIL ?? 'http://localhost:8025';
const stamp = Date.now();
const password = 'correct-horse-battery';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const { PNG } = createRequire(import.meta.url)('pngjs');

/** fetch with a cookie jar, JSON in and out */
function client() {
  const jar = {};
  return async (method, path, body, raw) => {
    const headers = { cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') };
    if (body && !raw) headers['content-type'] = 'application/json';
    const res = await fetch(`${API}/api/v1${path}`, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined) });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(';');
      const i = kv.indexOf('=');
      jar[kv.slice(0, i)] = kv.slice(i + 1);
    }
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
    return text ? JSON.parse(text) : null;
  };
}

async function mail(to, subject) {
  for (let i = 0; i < 60; i++) {
    const list = await (await fetch(`${MAIL}/api/v1/search?query=${encodeURIComponent(`to:${to}`)}`)).json();
    const m = list.messages?.find((x) => subject.test(x.Subject));
    if (m) return (await fetch(`${MAIL}/api/v1/message/${m.ID}`)).json();
    await pause(500);
  }
  throw new Error(`No email to ${to} matching ${subject}`);
}

async function pdf(title, lines) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([595, 842]);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  page.drawText(title.toUpperCase(), { x: 60, y: 770, size: 18, font: bold });
  lines.forEach((l, i) => page.drawText(l, { x: 60, y: 720 - i * 22, size: 11, font }));
  return Buffer.from(await doc.save());
}

function signature() {
  const png = new PNG({ width: 120, height: 40 });
  for (let x = 0; x < 120; x++) {
    const y = Math.round(20 + 12 * Math.sin(x / 9));
    const i = (y * 120 + x) * 4;
    png.data[i + 3] = 255;
  }
  return `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
}

async function upload(c, envId, name, bytes) {
  const form = new FormData();
  form.append('file', new Blob([bytes], { type: 'application/pdf' }), name);
  return c('POST', `/envelopes/${envId}/documents`, null, form);
}

async function account(name, email, org) {
  const c = client();
  await c('POST', '/auth/register', { name, email, password, organizationName: org, jurisdiction: 'IN' });
  const confirm = await mail(email, /Confirm your email/);
  await c('POST', '/auth/verify-email', { token: confirm.Text.match(/\/verify-email\/([\w-]+)/)[1] });
  return c;
}

async function draft(c, title, recipients, lines) {
  let env = await c('POST', '/envelopes', { title });
  const doc = await upload(c, env.id, `${title}.pdf`, await pdf(title, lines));
  env = await c('PUT', `/envelopes/${env.id}/recipients`, recipients.map((r, i) => ({ ...r, routingOrder: 1, ...(r.order ? { routingOrder: r.order } : {}) })));
  await c(
    'PUT',
    `/envelopes/${env.id}/fields`,
    env.recipients.map((r, i) => ({ documentId: doc.id, recipientId: r.id, type: 'SIGNATURE', page: 0, x: 0.1 + i * 0.45, y: 0.7, width: 0.35, height: 0.06 })),
  );
  return env;
}

/** Signs as an outside signer: link and code from the email. */
async function signAs(email, title) {
  const s = client();
  const token = (await mail(email, new RegExp(`Please sign.*${title}`))).Text.match(/\/sign\/([\w.-]+)/)[1];
  await s('POST', `/signing/${token}/otp/send`);
  const code = (await mail(email, /\d{6}/)).Subject.match(/\d{6}/)[0];
  await s('POST', `/signing/${token}/otp/verify`, { code });
  const session = await s('GET', `/signing/${token}`);
  await s('POST', `/signing/${token}/complete`, { consent: true, values: Object.fromEntries(session.fields.map((f) => [f.id, signature()])) });
}

const priyaEmail = `priya.${stamp}@nuronix.test`;
const priya = await account('Priya Nair', priyaEmail, 'Nuronix Demo Pvt Ltd');

// Out for signature: Ravi has signed, Anita hasn't yet
const lease = await draft(priya, 'Office lease – Bengaluru', [
  { name: 'Ravi Kumar', email: `ravi.${stamp}@example.test` },
  { name: 'Anita Desai', email: `anita.${stamp}@example.test` },
], ['Lease of 2,400 sq ft office space at Indiranagar, Bengaluru.', 'Term: 36 months from 1 December 2026.']);
await priya('PATCH', `/envelopes/${lease.id}`, { routing: 'PARALLEL' }).catch(() => {});
await priya('POST', `/envelopes/${lease.id}/send`);
await signAs(`ravi.${stamp}@example.test`, 'Office lease');

// Sent and completed by a single signer
const nda = await draft(priya, 'NDA – Globex Corporation', [{ name: 'Arjun Mehta', email: `arjun.nda.${stamp}@example.test` }], ['Mutual non-disclosure agreement.']);
await priya('POST', `/envelopes/${nda.id}/send`);
await signAs(`arjun.nda.${stamp}@example.test`, 'NDA');

// Sent, nobody signed yet
const vendor = await draft(priya, 'Vendor agreement – CloudKitchen', [{ name: 'Meera Iyer', email: `meera.${stamp}@example.test` }], ['Supply of catering services.']);
await priya('POST', `/envelopes/${vendor.id}/send`);

// A draft
await draft(priya, 'Consulting agreement – Q1 2027', [{ name: 'Kabir Shah', email: `kabir.${stamp}@example.test` }], ['Advisory services, January to March 2027.']);

// Signed myself
const self = await priya('POST', '/self-sign', { title: 'Joining letter' });
const selfDoc = await upload(priya, self.id, 'Joining letter.pdf', await pdf('Joining letter', ['Welcome to Nuronix Demo Pvt Ltd.']));
await priya('PUT', `/envelopes/${self.id}/fields`, [
  { documentId: selfDoc.id, recipientId: self.recipients[0].id, type: 'SIGNATURE', page: 0, x: 0.1, y: 0.7, width: 0.35, height: 0.06 },
]);
const { signPath } = await priya('POST', `/self-sign/${self.id}/start`);
const selfToken = signPath.split('/').pop();
const selfSession = await priya('GET', `/signing/${selfToken}`);
await priya('POST', `/signing/${selfToken}/complete`, { consent: true, values: Object.fromEntries(selfSession.fields.map((f) => [f.id, signature()])) });

// Someone else sends Priya an agreement to sign
const arjun = await account('Arjun Mehta', `arjun.${stamp}@globex.test`, 'Globex Corporation');
const contract = await draft(arjun, 'Freelance design contract', [{ name: 'Priya Nair', email: priyaEmail }], ['Brand design for Globex, 6 weeks.']);
await arjun('POST', `/envelopes/${contract.id}/send`);

await pause(3000); // sealing finishes in the background
console.log(JSON.stringify({ email: priyaEmail, password }));
