import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, runInInjectionContext, Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { authGuard, guestGuard } from './auth.guard';
import { SessionService } from './session.service';

let injector: Injector;
let session: SessionService;

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada',
  notifyEmail: true,
  notifyInApp: true,
};

function stateFor(url: string): RouterStateSnapshot {
  return { url } as RouterStateSnapshot;
}

const route = {} as ActivatedRouteSnapshot;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  injector = TestBed.inject(Injector);
  session = TestBed.inject(SessionService);
});

describe('authGuard', () => {
  it('admits an authenticated visitor', () => {
    session.signIn({ accessToken: 'token-1', user: profile });

    const result = runInInjectionContext(injector, () => authGuard(route, stateFor('/bills')));

    expect(result).toBe(true);
  });

  it('redirects an anonymous visitor to the login screen', () => {
    const result = runInInjectionContext(injector, () => authGuard(route, stateFor('/bills')));

    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toContain('/login');
  });

  it('carries the attempted URL so the visitor lands where they were going', () => {
    const result = runInInjectionContext(injector, () =>
      authGuard(route, stateFor('/bills/abc-123')),
    ) as UrlTree;

    expect(result.queryParams['returnUrl']).toBe('/bills/abc-123');
  });
});

describe('guestGuard', () => {
  it('admits an anonymous visitor', () => {
    const result = runInInjectionContext(injector, () => guestGuard(route, stateFor('/login')));

    expect(result).toBe(true);
  });

  it('redirects a signed-in visitor away from the login screen', () => {
    // A bookmarked /login should not present a sign-in form to someone who
    // is already signed in.
    session.signIn({ accessToken: 'token-1', user: profile });

    const result = runInInjectionContext(injector, () => guestGuard(route, stateFor('/login')));

    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toContain('/upcoming');
  });
});
