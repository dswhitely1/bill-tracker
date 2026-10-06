import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { SettingsComponent } from './settings.component';

let http: HttpTestingController;
let session: SessionService;
let router: Router;

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada',
  notifyEmail: true,
  notifyInApp: false,
};

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [SettingsComponent],
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

describe('the profile form', () => {
  it('starts from the signed-in user', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    expect(fixture.componentInstance.profileForm.getRawValue()).toEqual({
      name: 'Ada',
      notifyEmail: true,
      notifyInApp: false,
    });
  });

  it('saves and refreshes the session user', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    fixture.componentInstance.profileForm.patchValue({ name: 'Ada Lovelace' });
    fixture.componentInstance.saveProfile();

    const req = http.expectOne('/api/users/me');
    expect(req.request.method).toBe('PATCH');
    req.flush({ ...profile, name: 'Ada Lovelace' });
    await fixture.whenStable();
    // Twice: the store resumes its `load()` one microtask after
    // `flush()` returns, because `firstValueFrom` wraps the
    // response in a native promise. The first `whenStable()` can
    // settle before that continuation runs; the second observes
    // the render it produced.
    await fixture.whenStable();

    expect(session.user()?.name).toBe('Ada Lovelace');
  });

  it('attaches a server field error to its control', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    fixture.componentInstance.profileForm.patchValue({ name: 'A' });
    fixture.componentInstance.saveProfile();

    http.expectOne('/api/users/me').flush(
      { message: ['name is too short'], errors: { name: ['name is too short'] } },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(fixture.componentInstance.profileForm.controls.name.errors).toMatchObject({
      server: 'name is too short',
    });
  });
});

describe('the password form', () => {
  it('rejects a new password over 72 bytes before sending', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    fixture.componentInstance.passwordForm.setValue({
      currentPassword: 'hunter22',
      newPassword: '😀'.repeat(25),
    });
    fixture.componentInstance.changePassword();

    expect(http.match('/api/users/me/password')).toHaveLength(0);
  });

  it('signs out and sends the person to the login screen on success', async () => {
    // Changing a password revokes every refresh token. Leaving the
    // session alive means it dies fifteen minutes later with no
    // explanation; signing out now is the honest version of what already
    // happened.
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    fixture.componentInstance.passwordForm.setValue({
      currentPassword: 'hunter22',
      newPassword: 'hunter33x',
    });
    const done = fixture.componentInstance.changePassword();

    http.expectOne('/api/users/me/password').flush(null);
    // `changePassword` resumes past its first `await` one microtask after
    // `flush()` returns, and only then calls `session.signOut()`, whose
    // own `await firstValueFrom(...)` is what dispatches the logout
    // request. Without a yield here, `expectOne('/api/auth/logout')` runs
    // before that microtask has had a chance to fire.
    await fixture.whenStable();
    http.expectOne('/api/auth/logout').flush(null);
    await done;

    expect(session.isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('keeps the session when the current password is wrong', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    fixture.componentInstance.passwordForm.setValue({
      currentPassword: 'wrong-one',
      newPassword: 'hunter33x',
    });
    const done = fixture.componentInstance.changePassword();

    http
      .expectOne('/api/users/me/password')
      .flush({ message: 'Current password is incorrect' }, { status: 401, statusText: 'Unauthorized' });
    await done;
    await fixture.whenStable();
    await fixture.whenStable();

    expect(session.isAuthenticated()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Current password is incorrect');
  });
});
