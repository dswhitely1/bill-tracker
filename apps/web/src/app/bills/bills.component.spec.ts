import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { SessionService } from '../core/auth/session.service';
import { BillsComponent } from './bills.component';

let http: HttpTestingController;

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

function flushInitialLoads(bills: unknown[] = [rent]) {
  http.expectOne((r) => r.url === '/api/bills').flush(bills);
  http.expectOne('/api/categories').flush([{ id: 'cat-1', name: 'Housing', color: null }]);
}

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [BillsComponent],
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
  vi.restoreAllMocks();
});

describe('BillsComponent', () => {
  it('lists bills with their amount, frequency, and category', async () => {
    const fixture = TestBed.createComponent(BillsComponent);
    await fixture.whenStable();
    flushInitialLoads();
    await fixture.whenStable();
    // Twice: the store resumes its `load()` one microtask after
    // `flush()` returns, because `firstValueFrom` wraps the
    // response in a native promise. The first `whenStable()` can
    // settle before that continuation runs; the second observes
    // the render it produced.
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Rent');
    expect(text).toContain('$1,200.00');
    expect(text).toContain('Monthly');
    expect(text).toContain('Housing');
  });

  it('marks a deactivated bill as inactive', async () => {
    const fixture = TestBed.createComponent(BillsComponent);
    await fixture.whenStable();
    flushInitialLoads([{ ...rent, isActive: false }]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Inactive');
  });

  it('names the empty state instead of rendering a blank table', async () => {
    const fixture = TestBed.createComponent(BillsComponent);
    await fixture.whenStable();
    flushInitialLoads([]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('No bills yet');
  });

  it('offers deactivation as the default action when deleting', async () => {
    // The API offers a non-destructive path and the README documents the
    // distinction. The dialog must lead with it rather than with the
    // action that destroys payment history.
    //
    // The spy targets `fixture.componentRef.injector.get(MatDialog)`
    // rather than `TestBed.inject(MatDialog)`: with `provideRouter` and
    // `provideHttpClient` both present, `MatDialog` (`providedIn: 'root'`)
    // resolves to two distinct instances depending on which injector asks
    // first — the component's own, and the TestBed module's. Spying on
    // the wrong one silently misses every call the component makes.
    const fixture = TestBed.createComponent(BillsComponent);
    await fixture.whenStable();
    flushInitialLoads();
    await fixture.whenStable();
    await fixture.whenStable();

    const open = vi
      .spyOn(fixture.componentRef.injector.get(MatDialog), 'open')
      .mockReturnValue({ afterClosed: () => of(undefined) } as never);

    await fixture.componentInstance.confirmRemove(rent);

    const data = open.mock.calls[0][1]?.data as { alternateLabel?: string; message: string };
    expect(data.alternateLabel).toBe('Deactivate instead');
    expect(data.message).toContain('payment history');
  });

  it('deactivates rather than deleting when the alternate action is chosen', async () => {
    const fixture = TestBed.createComponent(BillsComponent);
    await fixture.whenStable();
    flushInitialLoads();
    await fixture.whenStable();
    await fixture.whenStable();

    vi.spyOn(fixture.componentRef.injector.get(MatDialog), 'open').mockReturnValue({
      afterClosed: () => of('alternate'),
    } as never);

    const done = fixture.componentInstance.confirmRemove(rent);
    // The dialog's choice resolves through `firstValueFrom`, which is a
    // native Promise: the HTTP call it leads to is not dispatched until a
    // microtask after `confirmRemove` returns its own pending promise.
    await fixture.whenStable();
    const req = http.expectOne('/api/bills/bill-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ isActive: false });
    req.flush({ ...rent, isActive: false });
    await done;
  });

  it('deletes when the destructive action is chosen', async () => {
    const fixture = TestBed.createComponent(BillsComponent);
    await fixture.whenStable();
    flushInitialLoads();
    await fixture.whenStable();
    await fixture.whenStable();

    vi.spyOn(fixture.componentRef.injector.get(MatDialog), 'open').mockReturnValue({
      afterClosed: () => of('confirm'),
    } as never);

    const done = fixture.componentInstance.confirmRemove(rent);
    await fixture.whenStable();
    const req = http.expectOne('/api/bills/bill-1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    await done;
  });
});
