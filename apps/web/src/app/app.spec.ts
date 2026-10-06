import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './app';
import { routes } from './app.routes';

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
