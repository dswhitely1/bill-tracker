import { DataSource } from 'typeorm';

let ds: DataSource | null = null;

export async function getTestDataSource(): Promise<DataSource> {
  if (ds?.isInitialized) return ds;
  process.env.ENV_FILE = '.env.test';
  const { AppDataSource } = await import('../src/database/data-source.js');
  const dataSource = AppDataSource;
  ds = dataSource;
  if (!dataSource.isInitialized) await dataSource.initialize();
  return dataSource;
}

export async function truncateAll(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE "refresh_tokens", "categories", "users" RESTART IDENTITY CASCADE',
  );
}
