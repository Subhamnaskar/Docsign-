import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from '../config.js';

/**
 * Encrypts small secrets (e.g. SSO client secrets) at rest with AES-256-GCM.
 * The key is derived from APP_SECRET; production should use a KMS-held key.
 */
const key = () => createHash('sha256').update(`secretbox:${config.appSecret}`).digest();

export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}

export function open(sealed: string): string {
  const [v, iv, tag, data] = sealed.split('.');
  if (v !== 'v1') throw new Error('Unknown secret format');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
