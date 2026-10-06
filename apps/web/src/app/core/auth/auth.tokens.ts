import { HttpContextToken } from '@angular/common/http';

/**
 * Opts a request out of the interceptor's refresh-and-retry.
 *
 * This is **not** what prevents a retry loop — see
 * `auth.interceptor.ts`, where the structure of `catchError` does that. It
 * exists for one caller: `SessionService.restore()` sets it on its
 * `GET /api/users/me` so that a 401 during boot resolves the session as
 * anonymous instead of starting a second refresh behind the app
 * initializer's back.
 *
 * `HttpContext` is mutable and shared across `clone()`, so the flag
 * survives the interceptor's own cloning, which is the behaviour wanted.
 */
export const SKIP_AUTH_RETRY = new HttpContextToken<boolean>(() => false);
