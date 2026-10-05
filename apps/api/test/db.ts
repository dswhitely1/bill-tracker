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
  // Guard the destructive helper itself rather than relying on caller
  // discipline: .env.test is loaded relative to process.cwd(), which is
  // apps/api only because the test-e2e target sets that cwd. dotenv does
  // not throw on a missing file, so running from the wrong directory (or
  // in a CI job that doesn't replicate that cwd) could leave DATABASE_URL
  // at whatever the shell exports and truncate a real database. Derive
  // the connected database's name from the DataSource itself — never from
  // process.env, which is exactly what could be wrong.
  const dbName = dataSource.driver.database;
  if (!dbName || !dbName.endsWith('_test')) {
    throw new Error(
      `truncateAll() refused to run: connected database is "${dbName ?? '(unknown)'}", ` +
        'which does not end in "_test". This almost always means DATABASE_URL ' +
        "isn't pointing at the dedicated test database — run the suite via " +
        '`nx test-e2e api` from the workspace root rather than from apps/api ' +
        'directly, and check for a DATABASE_URL already exported in the shell.',
    );
  }

  await dataSource.query(
    'TRUNCATE TABLE "payment_logs", "bill_instances", "bills", "refresh_tokens", ' +
      '"categories", "users" RESTART IDENTITY CASCADE',
  );
}
