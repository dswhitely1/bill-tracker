import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
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

describe('ShellComponent', () => {
  it('names the signed-in user', async () => {
    const fixture = TestBed.createComponent(ShellComponent);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Ada Lovelace');
  });

  it('links to every section', async () => {
    const fixture = TestBed.createComponent(ShellComponent);
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
    await fixture.whenStable();

    fixture.nativeElement.querySelector('[data-testid="sign-out"]').click();
    http.expectOne('/api/auth/logout').flush(null);
    await fixture.whenStable();

    expect(session.isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});
