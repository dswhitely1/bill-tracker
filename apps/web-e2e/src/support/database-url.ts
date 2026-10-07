/**
 * The single source of truth for the end-to-end database's connection
 * string.
 *
 * `playwright.config.ts` (for the API server it starts) and
 * `bootstrap-db.ts` (for the database that server needs to exist before
 * it starts) both import this constant rather than each carrying their
 * own copy — two copies of a connection string drift.
 */
export const E2E_DATABASE_URL = 'postgres://don:super@localhost:5432/bills_web_e2e';
