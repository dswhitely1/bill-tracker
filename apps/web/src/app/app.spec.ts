import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from './app';
import { routes } from './app.routes';
import { SessionService } from './core/auth/session.service';

let http: HttpTestingController;

/** Signs a session in so navigation into the guarded area is admitted. */
function signIn(): void {
  TestBed.inject(SessionService).signIn({
    accessToken: 'token-1',
    user: { id: 'user-1', email: 'a@b.c', name: 'Ada', notifyEmail: true, notifyInApp: true },
  });
}

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter(routes),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  http.verify();
});

describe('routing', () => {
  it('renders the not-found screen for an unknown path', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/nonsense');
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('That page does not exist');
  });

  it('shows the login screen without a guard redirect loop', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/login');
    await fixture.whenStable();

    expect(router.url).toBe('/login');
    expect(fixture.nativeElement.textContent).toContain('Sign in');
  });

  it('shows the register screen', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/register');
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Create an account');
  });
});

describe('the guarded area', () => {
  it('sends an anonymous visitor to the login screen', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/categories');
    await fixture.whenStable();

    expect(router.url).toContain('/login');
  });

  it('carries the attempted path so they land where they were going', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/categories');
    await fixture.whenStable();

    expect(decodeURIComponent(router.url)).toContain('returnUrl=/categories');
  });
});

/**
 * The shell that wraps every signed-in route mounts the toolbar bell,
 * which fetches `/api/notifications` on construction. All four of these
 * tests route into the shell, so each opens that request in addition to
 * whatever its own page fetches.
 */
const flushBell = () => {
  http.expectOne('/api/notifications').flush({ items: [], unreadCount: 0, truncated: false });
};

describe('the landing screen', () => {
  it('redirects the bare origin to the dashboard', async () => {
    signIn();
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/');
    await fixture.whenStable();
    flushBell();
    http.expectOne('/api/summary').flush({
      asOf: '2026-10-07',
      overdue: { count: 0, amount: 0, earliestDueDate: null },
      thisMonth: { count: 0, total: 0, paid: 0 },
      next7Days: { count: 0, amount: 0 },
      byCategory: [],
    });
    await fixture.whenStable();
    await fixture.whenStable();

    expect(router.url).toBe('/dashboard');
  });

  it('mounts the dashboard at /dashboard', async () => {
    signIn();
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/dashboard');
    await fixture.whenStable();
    flushBell();
    http.expectOne('/api/summary').flush({
      asOf: '2026-10-07',
      overdue: { count: 0, amount: 0, earliestDueDate: null },
      thisMonth: { count: 0, total: 0, paid: 0 },
      next7Days: { count: 0, amount: 0 },
      byCategory: [],
    });
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('h1')?.textContent?.trim()).toBe('Dashboard');
  });

  it('mounts the calendar at /calendar', async () => {
    signIn();
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/calendar');
    await fixture.whenStable();
    flushBell();
    http.expectOne((req) => req.url === '/api/bill-instances').flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[aria-label="Previous month"]')).not.toBeNull();
  });

  it('mounts the reminders screen at /notifications', async () => {
    signIn();
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/notifications');
    await fixture.whenStable();
    // The bell and the reminders page both construct here and both call
    // `NotificationsStore.load()`. `load()` only skips a refetch once the
    // first one has *resolved* — it has no in-flight guard — so both
    // calls land before either response arrives and two requests go out
    // against the one shared store instance.
    for (const req of http.match('/api/notifications')) {
      req.flush({ items: [], unreadCount: 0, truncated: false });
    }
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('h1')?.textContent?.trim()).toBe('Reminders');
  });
});
