/**
 * Prints the platform seal key as one SEAL_KEYS value, for hosts without a
 * persistent disk (Render free, etc.). Creates the key first if needed.
 *
 *   npm run keys:export -w @docsign/api
 *
 * Keep the value secret: anyone with it can seal documents as your platform.
 */
import { resolve } from 'node:path';
import { config } from '../config.js';
import { exportSealKeys, sealKeyProvider } from './keys.js';

sealKeyProvider();
console.log(exportSealKeys(resolve(config.keysDir)));
