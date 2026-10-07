import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { CategoriesComponent } from './categories.component';

let http: HttpTestingController;

const utilities = { id: 'cat-1', name: 'Utilities', color: '#2f80ed' };

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [CategoriesComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  TestBed.inject(SessionService).signIn({
    accessToken: 'token-1',
    user: { id: 'user-1', email: 'a@b.c', name: 'Ada', notifyEmail: true, notifyInApp: true },
  });
});

afterEach(() => {
  http.verify();
});

describe('CategoriesComponent', () => {
  it('loads and lists categories', async () => {
    const fixture = TestBed.createComponent(CategoriesComponent);
    await fixture.whenStable();

    http.expectOne('/api/categories').flush([utilities]);
    // Two ticks: the store resumes `load()` one microtask after `flush()`
    // returns, because `firstValueFrom` wraps the response in a native
    // Promise. The first `whenStable()` can settle before that
    // continuation runs; the second observes the render it produced.
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Utilities');
  });

  it('names the empty state instead of rendering a blank panel', async () => {
    // Review Focus 4. A new account with no categories must read as
    // "there are none yet", not as a page that failed to load.
    const fixture = TestBed.createComponent(CategoriesComponent);
    await fixture.whenStable();

    http.expectOne('/api/categories').flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('No categories yet');
  });

  it('shows no empty state while the first load is still in flight', async () => {
    const fixture = TestBed.createComponent(CategoriesComponent);
    await fixture.whenStable();

    const request = http.expectOne('/api/categories');
    expect(fixture.nativeElement.textContent).not.toContain('No categories yet');

    request.flush([]);
  });

  it('shows the load failure instead of an empty list', async () => {
    const fixture = TestBed.createComponent(CategoriesComponent);
    await fixture.whenStable();

    http.expectOne('/api/categories').flush(null, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Something went wrong');
    expect(fixture.nativeElement.textContent).not.toContain('No categories yet');
  });

  it('reports the server message when a delete is refused with 409', async () => {
    // Bills spec §7.4: the message names how many bills still use it, and
    // that count is the only thing that tells a person what to do next.
    const fixture = TestBed.createComponent(CategoriesComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([utilities]);
    await fixture.whenStable();
    await fixture.whenStable();

    // `confirmRemove` opens a real `MatDialog`; nothing resolves its
    // `afterClosed()` until the dialog itself is closed, so awaiting it
    // directly here would hang. Start it, let the dialog render, then
    // click its own "Delete" button — the same action a person takes —
    // before awaiting the rest of the flow.
    const removal = fixture.componentInstance.confirmRemove(utilities);
    await fixture.whenStable();
    const confirmButton = document.querySelector<HTMLButtonElement>('[data-testid="confirm"]');
    confirmButton?.click();
    await fixture.whenStable();

    http.expectOne('/api/categories/cat-1').flush(
      { message: 'This category is used by 3 bill(s). Reassign or delete them first.' },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    await fixture.whenStable();
    await removal;

    expect(fixture.componentInstance.lastError()).toContain('used by 3 bill(s)');
    expect(fixture.nativeElement.textContent).toContain('Utilities');
  });
});
