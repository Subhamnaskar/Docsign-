import pngjs from 'pngjs';
import { badRequest } from './errors.js';

const MAX_WIDTH = 2000;
const MAX_HEIGHT = 1000;
const PREFIX = 'data:image/png;base64,';

/**
 * Fully decodes a signer-supplied PNG and re-encodes it. pdf-lib's PNG decoder
 * can loop forever on malformed input (blocking the event loop), so only
 * images that survive a strict decode here may be stored and later embedded.
 */
export function normalizeSignaturePng(dataUrl: string): string {
  if (!dataUrl.startsWith(PREFIX)) throw badRequest('Signatures must be PNG images.');
  const raw = Buffer.from(dataUrl.slice(PREFIX.length), 'base64');
  // Check dimensions from the IHDR header before decoding pixels
  if (raw.length < 24 || raw.readUInt32BE(16) > MAX_WIDTH || raw.readUInt32BE(20) > MAX_HEIGHT) {
    throw badRequest('Signature image is not a valid PNG or is too large.');
  }
  let png: pngjs.PNG;
  try {
    png = pngjs.PNG.sync.read(raw);
  } catch {
    throw badRequest('Signature image is not a valid PNG.');
  }
  if (png.width === 0 || png.height === 0) throw badRequest('Signature image is empty.');
  return PREFIX + pngjs.PNG.sync.write(png, { colorType: 6 }).toString('base64');
}
