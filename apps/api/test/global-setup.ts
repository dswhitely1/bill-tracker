import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config as loadEnv } from 'dotenv';

export default async function globalSetup() {
  const result = loadEnv({ path: '.env.test', override: true, quiet: true });
  if (result.error) {
    throw new Error(
      'Failed to load apps/api/.env.test ' +
        `(${result.error.message}). dotenv does not throw on a ` +
        "missing file, so this almost certainly means the process's cwd " +
        "isn't apps/api — run this suite via `nx test-e2e api` from the " +
        'workspace root, which sets that cwd for you.',
    );
  }

  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error(
      'DATABASE_URL is not set. Expected apps/api/.env.test to define it — ' +
        'without it the e2e suite has no database to create.',
    );
  }
  const url = new URL(rawUrl);
  const testDbName = url.pathname.slice(1);

  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';

  const admin = new DataSource({ type: 'postgres', url: adminUrl.toString() });
  await admin.initialize();
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [testDbName]);
  if (existing.length === 0) {
    await admin.query(`CREATE DATABASE "${testDbName}"`);
  }
  await admin.destroy();

  process.env.ENV_FILE = '.env.test';
  const { AppDataSource } = await import('../src/database/data-source.js');
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  await AppDataSource.destroy();
}
