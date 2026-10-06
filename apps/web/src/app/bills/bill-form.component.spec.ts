import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { provideCalendarDateAdapter } from '../core/date/calendar-date.adapter';
import { BillFormComponent } from './bill-form.component';

let http: HttpTestingController;
let router: Router;

const rent = {
  id: 'bill-1',
  categoryId: 'cat-1',
  name: 'Rent',
  defaultAmount: 1200,
  frequency: 'MONTHLY' as const,
  startDate: '2026-01-01',
  endDate: null,
  isActive: true,
};

function configure(id: string | null) {
  TestBed.configureTestingModule({
    imports: [BillFormComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideCalendarDateAdapter(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', id]]) } } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  router = TestBed.inject(Router);
  TestBed.inject(SessionService).signIn({
    accessToken: 'token-1',
    user: { id: 'user-1', email: 'a@b.c', name: 'Ada', notifyEmail: true, notifyInApp: true },
  });
}

afterEach(() => {
  http.verify();
  vi.restoreAllMocks();
});

describe('creating', () => {
  beforeEach(() => configure(null));

  it('posts the new bill and returns to the list', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    await fixture.whenStable();
    // Twice: the store resumes its `load()` one microtask after
    // `flush()` returns, because `firstValueFrom` wraps the
    // response in a native promise. The first `whenStable()` can
    // settle before that continuation runs; the second observes
    // the render it produced.
    await fixture.whenStable();

    fixture.componentInstance.form.patchValue({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-02-01',
    });
    fixture.componentInstance.submit();

    const req = http.expectOne((r) => r.url === '/api/bills' && r.method === 'POST');
    expect(req.request.body).toEqual({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-02-01',
      endDate: null,
      categoryId: null,
    });
    req.flush({ ...rent, id: 'bill-2', name: 'Water' });
    await fixture.whenStable();
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith('/bills');
  });

  it('sends startDate as a bare YYYY-MM-DD string, never a Date', async () => {
    // Mocked so the real `Router`, which has no routes configured here,
    // never attempts (and fails) to navigate — that failure would
    // otherwise surface as an unrelated unhandled rejection.
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.form.patchValue({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-02-01',
    });
    fixture.componentInstance.submit();

    const req = http.expectOne((r) => r.url === '/api/bills' && r.method === 'POST');
    expect(req.request.body.startDate).toBe('2026-02-01');
    expect(typeof req.request.body.startDate).toBe('string');
    req.flush(rent);
  });

  it('refuses to submit when the end date precedes the start', async () => {
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.form.patchValue({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-12-01',
      endDate: '2026-01-01',
    });
    fixture.componentInstance.submit();
    // `submit()` here returns without touching a signal — the invalid
    // path only mutates the plain (non-signal) `FormGroup.errors` — so
    // zoneless change detection has nothing to react to until something
    // asks it to settle.
    await fixture.whenStable();

    expect(http.match((r) => r.method === 'POST')).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('end date');
  });

  it('attaches a server field error to its control', async () => {
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.form.patchValue({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-02-01',
    });
    fixture.componentInstance.submit();

    http.expectOne((r) => r.method === 'POST').flush(
      {
        message: ['defaultAmount must be a positive number'],
        errors: { defaultAmount: ['defaultAmount must be a positive number'] },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(fixture.componentInstance.form.controls.defaultAmount.errors).toMatchObject({
      server: 'defaultAmount must be a positive number',
    });
  });

  it('shows a service-raised 400 in the banner, since it names no field', async () => {
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.form.patchValue({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-02-01',
    });
    fixture.componentInstance.submit();

    http
      .expectOne((r) => r.method === 'POST')
      .flush({ message: 'Category not found' }, { status: 400, statusText: 'Bad Request' });
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Category not found');
  });
});

describe('editing', () => {
  beforeEach(() => configure('bill-1'));

  it('loads the bill into the form', async () => {
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    http.expectOne('/api/bills/bill-1').flush(rent);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.componentInstance.form.getRawValue()).toMatchObject({
      name: 'Rent',
      defaultAmount: 1200,
      startDate: '2026-01-01',
    });
  });

  it('warns that saving rewrites untouched future occurrences', async () => {
    // Bills spec §5.4. A person who does not expect this will be
    // surprised by it, and the surprise lands on their own data.
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    http.expectOne('/api/bills/bill-1').flush(rent);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('future');
    expect(fixture.nativeElement.textContent).toContain('unpaid');
  });

  it('shows no such warning when creating', async () => {
    TestBed.resetTestingModule();
    configure(null);
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).not.toContain('untouched');
  });

  it('patches only the bill and returns to the list', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    http.expectOne('/api/bills/bill-1').flush(rent);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.form.patchValue({ defaultAmount: 1300 });
    fixture.componentInstance.submit();

    const req = http.expectOne((r) => r.url === '/api/bills/bill-1' && r.method === 'PATCH');
    expect(req.request.body.defaultAmount).toBe(1300);
    req.flush({ ...rent, defaultAmount: 1300 });
    await fixture.whenStable();
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith('/bills');
  });
});
