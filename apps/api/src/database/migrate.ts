import 'reflect-metadata';
import { AppDataSource } from './data-source';

/**
 * Entry point for the `migrate` compose service.
 *
 * This exists as its own bundle because `main.js`'s entry is the server
 * bootstrap: it starts listening as a side effect of being loaded and
 * exports nothing, so there is no way for a migration runner to reach
 * `AppDataSource` through it.
 *
 * The sequence is the one `apps/api/test/global-setup.ts` already uses
 * against the test database. Running migrations here rather than inside
 * the API's own startup keeps schema changes off the path to accepting
 * traffic and makes the step visible as its own service in
 * `docker compose ps`.
 */
async function migrate(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const applied = await AppDataSource.runMigrations();
    // Named individually rather than counted: on a fresh volume this is the
    // only record of which migrations the stack came up on, and `docker
    // compose logs migrate` is where someone will look when the schema is
    // not what they expected.
    for (const migration of applied) {
      console.log(`applied ${migration.name}`);
    }
    if (applied.length === 0) console.log('schema already up to date');
  } finally {
    await AppDataSource.destroy();
  }
}

migrate().catch((error: unknown) => {
  console.error(error);
  // A non-zero exit is what makes `depends_on: service_completed_successfully`
  // hold the API back. Resolving on failure would start the server against a
  // schema that was never applied.
  process.exitCode = 1;
});
