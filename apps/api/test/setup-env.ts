import { config as loadEnv } from 'dotenv';

// Runs inside every Vitest worker, before any application import.
// globalSetup runs in a separate process, so its process.env never reaches here.
process.env.ENV_FILE = '.env.test';
const result = loadEnv({ path: '.env.test', override: true, quiet: true });
if (result.error) {
  // dotenv does not throw on a missing file — it returns { error } and
  // `quiet: true` even suppresses the log — so a bad cwd would otherwise
  // silently leave DATABASE_URL (and everything else) at whatever the
  // shell exports, and the suite would run against it instead of failing.
  throw new Error(
    'Failed to load apps/api/.env.test ' +
      `(${result.error.message}). This almost certainly means ` +
      "the process's cwd isn't apps/api — run this suite via " +
      '`nx test-e2e api` from the workspace root, which sets that cwd for you.',
  );
}
