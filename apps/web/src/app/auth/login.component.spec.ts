import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { LoginComponent } from './login.component';

let http: HttpTestingController;
let router: Router;
let queryParams: Record<string, unknown>;

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada',
  notifyEmail: true,
  notifyInApp: true,
};

function configure(params: Record<string, unknown> = {}) {
  queryParams = params;
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParams }, queryParams: of(queryParams) },
      },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  router = TestBed.inject(Router);
}

afterEach(() => {
  http.verify();
  vi.restoreAllMocks();
});

describe('LoginComponent', () => {
  beforeEach(() => configure());

  it('does not submit an empty form', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();

    fixture.componentInstance.submit();

    expect(http.match('/api/auth/login')).toHaveLength(0);
  });

  it('posts the credentials and signs the session in', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.componentInstance.form.setValue({ email: 'a@b.c', password: 'hunter22' });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    http.expectOne('/api/auth/login').flush({ accessToken: 'token-1', user: profile });
    await fixture.whenStable();

    expect(TestBed.inject(SessionService).isAuthenticated()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/upcoming');
  });

  it('renders the required-field message after submitting an empty form', async () => {
    // Regression: field-errors.component is OnPush and reads
    // control.touched/errors directly, neither of which is a signal, so
    // marking all controls touched after the first render used to never
    // repaint. Assert the rendered DOM, not just the control's error map.
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();

    fixture.componentInstance.submit();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Email is required');
    expect(fixture.nativeElement.textContent).toContain('Password is required');
  });

  it('attaches a server validation message to its control', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.componentInstance.form.setValue({ email: 'a@b.c', password: 'hunter22' });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    http.expectOne('/api/auth/login').flush(
      {
        statusCode: 400,
        error: 'Bad Request',
        message: ['email must be an email'],
        errors: { email: ['email must be an email'] },
        path: '/api/auth/login',
        timestamp: '2026-10-06T00:00:00.000Z',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(fixture.componentInstance.form.controls.email.errors).toMatchObject({
      server: 'email must be an email',
    });
  });

  it('shows a 401 in the form banner, since no single field is at fault', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.componentInstance.form.setValue({ email: 'a@b.c', password: 'wrong-one' });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    http
      .expectOne('/api/auth/login')
      .flush({ message: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();

    expect(fixture.componentInstance.formErrors()).toEqual(['Invalid credentials']);
    expect(fixture.nativeElement.textContent).toContain('Invalid credentials');
  });

  it('stops submitting after a failure, so the button is usable again', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.componentInstance.form.setValue({ email: 'a@b.c', password: 'wrong-one' });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    expect(fixture.componentInstance.submitting()).toBe(true);

    http.expectOne('/api/auth/login').flush(null, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();

    expect(fixture.componentInstance.submitting()).toBe(false);
  });
});

describe('LoginComponent and the returnUrl', () => {
  it('returns the visitor to where they were going', async () => {
    configure({ returnUrl: '/bills/abc-123' });
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.componentInstance.form.setValue({ email: 'a@b.c', password: 'hunter22' });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    http.expectOne('/api/auth/login').flush({ accessToken: 'token-1', user: profile });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith('/bills/abc-123');
  });

  it('refuses to follow a returnUrl that leaves the site', async () => {
    configure({ returnUrl: 'https://evil.example' });
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.componentInstance.form.setValue({ email: 'a@b.c', password: 'hunter22' });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    http.expectOne('/api/auth/login').flush({ accessToken: 'token-1', user: profile });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith('/upcoming');
  });
});

describe('LoginComponent and an expired session', () => {
  it('explains why the visitor is looking at this screen', async () => {
    // The interceptor sends them here with reason=expired after a failed
    // refresh. Without the explanation it reads as the application
    // forgetting them for no reason.
    configure({ reason: 'expired' });
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('session expired');
  });

  it('says nothing special on an ordinary visit', async () => {
    configure();
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).not.toContain('session expired');
  });
});
