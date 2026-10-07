import { defineConfig, devices } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';
import { E2E_DATABASE_URL } from './src/support/database-url.ts';

const API_PORT = 3100;
const WEB_PORT = 4300;

/**
 * Every value the API needs, passed directly rather than through a file.
 * `@nestjs/config` leaves an existing `process.env` entry alone, so these
 * win over whatever `.env` sits in the API's working directory — which is
 * the point: an end-to-end run must never reach the development database.
 *
 * The secret is a test fixture, not a credential. It guards nothing but a
 * throwaway local database, and it is long enough to satisfy the schema's
 * 32-character floor.
 */
const apiEnv = {
  NODE_ENV: 'test',
  PORT: String(API_PORT),
  DATABASE_URL: E2E_DATABASE_URL,
  DB_SSL: 'false',
  JWT_ACCESS_SECRET: 'playwright-e2e-only-not-a-real-secret-0123456789',
  JWT_ACCESS_TTL: '15m',
  REFRESH_TTL_DAYS: '30',
  BCRYPT_COST: '10',
  WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
  APP_TIMEZONE: 'UTC',
};

/**
 * There is deliberately no Playwright `globalSetup` here. Playwright runs
 * every `webServer` entry's setup (spawn the process, poll its URL until
 * ready) *before* `globalSetup` — plugin setup precedes
 * `config.globalSetups` in Playwright's own task list, confirmed by
 * running this harness and watching the API retry a connection to a
 * database that did not exist yet while global setup sat waiting for that
 * same API to become healthy. Wiring the database bootstrap through
 * `globalSetup` deadlocks for exactly that reason.
 *
 * The bootstrap (`global-setup.ts`, run through `bootstrap-db.ts`) instead
 * runs as the Nx target `e2e-db-setup`, which `web-e2e`'s `e2e` target
 * depends on in `project.json` — so the database exists and is migrated
 * before Nx ever invokes `playwright test`, and in turn before either
 * `webServer` entry below starts.
 */
export default defineConfig({
  testDir: './src',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env['CI'],
  retries: process.env['CI'] ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx nx run api:serve:development',
      url: `http://localhost:${API_PORT}/api/health`,
      cwd: workspaceRoot,
      // Never reuse. A server already listening on this port is not one
      // this config started, so its database and secrets are unknown.
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: apiEnv,
    },
    {
      command: `npx nx run web:serve --port=${WEB_PORT} --proxy-config=apps/web/proxy.e2e.conf.json`,
      url: `http://localhost:${WEB_PORT}`,
      cwd: workspaceRoot,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
