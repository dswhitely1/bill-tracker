import { DataSource } from 'typeorm';

let ds: DataSource | null = null;

export async function getTestDataSource(): Promise<DataSource> {
  if (ds?.isInitialized) return ds;
  process.env.ENV_FILE = '.env.test';
  const { AppDataSource } = await import('../src/database/data-source');
  ds = AppDataSource;
  if (!ds.isInitialized) await ds.initialize();
  return ds;
}

export async function truncateAll(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE "refresh_tokens", "categories", "users" RESTART IDENTITY CASCADE',
  );
}
