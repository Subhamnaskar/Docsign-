import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { config } from '../config.js';

const s3 = new S3Client({
  endpoint: config.s3.endpoint,
  region: config.s3.region,
  forcePathStyle: true,
  credentials: { accessKeyId: config.s3.accessKeyId, secretAccessKey: config.s3.secretAccessKey },
});

/** Creates the bucket with Object Lock enabled so sealed documents can be stored write-once. */
export async function ensureBucket(): Promise<void> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: config.s3.bucket }));
  } catch {
    await s3.send(
      new CreateBucketCommand({ Bucket: config.s3.bucket, ObjectLockEnabledForBucket: true }),
    );
  }
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
  retainYears?: number,
): Promise<void> {
  const retention = retainYears
    ? {
        // GOVERNANCE mode: write-once for normal users; privileged admins can
        // still lift it (use COMPLIANCE in production cells).
        ObjectLockMode: 'GOVERNANCE' as const,
        ObjectLockRetainUntilDate: new Date(Date.now() + retainYears * 365 * 24 * 3600 * 1000),
      }
    : {};
  await s3.send(
    new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      ...retention,
    }),
  );
}

export async function getObject(key: string): Promise<Buffer> {
  const res = await s3.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: key }));
  return Buffer.from(await res.Body!.transformToByteArray());
}
