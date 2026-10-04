import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config as loadEnv } from 'dotenv';

export default async function globalSetup() {
  loadEnv({ path: '.env.test', override: true });

  const url = new URL(process.env.DATABASE_URL as string);
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
  const { AppDataSource } = await import('../src/database/data-source');
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  await AppDataSource.destroy();
}
