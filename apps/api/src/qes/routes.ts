import { createHash } from 'node:crypto';
import { background } from '../lib/background.js';
import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { beginCryptoSigning } from '../esign/routes.js';
import { completeTransaction, failTransaction } from '../esign/service.js';
import { advanceEnvelope } from '../envelopes/service.js';
import { signingToken } from '../lib/auth.js';
import { hmacSha256Hex, safeEqualHex } from '../lib/crypto.js';
import { CadesSigner } from '../trust/cades.js';
import type { KeyProvider } from '../trust/keys.js';
import { credentialAuthorizeUrl, credentialChain, exchangeCode, firstCredential, serviceAuthorizeUrl, signHashes } from './csc.js';
import { qesSandboxRoutes } from './sandbox.js';

interface QesState {
  stage: 'service' | 'credential';
  credentialID?: string;
  /** Base64 DER certificates, signer first */
  chain?: string[];
  /** Base64 SHA-256 of each document's signed attributes, in document order */
  hashes?: string[];
}

/** Key provider for one remote signature: records what would be signed, or replays the QTSP's signature. */
class RemoteKey implements KeyProvider {
  readonly id = 'csc';
  toBeSigned: Buffer | null = null;
  constructor(
    private chain: Buffer[],
    private signature?: Buffer,
  ) {}
  certificateChain() {
    return this.chain;
  }
  async sign(data: Buffer) {
    this.toBeSigned = data;
    return this.signature ?? Buffer.alloc(384);
  }
}

const stateParam = (txnId: string) => `${txnId}.${hmacSha256Hex(config.appSecret, `qes:${txnId}`).slice(0, 32)}`;
const parseState = (s: string | undefined) => {
  const [txnId, mac] = (s ?? '').split('.');
  return txnId && mac && safeEqualHex(mac, hmacSha256Hex(config.appSecret, `qes:${txnId}`).slice(0, 32)) ? txnId : null;
};

export async function qesRoutes(app: FastifyInstance) {
  /** Saves values and consent, opens the transaction and sends the signer to their trust service. */
  app.post('/signing/:token/qes/start', async (req) => {
    const { r, txn } = await beginCryptoSigning(req, 'QES');
    await prisma.esignTransaction.update({ where: { id: txn.txn }, data: { state: { stage: 'service' } } });
    return { url: serviceAuthorizeUrl(stateParam(txn.txn), r.email) };
  });

  app.get('/qes/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const txnId = parseState(q.state);
    const txn = txnId ? await prisma.esignTransaction.findUnique({ where: { id: txnId } }) : null;
    if (!txn || txn.status !== 'PENDING' || txn.provider !== 'csc') return reply.code(400).send({ error: { code: 'bad_request', message: 'This signing session is not valid any more.' } });
    const r = await prisma.recipient.findUniqueOrThrow({ where: { id: txn.recipientId } });
    const back = (outcome: string) => reply.redirect(`${config.appUrl}/sign/${signingToken(r)}?qes=${outcome}`, 303);
    if (q.error || !q.code) {
      await failTransaction(txn.id, q.error ?? 'cancelled');
      return back('cancelled');
    }
    const state = (txn.state ?? { stage: 'service' }) as unknown as QesState;
    const docs = txn.documents as unknown as { documentId: string; digest: string }[];
    try {
      const token = await exchangeCode(q.code);
      if (state.stage === 'service') {
        // Read the certificate, build the signed attributes and ask the signer to authorise exactly those hashes
        const credentialID = await firstCredential(token);
        const chain = await credentialChain(token, credentialID);
        const hashes: string[] = [];
        for (const d of docs) {
          const key = new RemoteKey(chain);
          await new CadesSigner(key, '').signDigest(Buffer.from(d.digest, 'hex'));
          hashes.push(createHash('sha256').update(key.toBeSigned!).digest('base64'));
        }
        const next: QesState = { stage: 'credential', credentialID, chain: chain.map((c) => c.toString('base64')), hashes };
        await prisma.esignTransaction.update({ where: { id: txn.id }, data: { state: next as object } });
        return reply.redirect(credentialAuthorizeUrl(q.state!, credentialID, hashes), 303);
      }

      const signatures = await signHashes(token, state.credentialID!, state.hashes!);
      const chain = state.chain!.map((c) => Buffer.from(c, 'base64'));
      const cms = new Map<string, Buffer>();
      for (const [i, d] of docs.entries()) {
        const key = new RemoteKey(chain, signatures[i]);
        const signer = new CadesSigner(key, config.tsaUrl);
        cms.set(d.documentId, await signer.signDigest(Buffer.from(d.digest, 'hex')));
        // The rebuilt attributes must be exactly what the signer authorised
        if (createHash('sha256').update(key.toBeSigned!).digest('base64') !== state.hashes![i]) throw new Error('Signed attributes changed between authorisation and signing');
      }
      await completeTransaction(txn.id, cms, { ip: req.ip, userAgent: (req.headers['user-agent'] as string) ?? null });
      background(advanceEnvelope(txn.envelopeId), (err) => req.log.error({ err }, 'advanceEnvelope failed'));
      return back('signed');
    } catch (err) {
      await failTransaction(txn.id, (err as Error).message);
      return back('failed');
    }
  });

  if (config.csc.mode === 'sandbox') await app.register(qesSandboxRoutes);
}
