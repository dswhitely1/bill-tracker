import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, switchMap, throwError } from 'rxjs';
import { API_BASE } from '../api/api.constants';
import { SKIP_AUTH_RETRY } from './auth.tokens';
import { SessionService } from './session.service';

/**
 * Identifies the last failed refresh this interceptor has already reacted
 * to. `SessionService.refresh()` hands the identical `Observable` instance
 * to every caller for the life of one in-flight cycle, so several requests
 * that all 401 at once each attach their own `catchError` to that same
 * object. Without this check, each of them would independently clear the
 * session and navigate — once per waiting request instead of once per
 * actual failure. A later, genuinely new refresh cycle returns a new
 * instance, so it is free to navigate again.
 */
let lastHandledFailure: Observable<string> | null = null;

/**
 * Refreshing after a rejected sign-in is meaningless, and refreshing after
 * a rejected refresh is a loop. All four auth routes are exempt.
 */
const EXEMPT_PATHS = [
  `${API_BASE}/auth/login`,
  `${API_BASE}/auth/register`,
  `${API_BASE}/auth/refresh`,
  `${API_BASE}/auth/logout`,
];

function isExemptPath(url: string): boolean {
  return EXEMPT_PATHS.some((path) => url === path || url.startsWith(`${path}?`));
}

function withAuth(request: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  return request.clone({
    withCredentials: true,
    setHeaders: token === null ? {} : { Authorization: `Bearer ${token}` },
  });
}

/**
 * Adds the bearer token and credentials to API requests, and turns a 401
 * into a single-flight refresh followed by one retry.
 *
 * **What prevents a retry loop is the shape of this function, not a flag.**
 * The 401 branch lives inside a `catchError` wrapping `next(request)`. The
 * observable it returns is a *replacement*, which `catchError` does not
 * re-catch, and `next` is the downstream handler rather than a re-entry
 * into this interceptor. A retry that fails again therefore propagates to
 * the caller, and no counter is involved.
 *
 * The `catchError` below sits **before** `switchMap` on purpose. Placed
 * after, it would also catch failures of the retried request, so a 500 on
 * the retry would sign the user out.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(API_BASE)) return next(request);

  const session = inject(SessionService);
  const router = inject(Router);
  const authorized = withAuth(request, session.accessToken());

  if (isExemptPath(request.url) || request.context.get(SKIP_AUTH_RETRY)) {
    return next(authorized);
  }

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }

      const refresh$ = session.refresh();
      return refresh$.pipe(
        catchError((refreshError: unknown) => {
          if (lastHandledFailure !== refresh$) {
            lastHandledFailure = refresh$;
            session.clear();
            void router.navigate(['/login'], { queryParams: { reason: 'expired' } });
          }
          return throwError(() => refreshError);
        }),
        switchMap((accessToken) => next(withAuth(request, accessToken))),
      );
    }),
  );
};
