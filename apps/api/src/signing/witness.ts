import type { Recipient } from '@prisma/client';
import { prisma } from '../db.js';
import { badRequest } from '../lib/errors.js';

/** The signer this recipient witnesses, if any. */
export async function witnessPrincipal(r: Pick<Recipient, 'witnessForId'>) {
  return r.witnessForId ? prisma.recipient.findUnique({ where: { id: r.witnessForId }, select: { id: true, name: true, email: true, signedAt: true } }) : null;
}

export const attestationText = (principal: { name: string }) =>
  `I confirm that ${principal.name} signed this document in my presence, and I am signing as their witness.`;

/** Witnesses must confirm the attestation; returns the evidence for the audit trail. */
export async function requireAttestation(r: Pick<Recipient, 'witnessForId'>, attest: boolean | undefined) {
  const principal = await witnessPrincipal(r);
  if (!principal) return null;
  if (attest !== true) throw badRequest(`Confirm that you witnessed ${principal.name} signing.`);
  return { witnessFor: { id: principal.id, name: principal.name, email: principal.email }, attestation: attestationText(principal) };
}
