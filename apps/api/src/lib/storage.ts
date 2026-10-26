import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from '../config.js';
import { prisma } from '../db.js';

const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: true,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
});

/** Creates the bucket (with Object Lock where supported) so sealed documents can be stored write-once. */
export async function ensureBucket(): Promise<void> {
  if (config.storageDriver === 'database') return;
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
  } catch {
    await s3.send(
      new CreateBucketCommand({ Bucket: config.s3.bucket, ...(config.s3.objectLock && { ObjectLockEnabledForBucket: true }) }),
    );
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
  retainYears?: number,
): Promise<void> {
  if (config.storageDriver === 'database') {
    const retainUntil = retainYears ? new Date(Date.now() + retainYears * 365 * 24 * 3600 * 1000) : null;
    await prisma.storedObject.upsert({
      where: { key },
      create: { key, data: new Uint8Array(body), contentType, size: body.length, retainUntil },
      update: { data: new Uint8Array(body), contentType, size: body.length, ...(retainUntil && { retainUntil }) },
    });
    return;
  }
  const retainUntil = retainYears ? new Date(Date.now() + retainYears * 365 * 24 * 3600 * 1000) : null;
  const retention = !retainUntil
    ? {}
    : config.s3.objectLock
      ? // GOVERNANCE mode: write-once for normal users; privileged admins can
        // still lift it (use COMPLIANCE in production cells).
        { ObjectLockMode: 'GOVERNANCE' as const, ObjectLockRetainUntilDate: retainUntil }
      : // Stores without Object Lock: deletePrefix enforces the date itself
        { Metadata: { [RETAIN_UNTIL]: retainUntil.toISOString() } };
  const kmsKeyId = await customerKeyFor(key);
  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...retention,
      // Organisations with a customer-managed key get SSE-KMS under that key
      ...(kmsKeyId ? { ServerSideEncryption: 'aws:kms' as const, SSEKMSKeyId: kmsKeyId } : {}),
    }),
  );
}

const RETAIN_UNTIL = 'retain-until';

/** Without Object Lock: whether a version is still inside the retention date recorded at upload. */
async function retained(Key: string, VersionId: string | undefined, now: Date): Promise<boolean> {
  const head = await s3.send(new HeadObjectCommand({ Bucket: config.s3.bucket, Key, VersionId }));
  const until = head.Metadata?.[RETAIN_UNTIL];
  return !!until && new Date(until) > now;
}

const keyCache = new Map<string, { at: number; keyId: string | null }>();

/** The organisation's KMS key for an object, from its key prefix (envelopes/<id>/…, doc-templates/<orgId>/…). */
async function customerKeyFor(key: string): Promise<string | null> {
  const env = /^envelopes\/([^/]+)\//.exec(key)?.[1];
  const orgFromPath = /^doc-templates\/([^/]+)\//.exec(key)?.[1];
  const cacheKey = env ? `e:${env}` : orgFromPath ? `o:${orgFromPath}` : null;
  if (!cacheKey) return null;
  const hit = keyCache.get(cacheKey);
  if (hit && Date.now() - hit.at < 60_000) return hit.keyId;
  const orgId = env ? (await prisma.envelope.findUnique({ where: { id: env }, select: { orgId: true } }))?.orgId : orgFromPath;
  const keyId = orgId ? ((await prisma.organization.findUnique({ where: { id: orgId }, select: { storageKmsKeyId: true } }))?.storageKmsKeyId ?? null) : null;
  keyCache.set(cacheKey, { at: Date.now(), keyId });
  return keyId;
}

export const forgetCustomerKeys = () => keyCache.clear();

/**
 * Deletes every version under a prefix. Versions still under a retention
 * period (refused by Object Lock, or checked here when the store has none)
 * are counted as `locked` and the caller retries later.
 */
export async function deletePrefix(prefix: string): Promise<{ deleted: number; locked: number }> {
  if (config.storageDriver === 'database') {
    const now = new Date();
    const locked = await prisma.storedObject.count({ where: { key: { startsWith: prefix }, retainUntil: { gt: now } } });
    const { count } = await prisma.storedObject.deleteMany({ where: { key: { startsWith: prefix }, OR: [{ retainUntil: null }, { retainUntil: { lte: now } }] } });
    return { deleted: count, locked };
  }
  const now = new Date();
  let deleted = 0;
  let locked = 0;
  let keyMarker: string | undefined;
  let versionMarker: string | undefined;
  do {
    const page = await s3.send(new ListObjectVersionsCommand({ Bucket: config.s3.bucket, Prefix: prefix, KeyMarker: keyMarker, VersionIdMarker: versionMarker }));
    let objects = [...(page.Versions ?? []), ...(page.DeleteMarkers ?? [])].map((v) => ({ Key: v.Key!, VersionId: v.VersionId }));
    if (!config.s3.objectLock) {
      const keep = await Promise.all((page.Versions ?? []).map((v) => retained(v.Key!, v.VersionId, now)));
      const held = new Set((page.Versions ?? []).filter((_, i) => keep[i]).map((v) => JSON.stringify([v.Key, v.VersionId])));
      locked += held.size;
      objects = objects.filter((o) => !held.has(JSON.stringify([o.Key, o.VersionId])));
    }
    if (objects.length) {
      const res = await s3.send(new DeleteObjectsCommand({ Bucket: config.s3.bucket, Delete: { Objects: objects, Quiet: true } }));
      locked += res.Errors?.length ?? 0;
      deleted += objects.length - (res.Errors?.length ?? 0);
    }
    keyMarker = page.IsTruncated ? page.NextKeyMarker : undefined;
    versionMarker = page.IsTruncated ? page.NextVersionIdMarker : undefined;
  } while (keyMarker);
  return { deleted, locked };
}

export async function getObject(key: string): Promise<Buffer> {
  if (config.storageDriver === 'database') {
    const row = await prisma.storedObject.findUnique({ where: { key }, select: { data: true } });
    if (!row) throw Object.assign(new Error(`No such object: ${key}`), { name: 'NoSuchKey' });
    return Buffer.from(row.data);
  }
  const res = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}
