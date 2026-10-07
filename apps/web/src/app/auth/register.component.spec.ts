import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { RegisterComponent } from './register.component';

let http: HttpTestingController;
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
    imports: [RegisterComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  router = TestBed.inject(Router);
});

afterEach(() => {
  http.verify();
  vi.restoreAllMocks();
});

describe('RegisterComponent', () => {
  it('requires a password of at least eight characters', async () => {
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.componentInstance.form.setValue({ email: 'a@b.c', name: 'Ada', password: 'short' });
    await fixture.whenStable();

    expect(fixture.componentInstance.form.controls.password.errors).toMatchObject({
      minlength: expect.anything(),
    });
  });

  it('rejects a password over 72 bytes before it reaches the server', async () => {
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.componentInstance.form.setValue({
      email: 'a@b.c',
      name: 'Ada',
      password: '😀'.repeat(25),
    });
    await fixture.whenStable();

    expect(fixture.componentInstance.form.controls.password.errors).toMatchObject({
      maxBytes: expect.anything(),
    });

    fixture.componentInstance.submit();
    expect(http.match('/api/auth/register')).toHaveLength(0);
  });

  it('registers and signs the session in', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.componentInstance.form.setValue({
      email: 'a@b.c',
      name: 'Ada',
      password: 'hunter22',
    });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    const req = http.expectOne('/api/auth/register');
    expect(req.request.body).toEqual({ email: 'a@b.c', name: 'Ada', password: 'hunter22' });
    req.flush({ accessToken: 'token-1', user: profile });
    await fixture.whenStable();

    expect(TestBed.inject(SessionService).isAuthenticated()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/upcoming');
  });

  it('shows a duplicate-email 409 in the banner', async () => {
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.componentInstance.form.setValue({
      email: 'taken@b.c',
      name: 'Ada',
      password: 'hunter22',
    });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    http
      .expectOne('/api/auth/register')
      .flush({ message: 'Email already registered' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Email already registered');
  });
});
