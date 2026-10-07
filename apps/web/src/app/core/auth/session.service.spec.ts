import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SKIP_AUTH_RETRY } from './auth.tokens';
import { SessionService } from './session.service';

let http: HttpTestingController;
let session: SessionService;

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
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  http = TestBed.inject(HttpTestingController);
  session = TestBed.inject(SessionService);
});

afterEach(() => {
  http.verify();
});

describe('initial state', () => {
  it('starts anonymous with no token', () => {
    expect(session.isAuthenticated()).toBe(false);
    expect(session.user()).toBeNull();
    expect(session.accessToken()).toBeNull();
  });
});

describe('signIn', () => {
  it('records the token and the user', () => {
    session.signIn({ accessToken: 'token-1', user: profile });

    expect(session.accessToken()).toBe('token-1');
    expect(session.user()).toEqual(profile);
    expect(session.isAuthenticated()).toBe(true);
  });
});

describe('setUser', () => {
  it('replaces the profile and leaves the token alone', () => {
    session.signIn({ accessToken: 'token-1', user: profile });

    session.setUser({ ...profile, name: 'Ada Lovelace' });

    expect(session.user()?.name).toBe('Ada Lovelace');
    expect(session.accessToken()).toBe('token-1');
  });

  it('does not discard an in-flight refresh', () => {
    // Saving a profile is not a sign-in. Routing it through signIn would
    // reset the single-flight state and let a second refresh go out.
    session.signIn({ accessToken: 'token-1', user: profile });
    session.refresh().subscribe({ error: () => undefined });

    session.setUser({ ...profile, name: 'Ada Lovelace' });
    session.refresh().subscribe({ error: () => undefined });

    expect(http.match('/api/auth/refresh')).toHaveLength(1);
    http.match('/api/auth/refresh').forEach((r) => r.flush({ accessToken: 'token-2' }));
  });
});

describe('restore', () => {
  it('refreshes, then reads the profile, and ends authenticated', async () => {
    const restored = session.restore();

    http.expectOne('/api/auth/refresh').flush({ accessToken: 'token-1' });
    const me = http.expectOne('/api/users/me');
    me.flush(profile);

    await restored;

    expect(session.accessToken()).toBe('token-1');
    expect(session.user()).toEqual(profile);
  });

  it('sets the retry-exempt flag on its profile read', async () => {
    // The interceptor's own suite proves a 401 here cannot start a second
    // refresh; this pins that `restore()` actually sets the flag it
    // depends on.
    const restored = session.restore();

    http.expectOne('/api/auth/refresh').flush({ accessToken: 'token-1' });
    const me = http.expectOne('/api/users/me');
    expect(me.request.context.get(SKIP_AUTH_RETRY)).toBe(true);
    me.flush(profile);

    await restored;
  });

  it('resolves anonymous when the refresh is rejected, and does not reject', async () => {
    // A 401 here is the ordinary state of a visitor who is not signed in.
    // A rejected initializer would fail application bootstrap outright.
    const restored = session.restore();

    http.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });

    await expect(restored).resolves.toBeUndefined();
    expect(session.isAuthenticated()).toBe(false);
    expect(session.accessToken()).toBeNull();
  });

  it('resolves anonymous when the profile read fails after a successful refresh', async () => {
    const restored = session.restore();

    http.expectOne('/api/auth/refresh').flush({ accessToken: 'token-1' });
    http.expectOne('/api/users/me').flush(null, { status: 500, statusText: 'Server Error' });

    await expect(restored).resolves.toBeUndefined();
    // Half a session is not a session: a token with no user would render a
    // shell with no name and no way to recover.
    expect(session.isAuthenticated()).toBe(false);
    expect(session.accessToken()).toBeNull();
  });
});

describe('refresh', () => {
  it('issues one request for several concurrent callers and gives them all the same token', async () => {
    const tokens: string[] = [];
    session.refresh().subscribe((t) => tokens.push(t));
    session.refresh().subscribe((t) => tokens.push(t));
    session.refresh().subscribe((t) => tokens.push(t));

    const requests = http.match('/api/auth/refresh');
    expect(requests).toHaveLength(1);
    requests[0].flush({ accessToken: 'token-2' });

    expect(tokens).toEqual(['token-2', 'token-2', 'token-2']);
    expect(session.accessToken()).toBe('token-2');
  });

  it('starts a fresh request once the previous one has settled', () => {
    session.refresh().subscribe();
    http.expectOne('/api/auth/refresh').flush({ accessToken: 'token-2' });

    session.refresh().subscribe();
    http.expectOne('/api/auth/refresh').flush({ accessToken: 'token-3' });

    expect(session.accessToken()).toBe('token-3');
  });

  it('propagates the failure to every waiting caller', () => {
    const errors: unknown[] = [];
    session.refresh().subscribe({ error: (e) => errors.push(e) });
    session.refresh().subscribe({ error: (e) => errors.push(e) });

    http.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(errors).toHaveLength(2);
  });

  it('does not let a settled refresh clear a newer one started after a sign-out', () => {
    session.signIn({ accessToken: 'token-1', user: profile });
    const first = session.refresh();
    first.subscribe({ error: () => undefined });
    const a = http.expectOne('/api/auth/refresh');

    session.clear();
    session.signIn({ accessToken: 'token-2', user: profile });

    const second = session.refresh();
    second.subscribe({ error: () => undefined });
    const b = http.expectOne('/api/auth/refresh');
    expect(second).not.toBe(first);

    a.flush({ accessToken: 'stale' });

    // The superseded cycle must not null the live one, and its token must
    // not reach the session that replaced it.
    expect(session.refresh()).toBe(second);
    expect(session.accessToken()).toBe('token-2');

    b.flush({ accessToken: 'token-3' });
    expect(session.accessToken()).toBe('token-3');
  });
});

describe('clear and signOut', () => {
  it('clear drops the token and the user', () => {
    session.signIn({ accessToken: 'token-1', user: profile });
    session.clear();

    expect(session.isAuthenticated()).toBe(false);
    expect(session.accessToken()).toBeNull();
  });

  it('signOut calls the API and then clears', async () => {
    session.signIn({ accessToken: 'token-1', user: profile });
    const done = session.signOut();

    http.expectOne('/api/auth/logout').flush(null);
    await done;

    expect(session.isAuthenticated()).toBe(false);
  });

  it('signOut clears even when the API call fails', async () => {
    // The session is ending regardless. Leaving a user signed in because
    // the server could not be reached is the wrong failure.
    session.signIn({ accessToken: 'token-1', user: profile });
    const done = session.signOut();

    http.expectOne('/api/auth/logout').flush(null, { status: 500, statusText: 'Server Error' });
    await expect(done).resolves.toBeUndefined();

    expect(session.isAuthenticated()).toBe(false);
  });
});
