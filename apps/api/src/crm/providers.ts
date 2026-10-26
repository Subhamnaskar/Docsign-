import { config } from '../config.js';
import { prisma } from '../db.js';
import { open, seal } from '../lib/secretbox.js';
import { getObject } from '../lib/storage.js';

/**
 * CRM sync. Each agreement event becomes an activity on the CRM record (the
 * signer's contact, or a deal/record linked through the envelope's
 * externalRefs); completed agreements also attach the signed PDF.
 * Both adapters follow the vendors' published REST APIs and are untested
 * without real accounts.
 */

export interface SyncContext {
  event: string;
  envelope: { id: string; title: string; externalRefs: Record<string, string> | null };
  recipients: { name: string; email: string; role: string; status: string }[];
  text: string;
  url: string;
  /** Signed documents, for envelope.completed */
  files: () => Promise<{ name: string; data: Buffer }[]>;
}

export interface CrmProvider {
  sync(conn: { id: string; credentialsEnc: string; settings: unknown }, ctx: SyncContext): Promise<void>;
}

class CrmError extends Error {}

async function call(url: string, init: RequestInit & { token: string }): Promise<Response> {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${init.token}`, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok && res.status !== 404) throw new CrmError(`${new URL(url).hostname} responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res;
}

const splitName = (name: string) => {
  const parts = name.trim().split(/\s+/);
  return { first: parts.slice(0, -1).join(' ') || parts[0], last: parts.length > 1 ? parts[parts.length - 1] : '' };
};

// --- HubSpot (private app token) ---------------------------------------------

const HUBSPOT = 'https://api.hubapi.com';
/** HubSpot-defined association types for notes */
const NOTE_TO_CONTACT = 202;
const NOTE_TO_DEAL = 214;

export const hubspot: CrmProvider = {
  async sync(conn, ctx) {
    const { token } = JSON.parse(open(conn.credentialsEnc)) as { token: string };
    const settings = (conn.settings ?? {}) as { attachPdf?: boolean };
    const json = { 'Content-Type': 'application/json' };

    // Contacts for the signers (created if missing)
    const contactIds: string[] = [];
    for (const r of ctx.recipients.filter((x) => x.role !== 'CC')) {
      const found = (await (
        await call(`${HUBSPOT}/crm/v3/objects/contacts/search`, {
          token,
          method: 'POST',
          headers: json,
          body: JSON.stringify({ filterGroups: [{ filters: [{ propertyName: 'email', operator: 'EQ', value: r.email }] }], limit: 1 }),
        })
      ).json()) as { results?: { id: string }[] };
      let id = found.results?.[0]?.id;
      if (!id) {
        const { first, last } = splitName(r.name);
        const created = (await (
          await call(`${HUBSPOT}/crm/v3/objects/contacts`, { token, method: 'POST', headers: json, body: JSON.stringify({ properties: { email: r.email, firstname: first, lastname: last } }) })
        ).json()) as { id: string };
        id = created.id;
      }
      contactIds.push(id);
    }

    const attachmentIds: string[] = [];
    if (ctx.event === 'envelope.completed' && settings.attachPdf !== false) {
      for (const f of await ctx.files()) {
        const form = new FormData();
        form.append('file', new Blob([new Uint8Array(f.data)], { type: 'application/pdf' }), f.name);
        form.append('folderPath', '/Nuronix eSign');
        form.append('options', JSON.stringify({ access: 'PRIVATE', overwrite: false }));
        const up = (await (await call(`${HUBSPOT}/files/v3/files`, { token, method: 'POST', body: form })).json()) as { id: string };
        attachmentIds.push(up.id);
      }
    }

    const associations = [
      ...contactIds.map((id) => ({ to: { id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_CONTACT }] })),
      ...(ctx.envelope.externalRefs?.hubspotDealId
        ? [{ to: { id: ctx.envelope.externalRefs.hubspotDealId }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: NOTE_TO_DEAL }] }]
        : []),
    ];
    await call(`${HUBSPOT}/crm/v3/objects/notes`, {
      token,
      method: 'POST',
      headers: json,
      body: JSON.stringify({
        properties: {
          hs_timestamp: new Date().toISOString(),
          hs_note_body: `<p>${ctx.text}</p><p><a href="${ctx.url}">Open in Nuronix eSign</a></p>`,
          ...(attachmentIds.length ? { hs_attachment_ids: attachmentIds.join(';') } : {}),
        },
        associations,
      }),
    });
  },
};

// --- Salesforce (OAuth web server flow) ----------------------------------------

export const SF_API = 'v60.0';

export interface SalesforceCreds {
  accessToken: string;
  refreshToken: string;
  instanceUrl: string;
}

async function refreshSalesforce(connId: string, creds: SalesforceCreds): Promise<SalesforceCreds> {
  const res = await fetch(`${config.crm.salesforceLoginUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refreshToken, client_id: config.crm.salesforceClientId, client_secret: config.crm.salesforceClientSecret }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new CrmError('Salesforce refused to refresh the connection. Reconnect under Settings → Integrations.');
  const t = (await res.json()) as { access_token: string; instance_url?: string };
  const next = { ...creds, accessToken: t.access_token, instanceUrl: t.instance_url ?? creds.instanceUrl };
  await prisma.crmConnection.update({ where: { id: connId }, data: { credentialsEnc: seal(JSON.stringify(next)) } });
  return next;
}

export const salesforce: CrmProvider = {
  async sync(conn, ctx) {
    let creds = JSON.parse(open(conn.credentialsEnc)) as SalesforceCreds;
    const settings = (conn.settings ?? {}) as { attachPdf?: boolean };
    // Calls the Salesforce REST API, refreshing the access token once if it expired
    const sf = async (path: string, init: RequestInit = {}) => {
      const go = () => fetch(`${creds.instanceUrl}/services/data/${SF_API}${path}`, { ...init, headers: { Authorization: `Bearer ${creds.accessToken}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) }, signal: AbortSignal.timeout(20_000) });
      let res = await go();
      if (res.status === 401) {
        creds = await refreshSalesforce(conn.id, creds);
        res = await go();
      }
      if (!res.ok) throw new CrmError(`Salesforce responded ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return res.json() as Promise<Record<string, unknown>>;
    };

    const linked = ctx.envelope.externalRefs?.salesforceRecordId;
    const signer = ctx.recipients.find((r) => r.role !== 'CC');
    let contactId: string | undefined;
    if (signer) {
      const q = await sf(`/query?q=${encodeURIComponent(`SELECT Id FROM Contact WHERE Email = '${signer.email.replace(/'/g, "\\\\'")}' LIMIT 1`)}`);
      contactId = (q.records as { Id: string }[] | undefined)?.[0]?.Id;
    }
    await sf('/sobjects/Task', {
      method: 'POST',
      body: JSON.stringify({
        Subject: `Nuronix eSign: ${ctx.text}`.slice(0, 255),
        Description: `${ctx.text}\n${ctx.url}`,
        Status: 'Completed',
        ActivityDate: new Date().toISOString().slice(0, 10),
        ...(contactId ? { WhoId: contactId } : {}),
        ...(linked && !linked.startsWith('003') ? { WhatId: linked } : {}),
      }),
    });
    if (ctx.event === 'envelope.completed' && settings.attachPdf !== false && (linked || contactId)) {
      for (const f of await ctx.files()) {
        await sf('/sobjects/ContentVersion', {
          method: 'POST',
          body: JSON.stringify({ Title: f.name.replace(/\.pdf$/i, ''), PathOnClient: f.name, VersionData: f.data.toString('base64'), FirstPublishLocationId: linked ?? contactId }),
        });
      }
    }
  },
};

export const CRM_PROVIDERS: Record<string, CrmProvider> = { hubspot, salesforce };

/** Signed PDFs of an envelope for attaching to CRM records. */
export async function signedFiles(envelopeId: string) {
  const docs = await prisma.document.findMany({ where: { envelopeId, finalKey: { not: null } }, orderBy: { order: 'asc' } });
  return Promise.all(docs.map(async (d) => ({ name: d.name, data: await getObject(d.finalKey!) })));
}

export { CrmError };
