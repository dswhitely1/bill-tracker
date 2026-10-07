import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { workspaceRoot } from '@nx/devkit';
import { DataSource } from 'typeorm';

/**
 * Creates the end-to-end database if it is absent and brings it up to the
 * current migration.
 *
 * It is deliberately a **different database** from the `bills_test` one
 * `nx test-e2e api` truncates between its own tests. Sharing it would let
 * either suite delete the other's fixtures mid-run, and the failure would
 * look like a product bug rather than a harness collision.
 *
 * Nothing here drops a database or a volume. The database is created once
 * and reused; journeys isolate themselves by registering unique accounts,
 * so no run destroys another run's data.
 *
 * This function is invoked by `bootstrap-db.ts`, run as the `e2e-db-setup`
 * Nx target that `e2e` depends on — **not** through Playwright's own
 * `globalSetup` config field. See `bootstrap-db.ts` for why: Playwright
 * starts every `webServer` before running `globalSetup`, so wiring this
 * through that field would deadlock against the API server it is
 * supposed to prepare the database for.
 *
 * `url` is a parameter rather than an environment variable this function
 * reads for itself: `bootstrap-db.ts` and `playwright.config.ts` both
 * import the one constant in `support/database-url.ts`, and threading it
 * through as a parameter is what keeps this function from needing its
 * own copy of that string or its own env-var plumbing.
 */
export default async function globalSetup(url: string): Promise<void> {
  const target = new URL(url);
  const databaseName = target.pathname.slice(1);

  const adminUrl = new URL(target.toString());
  adminUrl.pathname = '/postgres';

  const admin = new DataSource({ type: 'postgres', url: adminUrl.toString() });
  await admin.initialize();
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    databaseName,
  ]);
  if (existing.length === 0) {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  }
  await admin.destroy();

  // Migrations run through the workspace's own script rather than by
  // importing the API's data source. A cross-project `.js` specifier
  // resolves to a `.ts` file under Vitest but not reliably under
  // Playwright's loader, and `npm run migration:run` is a path the
  // repository already exercises. `data-source.ts` reads
  // `process.env.DATABASE_URL` directly, and dotenv leaves an existing
  // value alone, so this override is what it sees.
  execFileSync('npm', ['run', 'migration:run'], {
    cwd: workspaceRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
