import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { ShellComponent } from './shell.component';

let http: HttpTestingController;
let session: SessionService;
let router: Router;

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada Lovelace',
  notifyEmail: true,
  notifyInApp: true,
};

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [ShellComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  session = TestBed.inject(SessionService);
  router = TestBed.inject(Router);
  session.signIn({ accessToken: 'token-1', user: profile });
});

afterEach(() => {
  http.verify();
  vi.restoreAllMocks();
});

// The bell fetches on construction, so every ShellComponent fixture opens
// one outstanding `/api/notifications` request that `http.verify()` would
// otherwise fail on.
const flushNotifications = () => {
  http.expectOne('/api/notifications').flush({ items: [], unreadCount: 0, truncated: false });
};

describe('ShellComponent', () => {
  it('names the signed-in user', async () => {
    const fixture = TestBed.createComponent(ShellComponent);
    flushNotifications();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Ada Lovelace');
  });

  it('links to every section', async () => {
    const fixture = TestBed.createComponent(ShellComponent);
    flushNotifications();
    await fixture.whenStable();

    const hrefs = [...fixture.nativeElement.querySelectorAll('a[href]')].map((a: HTMLAnchorElement) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toEqual(
      expect.arrayContaining(['/dashboard', '/calendar', '/upcoming', '/bills', '/categories', '/settings']),
    );
  });

  it('signs out and returns to the login screen', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ShellComponent);
    flushNotifications();
    await fixture.whenStable();

    fixture.nativeElement.querySelector('[data-testid="sign-out"]').click();
    http.expectOne('/api/auth/logout').flush(null);
    await fixture.whenStable();

    expect(session.isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('puts the bell in the toolbar, ahead of sign out', async () => {
    const fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
    flushNotifications();
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();

    const bell = fixture.nativeElement.querySelector('app-notification-bell');
    const signOut = fixture.nativeElement.querySelector('[data-testid="sign-out"]');
    expect(bell).not.toBeNull();
    // A reminder the user has to navigate to is a reminder they will miss,
    // so it belongs in the chrome that is always on screen.
    expect(bell.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
