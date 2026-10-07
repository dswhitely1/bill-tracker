import globalSetup from './global-setup.ts';

/**
 * Runs the database bootstrap ahead of `playwright test` itself, as an Nx
 * task dependency rather than through Playwright's `globalSetup` config
 * field.
 *
 * Playwright's own task order runs every `webServer` entry's setup (spawn
 * the process, poll its URL until ready) *before* `globalSetup` — plugin
 * setup precedes `config.globalSetups` in its internal task list. Wiring
 * this bootstrap through `globalSetup` therefore deadlocks: the API
 * server is started first and loops retrying a connection to a database
 * this script hasn't created yet, while this script never runs because
 * Playwright is still waiting on the API's `/api/health` to answer.
 * Running it as a preceding Nx target sidesteps that ordering entirely.
 */
globalSetup().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
