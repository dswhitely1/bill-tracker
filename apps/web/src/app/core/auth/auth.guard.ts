import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/**
 * Both guards read the session synchronously. That is safe not because of
 * provider order — order is irrelevant in an `EnvironmentInjector` — but
 * because `restore()` runs as an `APP_INITIALIZER`, which
 * `ApplicationInitStatus.donePromise` awaits before bootstrap completes,
 * while the router's initial navigation runs afterwards, from an
 * `APP_BOOTSTRAP_LISTENER`. `restore()` has therefore always settled
 * before any guard runs.
 *
 * `withEnabledBlockingInitialNavigation()` would not help and would not be
 * safe to add casually: it registers its own `APP_INITIALIZER`, which
 * would race this one rather than wait for it.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionService);
  const router = inject(Router);

  if (session.isAuthenticated()) return true;
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

export const guestGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);

  return session.isAuthenticated() ? router.createUrlTree(['/upcoming']) : true;
};
