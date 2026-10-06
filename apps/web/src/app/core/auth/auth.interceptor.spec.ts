import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authInterceptor } from './auth.interceptor';
import { SKIP_AUTH_RETRY } from './auth.tokens';
import { SessionService } from './session.service';

let http: HttpTestingController;
let client: HttpClient;
let session: SessionService;
let router: Router;

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada',
  notifyEmail: true,
  notifyInApp: true,
};

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
    ],
  });
  http = TestBed.inject(HttpTestingController);
  client = TestBed.inject(HttpClient);
  session = TestBed.inject(SessionService);
  router = TestBed.inject(Router);
});

afterEach(() => {
  http.verify();
  vi.restoreAllMocks();
});

function apiRequests() {
  return http.match((request) => !request.url.includes('/api/auth/'));
}

describe('outbound decoration', () => {
  it('attaches the bearer token to an API request', () => {
    session.signIn({ accessToken: 'token-1', user: profile });
    client.get('/api/bills').subscribe();

    const req = http.expectOne('/api/bills');
    expect(req.request.headers.get('Authorization')).toBe('Bearer token-1');
    req.flush([]);
  });

  it('sends credentials on API requests, so the refresh cookie travels', () => {
    client.get('/api/bills').subscribe();

    const req = http.expectOne('/api/bills');
    expect(req.request.withCredentials).toBe(true);
    req.flush([]);
  });

  it('attaches no Authorization header when there is no token', () => {
    client.get('/api/bills').subscribe();

    const req = http.expectOne('/api/bills');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush([]);
  });

  it('leaves a non-API request completely alone', () => {
    // Attaching a bearer token to a third-party request leaks it.
    session.signIn({ accessToken: 'token-1', user: profile });
    client.get('/assets/config.json').subscribe();

    const req = http.expectOne('/assets/config.json');
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(req.request.withCredentials).toBe(false);
    req.flush({});
  });
});

describe('the 401 path', () => {
  it('refreshes once for several simultaneous 401s, then retries each with the new token', () => {
    session.signIn({ accessToken: 'stale', user: profile });
    const results: unknown[] = [];

    client.get('/api/bills').subscribe((r) => results.push(r));
    client.get('/api/categories').subscribe((r) => results.push(r));
    client.get('/api/bill-instances').subscribe((r) => results.push(r));

    const first = apiRequests();
    expect(first).toHaveLength(3);
    for (const request of first) {
      request.flush(null, { status: 401, statusText: 'Unauthorized' });
    }

    // The assertion this whole design exists for.
    const refreshes = http.match('/api/auth/refresh');
    expect(refreshes).toHaveLength(1);
    refreshes[0].flush({ accessToken: 'fresh' });

    const retries = apiRequests();
    expect(retries).toHaveLength(3);
    for (const request of retries) {
      expect(request.request.headers.get('Authorization')).toBe('Bearer fresh');
      request.flush({ ok: true });
    }

    expect(results).toHaveLength(3);
  });

  it('does not refresh when a request fails with something other than 401', () => {
    session.signIn({ accessToken: 'token-1', user: profile });
    const errors: unknown[] = [];
    client.get('/api/bills').subscribe({ error: (e) => errors.push(e) });

    http.expectOne('/api/bills').flush(null, { status: 500, statusText: 'Server Error' });

    expect(http.match('/api/auth/refresh')).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it('surfaces the error instead of refreshing again when the retry also fails with 401', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    session.signIn({ accessToken: 'stale', user: profile });
    const errors: unknown[] = [];
    client.get('/api/bills').subscribe({ error: (e) => errors.push(e) });

    http.expectOne('/api/bills').flush(null, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/auth/refresh').flush({ accessToken: 'fresh' });
    http.expectOne('/api/bills').flush(null, { status: 401, statusText: 'Unauthorized' });

    // Exactly one refresh, and the second failure reaches the caller.
    expect(http.match('/api/auth/refresh')).toHaveLength(0);
    expect(errors).toHaveLength(1);
    // The retried request's own failure must not be treated as a refresh
    // failure: the refresh succeeded. Signing the user out here is the
    // regression that moving catchError after switchMap would introduce.
    expect(session.isAuthenticated()).toBe(true);
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('exemptions', () => {
  it.each([
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/refresh',
    '/api/auth/logout',
  ])('does not refresh when %s fails with 401', (url) => {
    const errors: unknown[] = [];
    client.post(url, {}).subscribe({ error: (e) => errors.push(e) });

    http.expectOne(url).flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(http.match('/api/auth/refresh')).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it('does not refresh a request that opted out through SKIP_AUTH_RETRY', () => {
    const errors: unknown[] = [];
    client
      .get('/api/users/me', { context: new HttpContext().set(SKIP_AUTH_RETRY, true) })
      .subscribe({ error: (e) => errors.push(e) });

    http.expectOne('/api/users/me').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(http.match('/api/auth/refresh')).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });
});

describe('a refresh that fails mid-session', () => {
  it('clears the session, navigates to the login screen, and fails the waiting request', () => {
    // Review Focus 1. The user is on a screen, the refresh token has been
    // revoked, and nothing about the happy path covers what they see next.
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    session.signIn({ accessToken: 'stale', user: profile });

    const errors: unknown[] = [];
    client.get('/api/bills').subscribe({ error: (e) => errors.push(e) });

    http.expectOne('/api/bills').flush(null, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(session.isAuthenticated()).toBe(false);
    expect(session.accessToken()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { reason: 'expired' } });
    expect(errors).toHaveLength(1);
  });

  it('navigates once even when several requests were waiting on the same refresh', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    session.signIn({ accessToken: 'stale', user: profile });

    const errors: unknown[] = [];
    client.get('/api/bills').subscribe({ error: (e) => errors.push(e) });
    client.get('/api/categories').subscribe({ error: (e) => errors.push(e) });

    for (const request of apiRequests()) {
      request.flush(null, { status: 401, statusText: 'Unauthorized' });
    }
    http.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(errors).toHaveLength(2);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
