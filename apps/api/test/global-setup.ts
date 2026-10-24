import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

/** Creates the test database if needed and applies migrations to it. */
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgresql://docsign:docsign@localhost:5432/docsign_test?schema=public');
  const dbName = url.pathname.slice(1);
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new PrismaClient({ datasourceUrl: admin.toString() });
  const exists = await client.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM pg_database WHERE datname = $1`, dbName);
  if (exists.length === 0) await client.$executeRawUnsafe(`CREATE DATABASE "${dbName}"`);
  await client.$disconnect();
  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
}
