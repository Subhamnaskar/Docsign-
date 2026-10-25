import type { Organization, User } from '@prisma/client';
import { appendAudit } from '../audit/audit.js';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { canonicalJson, sha256Hex } from '../lib/crypto.js';
import { layout, sendMail } from '../lib/mailer.js';

/**
 * Internal approval before sending. With the policy on, an agreement a user
 * sends waits for an approver; approving sends it. The approval covers a
 * fingerprint of the documents, recipients and fields, so later edits need
 * a new approval. Sends by API keys and public web forms are automation the
 * organisation set up, so they are not held.
 */

interface ApprovableEnvelope {
  id: string;
  orgId: string;
  title: string;
  message: string | null;
  approvalStatus: string | null;
  approvalFingerprint: string | null;
  documents: { sha256: string; order: number }[];
  recipients: { id: string; email: string; name: string; role: string; routingOrder: number; signatureMethod: string }[];
  fields: { recipientId: string; type: string; page: number; x: number; y: number; amount: number | null; label: string | null }[];
}

export function approvalFingerprint(env: ApprovableEnvelope): string {
  const emailOf = new Map(env.recipients.map((r) => [r.id, r.email]));
  return sha256Hex(
    canonicalJson({
      title: env.title,
      message: env.message,
      documents: env.documents.map((d) => [d.order, d.sha256]),
      recipients: env.recipients.map((r) => [r.email, r.name, r.role, r.routingOrder, r.signatureMethod]),
      fields: env.fields.map((f) => [emailOf.get(f.recipientId), f.type, f.page, f.x.toFixed(4), f.y.toFixed(4), f.amount, f.label]),
    }),
  );
}

export const isApprover = (org: Pick<Organization, 'approverIds'>, user: Pick<User, 'id' | 'role'>) =>
  org.approverIds.length ? org.approverIds.includes(user.id) : user.role === 'OWNER' || user.role === 'ADMIN';

function needsApproval(org: Organization, requester: User) {
  if (org.approvalPolicy === 'all') return true;
  return org.approvalPolicy === 'members' && requester.role === 'MEMBER';
}

/** Decides whether a user's send goes ahead now or waits for approval (and requests it). */
export async function approvalGate(env: ApprovableEnvelope, requesterId: string): Promise<'go' | 'pending'> {
  const [org, requester] = await Promise.all([
    prisma.organization.findUniqueOrThrow({ where: { id: env.orgId } }),
    prisma.user.findUnique({ where: { id: requesterId } }),
  ]);
  if (!requester || !needsApproval(org, requester) || isApprover(org, requester)) return 'go';
  if (env.approvalStatus === 'APPROVED' && env.approvalFingerprint === approvalFingerprint(env)) return 'go';
  if (env.approvalStatus === 'PENDING') return 'pending';

  await prisma.$transaction(async (tx) => {
    await tx.envelope.update({
      where: { id: env.id },
      data: { approvalStatus: 'PENDING', approvalRequestedAt: new Date(), approvalRequestedBy: requester.id, approvalDecidedBy: null, approvalNote: null, approvalFingerprint: null },
    });
    await appendAudit(tx, { envelopeId: env.id, type: 'envelope.approval_requested', actor: { kind: 'user', id: requester.id, name: requester.name, email: requester.email } });
  });
  const approvers = await prisma.user.findMany({
    where: org.approverIds.length ? { id: { in: org.approverIds }, disabledAt: null } : { orgId: org.id, role: { in: ['OWNER', 'ADMIN'] }, disabledAt: null },
  });
  for (const a of approvers.filter((x) => x.id !== requester.id)) {
    const { html, text } = layout({
      heading: `${requester.name} needs your approval`,
      paragraphs: [`"${env.title}" is ready to send to ${env.recipients.filter((r) => r.role !== 'CC').map((r) => r.name).join(', ')}.`, 'Review it and approve or send it back.'],
      button: { label: 'Review agreement', url: `${config.appUrl}/envelopes/${env.id}` },
    });
    await sendMail({ to: a.email, subject: `Approval needed: ${env.title}`, html, text }).catch(() => {});
  }
  return 'pending';
}
