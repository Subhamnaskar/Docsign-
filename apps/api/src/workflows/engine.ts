import type { Prisma, Workflow } from '@prisma/client';
import { z } from 'zod';
import { config } from '../config.js';
import { prisma, type Tx } from '../db.js';
import { sendEnvelope } from '../envelopes/service.js';
import { layout, sendMail } from '../lib/mailer.js';
import { getObject } from '../lib/storage.js';
import { createEnvelopeFromTemplate, getTemplate } from '../templates/service.js';
import { chatBody, describeEvent, isChatWebhookUrl } from '../webhooks/chat.js';

/**
 * Workflows: when an event happens to an agreement that matches the
 * conditions, run the actions. Runs are queued in the event's transaction and
 * carried out by the worker, with retries.
 */

export const TRIGGERS = {
  'envelope.sent': 'An agreement is sent',
  'recipient.viewed': 'A signer opens an agreement',
  'recipient.signed': 'A signer signs',
  'recipient.declined': 'A signer declines',
  'envelope.completed': 'An agreement is completed',
  'envelope.voided': 'An agreement is voided',
  'envelope.expired': 'An agreement expires',
} as const;
export type Trigger = keyof typeof TRIGGERS;

export const CONDITION_FIELDS = {
  title: 'Title',
  documentType: 'Document type',
  jurisdiction: 'Jurisdiction',
  templateId: 'Template',
  departmentId: 'Department',
  folderId: 'Folder',
} as const;

export const conditionSchema = z.object({
  field: z.enum(Object.keys(CONDITION_FIELDS) as [keyof typeof CONDITION_FIELDS, ...(keyof typeof CONDITION_FIELDS)[]]),
  op: z.enum(['equals', 'not_equals', 'contains']),
  value: z.string().trim().max(200),
});
export type Condition = z.infer<typeof conditionSchema>;

export const actionSchema = z.discriminatedUnion('type', [
  /** Email the people listed; on completion the signed PDFs and certificate are attached */
  z.object({ type: z.literal('email_copy'), to: z.array(z.string().trim().toLowerCase().email()).min(1).max(10) }),
  z.object({ type: z.literal('move_to_folder'), folderId: z.string().min(1) }),
  z.object({ type: z.literal('add_tag'), tag: z.string().trim().min(1).max(40) }),
  /** Send the next agreement from a template to the same signers, role by role in signing order */
  z.object({ type: z.literal('send_template'), templateId: z.string().min(1), title: z.string().trim().max(200).optional() }),
  z.object({ type: z.literal('notify_chat'), format: z.enum(['slack', 'teams']), url: z.string().url() }),
]);
export type Action = z.infer<typeof actionSchema>;

export const ACTION_NAMES: Record<Action['type'], string> = {
  email_copy: 'Email a copy',
  move_to_folder: 'Move to a folder',
  add_tag: 'Add a repository tag',
  send_template: 'Send another agreement from a template',
  notify_chat: 'Post to Slack or Teams',
};

const MAX_ATTEMPTS = 5;

type EnvelopeFacts = { title: string; documentType: string; jurisdiction: string; templateId: string | null; departmentId: string | null; folderId: string | null };

export function matches(conditions: Condition[], env: EnvelopeFacts): boolean {
  return conditions.every((c) => {
    const actual = (env[c.field] ?? '').toLowerCase();
    const wanted = c.value.toLowerCase();
    if (c.op === 'equals') return actual === wanted;
    if (c.op === 'not_equals') return actual !== wanted;
    return actual.includes(wanted);
  });
}

/** Queues runs for the organisation's enabled workflows whose trigger and conditions match. */
export async function enqueueWorkflowRuns(tx: Tx, orgId: string, event: string, data: Record<string, unknown>) {
  if (!(event in TRIGGERS) || typeof data.envelopeId !== 'string') return;
  const workflows = await tx.workflow.findMany({ where: { orgId, enabled: true, trigger: event } });
  if (workflows.length === 0) return;
  const env = await tx.envelope.findUnique({
    where: { id: data.envelopeId },
    select: { title: true, documentType: true, jurisdiction: true, templateId: true, departmentId: true, folderId: true, createdByWorkflowId: true, testMode: true },
  });
  // Agreements started by a workflow, or created with test keys, never trigger workflows
  if (!env || env.createdByWorkflowId || env.testMode) return;
  const due = workflows.filter((w) => matches(w.conditions as Condition[], env));
  if (due.length === 0) return;
  await tx.workflowRun.createMany({
    data: due.map((w) => ({ workflowId: w.id, orgId, envelopeId: data.envelopeId as string, event, data: data as Prisma.JsonObject })),
  });
}

type Result = { type: Action['type']; ok: boolean; detail: string };

async function runAction(w: Workflow, action: Action, envelopeId: string, event: string, data: Record<string, unknown>): Promise<Result> {
  const env = await prisma.envelope.findUniqueOrThrow({
    where: { id: envelopeId },
    include: { documents: { orderBy: { order: 'asc' } }, recipients: { orderBy: { routingOrder: 'asc' } }, createdBy: true },
  });
  switch (action.type) {
    case 'email_copy': {
      const completed = env.status === 'COMPLETED' && env.documents.every((d) => d.finalKey);
      const attachments = completed
        ? [
            ...(await Promise.all(env.documents.map(async (d) => ({ filename: `${d.name.replace(/\.[^.]+$/, '')} (signed).pdf`, content: await getObject(d.finalKey!), contentType: 'application/pdf' })))),
            ...(env.certificateKey ? [{ filename: 'Certificate of Completion.pdf', content: await getObject(env.certificateKey), contentType: 'application/pdf' }] : []),
          ]
        : [];
      const size = attachments.reduce((n, a) => n + a.content.length, 0);
      const msg = await describeEvent(event, data);
      const { html, text } = layout({
        heading: env.title,
        paragraphs: [msg.text, completed ? (size < 15 * 1024 * 1024 ? 'The signed documents and certificate of completion are attached.' : 'The signed documents are too large to attach; open the agreement to download them.') : `Sent by the "${w.name}" workflow.`],
        button: { label: 'Open the agreement', url: `${config.appUrl}/envelopes/${env.id}` },
        footer: `Sent by the "${w.name}" workflow.`,
      });
      for (const to of action.to) {
        await sendMail({ to, subject: `${env.title}: ${TRIGGERS[event as Trigger] ?? event}`, html, text, attachments: completed && size < 15 * 1024 * 1024 ? attachments : undefined, orgId: env.orgId });
      }
      return { type: action.type, ok: true, detail: `Emailed ${action.to.join(', ')}${completed ? ' with the signed PDFs' : ''}` };
    }
    case 'move_to_folder': {
      const folder = await prisma.folder.findFirst({ where: { id: action.folderId, orgId: env.orgId } });
      if (!folder) return { type: action.type, ok: false, detail: 'The folder no longer exists' };
      await prisma.envelope.update({ where: { id: env.id }, data: { folderId: folder.id } });
      return { type: action.type, ok: true, detail: `Moved to "${folder.name}"` };
    }
    case 'add_tag': {
      const meta = await prisma.contractMeta.findUnique({ where: { envelopeId: env.id } });
      if (meta?.tags.includes(action.tag)) return { type: action.type, ok: true, detail: `Already tagged "${action.tag}"` };
      await prisma.contractMeta.upsert({ where: { envelopeId: env.id }, create: { envelopeId: env.id, tags: [action.tag] }, update: { tags: { push: action.tag } } });
      return { type: action.type, ok: true, detail: `Tagged "${action.tag}"` };
    }
    case 'send_template': {
      const t = await getTemplate(env.orgId, action.templateId);
      const signers = env.recipients.filter((r) => r.role !== 'CC');
      const roles = [...t.roles].sort((a, b) => a.routingOrder - b.routingOrder);
      if (signers.length < roles.length) return { type: action.type, ok: false, detail: `"${t.name}" needs ${roles.length} signers; this agreement has ${signers.length}` };
      const recipients = roles.map((role, i) => ({ roleId: role.id, name: signers[i].name, email: signers[i].email, locale: signers[i].locale }));
      const ctx = { orgId: env.orgId, userId: w.createdById ?? env.createdById, actor: { kind: 'system' as const } };
      const newId = await createEnvelopeFromTemplate(t, ctx, { title: action.title || undefined, recipients, workflowId: w.id });
      await sendEnvelope(env.orgId, newId, { kind: 'system' }, {});
      return { type: action.type, ok: true, detail: `Sent "${action.title || t.title}" to ${recipients.map((r) => r.email).join(', ')}` };
    }
    case 'notify_chat': {
      if (!isChatWebhookUrl(action.format, action.url)) return { type: action.type, ok: false, detail: `Not a ${action.format} webhook URL` };
      const res = await fetch(action.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chatBody(action.format, await describeEvent(event, data))),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`${action.format} answered ${res.status}`);
      return { type: action.type, ok: true, detail: `Posted to ${action.format === 'slack' ? 'Slack' : 'Teams'}` };
    }
  }
}

/** Worker: carries out queued runs. A thrown error retries the whole run later; a failed action result does not. */
export async function runPendingWorkflows(limit = 20): Promise<number> {
  const due = await prisma.workflowRun.findMany({ where: { status: 'PENDING', nextAttemptAt: { lte: new Date() } }, orderBy: { nextAttemptAt: 'asc' }, take: limit, include: { workflow: true } });
  for (const run of due) {
    // Claim it so two workers don't run the same thing
    const claimed = await prisma.workflowRun.updateMany({ where: { id: run.id, status: 'PENDING', attempts: run.attempts }, data: { attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + 60_000) } });
    if (!claimed.count) continue;
    const results: Result[] = [];
    try {
      const actions = z.array(actionSchema).parse(run.workflow.actions);
      for (const action of actions) results.push(await runAction(run.workflow, action, run.envelopeId!, run.event, run.data as Record<string, unknown>));
      const failed = results.filter((r) => !r.ok);
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: { status: failed.length ? 'FAILED' : 'SUCCEEDED', results: results as Prisma.JsonArray, error: failed.length ? failed.map((f) => f.detail).join('; ') : null, finishedAt: new Date() },
      });
      await prisma.workflow.update({ where: { id: run.workflowId }, data: { runCount: { increment: 1 }, lastRunAt: new Date() } });
    } catch (err) {
      const attempts = run.attempts + 1;
      const final = attempts >= MAX_ATTEMPTS;
      await prisma.workflowRun.update({
        where: { id: run.id },
        data: {
          status: final ? 'FAILED' : 'PENDING',
          error: err instanceof Error ? err.message : String(err),
          results: results as Prisma.JsonArray,
          nextAttemptAt: new Date(Date.now() + 2 ** attempts * 30_000),
          ...(final && { finishedAt: new Date() }),
        },
      });
    }
  }
  return due.length;
}
