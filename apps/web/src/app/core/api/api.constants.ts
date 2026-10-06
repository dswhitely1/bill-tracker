/**
 * Every API path is relative. In development the dev server proxies `/api`
 * to port 3000 (`proxy.conf.json`), which keeps the browser on one origin
 * and therefore keeps the refresh cookie first-party — the condition
 * foundation spec §7 relies on when it chooses `SameSite=Lax`.
 */
export const API_BASE = '/api';
