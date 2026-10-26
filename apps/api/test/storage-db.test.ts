import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { deletePrefix, getObject, putObject } from '../src/lib/storage.js';
import { uid } from './helpers.js';

// Files in Postgres (STORAGE_DRIVER=database), used on Vercel + Neon
const original = config.storageDriver;
beforeAll(() => {
  config.storageDriver = 'database';
});
afterAll(() => {
  config.storageDriver = original;
});

describe('database file storage', () => {
  it('stores, replaces, reads and deletes files, keeping retained ones', async () => {
    const prefix = `test/${uid()}/`;
    await putObject(`${prefix}a.pdf`, Buffer.from('first'), 'application/pdf');
    await putObject(`${prefix}a.pdf`, Buffer.from('second'), 'application/pdf');
    expect((await getObject(`${prefix}a.pdf`)).toString()).toBe('second');
    await putObject(`${prefix}sealed.pdf`, Buffer.from('sealed'), 'application/pdf', 7);
    await expect(getObject(`${prefix}missing.pdf`)).rejects.toThrow(/No such object/);

    expect(await deletePrefix(prefix)).toEqual({ deleted: 1, locked: 1 });
    await expect(getObject(`${prefix}a.pdf`)).rejects.toThrow();
    expect((await getObject(`${prefix}sealed.pdf`)).toString()).toBe('sealed');
    await prisma.storedObject.deleteMany({ where: { key: { startsWith: prefix } } });
  });
});
