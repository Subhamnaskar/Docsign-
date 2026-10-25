import type { Prisma } from '@prisma/client';
import { appendAudit, type Actor } from '../audit/audit.js';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { SUPPORTED_LOCALES } from '../i18n/messages.js';
import { getObject, putObject } from '../lib/storage.js';

export const templateInclude = {
  documents: { orderBy: { order: 'asc' } },
  roles: { orderBy: [{ routingOrder: 'asc' }, { name: 'asc' }] },
  fields: true,
} satisfies Prisma.TemplateInclude;

export type FullTemplate = Prisma.TemplateGetPayload<{ include: typeof templateInclude }>;

export async function getTemplate(orgId: string, id: string): Promise<FullTemplate> {
  const t = await prisma.template.findFirst({ where: { id, orgId }, include: templateInclude });
  if (!t) throw notFound('Template');
  return t;
}

/** Snapshots an envelope's documents, recipients (as roles) and field layout into a template. */
export async function createTemplateFromEnvelope(
  orgId: string,
  userId: string,
  envelopeId: string,
  input: { name: string; description?: string | null; roleNames?: Record<string, string> },
): Promise<FullTemplate> {
  const env = await prisma.envelope.findFirst({
    where: { id: envelopeId, orgId },
    include: { documents: { orderBy: { order: 'asc' } }, recipients: { orderBy: { routingOrder: 'asc' } }, fields: true },
  });
  if (!env) throw notFound('Envelope');
  if (env.documents.length === 0) throw badRequest('Add at least one document before saving a template.');

  // Read originals before the transaction so the transaction stays short
  const originals = await Promise.all(env.documents.map((d) => getObject(d.storageKey)));
  let signerN = 0;
  let ccN = 0;

  const template = await prisma.$transaction(
    async (tx) => {
      const t = await tx.template.create({
        data: {
          orgId,
          createdById: userId,
          name: input.name,
          description: input.description ?? null,
          title: env.title,
          message: env.message,
          jurisdiction: env.jurisdiction,
          documentType: env.documentType,
          routing: env.routing,
          reminderDays: env.reminderDays,
        },
      });
      const docMap = new Map<string, string>();
      for (const [i, d] of env.documents.entries()) {
        const td = await tx.templateDocument.create({
          data: { templateId: t.id, name: d.name, order: d.order, storageKey: '', sha256: d.sha256, pageCount: d.pageCount, pages: d.pages as object },
        });
        const storageKey = `templates/${t.id}/${td.id}.pdf`;
        await putObject(storageKey, originals[i], 'application/pdf');
        await tx.templateDocument.update({ where: { id: td.id }, data: { storageKey } });
        docMap.set(d.id, td.id);
      }
      const roleMap = new Map<string, string>();
      for (const r of env.recipients) {
        const fallback = r.role === 'SIGNER' ? `Signer ${++signerN}` : r.role === 'APPROVER' ? `Approver ${++signerN}` : `Copy ${++ccN}`;
        const role = await tx.templateRole.create({
          data: { templateId: t.id, name: input.roleNames?.[r.id]?.trim() || fallback, role: r.role, routingOrder: r.routingOrder },
        });
        roleMap.set(r.id, role.id);
      }
      await tx.templateField.createMany({
        data: env.fields.map((f) => ({
          templateId: t.id,
          documentId: docMap.get(f.documentId)!,
          roleId: roleMap.get(f.recipientId)!,
          type: f.type,
          page: f.page,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          required: f.required,
          label: f.label,
          options: f.options,
          formula: f.formula,
          condition: f.condition ?? undefined,
          amount: f.amount,
          currency: f.currency,
        })),
      });
      return t;
    },
    { timeout: 60_000 },
  );
  return getTemplate(orgId, template.id);
}

export interface RoleAssignment {
  roleId: string;
  name: string;
  email: string;
  locale?: string;
}

/** Validates that every role is filled exactly once with a valid person. */
export function checkAssignments(t: FullTemplate, assignments: RoleAssignment[]): string[] {
  const problems: string[] = [];
  for (const role of t.roles) {
    const matches = assignments.filter((a) => a.roleId === role.id);
    if (matches.length === 0) problems.push(`Missing recipient for role "${role.name}".`);
    if (matches.length > 1) problems.push(`Role "${role.name}" is assigned more than once.`);
    for (const a of matches) {
      if (!a.name.trim()) problems.push(`Enter a name for "${role.name}".`);
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email.trim())) problems.push(`"${a.email}" is not a valid email for "${role.name}".`);
      if (a.locale && !SUPPORTED_LOCALES.includes(a.locale)) problems.push(`Unsupported language "${a.locale}".`);
    }
  }
  for (const a of assignments) {
    if (!t.roles.some((r) => r.id === a.roleId)) problems.push(`Unknown role ${a.roleId}.`);
  }
  return problems;
}

/** Creates a draft envelope from a template, binding each role to a real person. */
export async function createEnvelopeFromTemplate(
  t: FullTemplate,
  ctx: { orgId: string; userId: string; actor: Actor; ip?: string | null; userAgent?: string | null },
  input: { title?: string; message?: string | null; recipients: RoleAssignment[]; documentBuffers?: Buffer[]; workflowId?: string },
): Promise<string> {
  const docs = input.documentBuffers ?? (await Promise.all(t.documents.map((d) => getObject(d.storageKey))));
  const env = await prisma.$transaction(
    async (tx) => {
      const created = await tx.envelope.create({
        data: {
          orgId: ctx.orgId,
          createdById: ctx.userId,
          title: input.title?.trim() || t.title,
          message: input.message === undefined ? t.message : input.message,
          jurisdiction: t.jurisdiction,
          documentType: t.documentType,
          routing: t.routing,
          reminderDays: t.reminderDays,
          templateId: t.id,
          createdByWorkflowId: input.workflowId ?? null,
        },
      });
      const docMap = new Map<string, string>();
      for (const [i, d] of t.documents.entries()) {
        const nd = await tx.document.create({
          data: { envelopeId: created.id, name: d.name, order: d.order, storageKey: '', sha256: d.sha256, pageCount: d.pageCount, pages: d.pages as object },
        });
        const storageKey = `envelopes/${created.id}/original/${nd.id}.pdf`;
        await putObject(storageKey, docs[i], 'application/pdf');
        await tx.document.update({ where: { id: nd.id }, data: { storageKey } });
        docMap.set(d.id, nd.id);
      }
      const recipientMap = new Map<string, string>();
      for (const role of t.roles) {
        const a = input.recipients.find((x) => x.roleId === role.id)!;
        const r = await tx.recipient.create({
          data: {
            envelopeId: created.id,
            name: a.name.trim(),
            email: a.email.trim().toLowerCase(),
            locale: a.locale ?? 'en',
            role: role.role,
            routingOrder: role.routingOrder,
          },
        });
        recipientMap.set(role.id, r.id);
      }
      await tx.field.createMany({
        data: t.fields.map((f) => ({
          envelopeId: created.id,
          documentId: docMap.get(f.documentId)!,
          recipientId: recipientMap.get(f.roleId)!,
          type: f.type,
          page: f.page,
          x: f.x,
          y: f.y,
          width: f.width,
          height: f.height,
          required: f.required,
          label: f.label,
          options: f.options,
          formula: f.formula,
          condition: f.condition ?? undefined,
          amount: f.amount,
          currency: f.currency,
        })),
      });
      await appendAudit(tx, {
        envelopeId: created.id,
        type: 'envelope.created',
        actor: ctx.actor,
        data: { title: created.title, fromTemplate: { id: t.id, name: t.name } },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return created;
    },
    { timeout: 60_000 },
  );
  return env.id;
}
