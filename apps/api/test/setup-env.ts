import { config as loadEnv } from 'dotenv';

// Runs inside every Vitest worker, before any application import.
// globalSetup runs in a separate process, so its process.env never reaches here.
process.env.ENV_FILE = '.env.test';
loadEnv({ path: '.env.test', override: true, quiet: true });
