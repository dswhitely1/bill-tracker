import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillInstanceResponse } from '@bill-tracker/shared-types';
import { SessionService } from '../core/auth/session.service';
import { provideCalendarDateAdapter } from '../core/date/calendar-date.adapter';
import { InstancesStore } from '../core/state/instances.store';
import { DayDetailComponent } from './day-detail.component';

let http: HttpTestingController;

const base: BillInstanceResponse = {
  id: 'inst-1',
  billId: 'bill-1',
  billName: 'Rent',
  categoryId: 'cat-1',
  dueDate: '2026-10-09',
  amount: 1200,
  amountPaid: 0,
  status: 'UNPAID',
  isOverdue: false,
  isCustomized: false,
  paidAt: null,
  note: null,
};

async function render(instances: BillInstanceResponse[] = [base]) {
  const fixture = TestBed.createComponent(DayDetailComponent);
  fixture.componentRef.setInput('date', '2026-10-09');
  fixture.componentRef.setInput('instances', instances);
  await fixture.whenStable();
  return fixture;
}

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [DayDetailComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideCalendarDateAdapter(),
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
  vi.restoreAllMocks();
  http.verify();
});

describe('DayDetailComponent', () => {
  it('names the day it is showing', async () => {
    const fixture = await render();
    expect(fixture.nativeElement.textContent).toContain('Oct 9, 2026');
  });

  it('lists the day’s bills', async () => {
    const fixture = await render();
    expect(fixture.nativeElement.textContent).toContain('Rent');
    expect(fixture.nativeElement.textContent).toContain('$1,200.00');
  });

  it('says so when the day has nothing on it', async () => {
    const fixture = await render([]);
    expect(fixture.nativeElement.textContent).toContain('Nothing due');
  });

  it('offers to record a payment on an unpaid bill', async () => {
    const fixture = await render();
    const buttons = [...fixture.nativeElement.querySelectorAll('button')].map(
      (b: HTMLButtonElement) => b.textContent?.trim(),
    );
    expect(buttons).toContain('Record payment');
  });

  it('does not offer to record a payment on a paid bill', async () => {
    const fixture = await render([{ ...base, status: 'PAID', amountPaid: 1200 }]);
    const buttons = [...fixture.nativeElement.querySelectorAll('button')].map(
      (b: HTMLButtonElement) => b.textContent?.trim(),
    );
    expect(buttons).not.toContain('Record payment');
  });

  it('records a payment through the same service the list uses', async () => {
    const fixture = await render();
    // The component's own injector, not TestBed's: they resolve different
    // MatDialog instances, and `InstanceActionsService` (itself
    // `providedIn: 'root'`) resolves its own `MatDialog` dependency from
    // this same root, not TestBed's.
    const dialog = fixture.componentRef.injector.get(MatDialog);
    // `{}` — not `{ payInFull: true }`. There is no such field on
    // `PaymentDialogResult`; "pay in full" is a checkbox the real dialog
    // converts into *omitting* `amount`, because the server computes the
    // remaining balance under a row lock.
    vi.spyOn(dialog, 'open').mockReturnValue({
      afterClosed: () => of({}),
    } as never);

    // Seeds the real `InstancesStore` with the same row the panel is
    // showing, so `PaymentsService.record`'s `patch()` below has an
    // existing row to land on — exactly what a real `CalendarComponent`
    // would already have fetched before this panel ever opened. Without
    // this, `patch()` finds no row with a matching id, no-ops, and the
    // assertion below would pass vacuously no matter what `patch()` did.
    const store = fixture.componentRef.injector.get(InstancesStore);
    void store.setQuery({ from: '2026-10-09', to: '2026-10-09' });
    http.expectOne((r) => r.url === '/api/bill-instances').flush([base]);
    await fixture.whenStable();

    fixture.nativeElement.querySelector('button[data-testid="pay"]').click();
    await fixture.whenStable();

    const req = http.expectOne((r) => r.url === '/api/bill-instances/inst-1/payments');
    expect(req.request.method).toBe('POST');
    req.flush({
      instance: { ...base, status: 'PAID', amountPaid: 1200 },
      payment: {
        id: 'pay-1',
        billInstanceId: 'inst-1',
        amountPaid: 1200,
        paidAt: '2026-10-09T00:00:00.000Z',
        note: null,
        reversesPaymentId: null,
      },
    });
    await fixture.whenStable();
    await fixture.whenStable();

    // What a real `CalendarComponent` would now pass down: the row
    // `InstancesStore.patch()` just updated, re-read from the store
    // itself rather than re-derived here, so a store that failed to patch
    // would carry stale data into this assertion too.
    fixture.componentRef.setInput('instances', store.instances());
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Paid');
    expect(fixture.nativeElement.querySelector('button[data-testid="pay"]')).toBeNull();
  });

  it('reports a failed payment instead of looking successful', async () => {
    const fixture = await render();
    const dialog = fixture.componentRef.injector.get(MatDialog);
    vi.spyOn(dialog, 'open').mockReturnValue({
      afterClosed: () => of({}),
    } as never);

    fixture.nativeElement.querySelector('button[data-testid="pay"]').click();
    await fixture.whenStable();

    http.expectOne((r) => r.url === '/api/bill-instances/inst-1/payments').flush(
      { statusCode: 409, error: 'Conflict', message: 'Already paid' },
      { status: 409, statusText: 'Conflict' },
    );
    // Four, not the usual two: the rejection crosses one extra promise hop
    // on its way out — `PaymentsService.record` to
    // `InstanceActionsService.recordPayment`'s catch block to this
    // component's `openPayment` — before `actionError.set()` runs and
    // schedules the render this assertion depends on.
    await fixture.whenStable();
    await fixture.whenStable();
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
  });

  it('clears a stale error when the day changes', async () => {
    // `CalendarComponent` renders this panel behind `@if (selected(); as
    // day) { ... }`, which only destroys and recreates the view on a
    // truthy↔falsy transition of `selected()` — not when one non-null day
    // replaces another. The same component instance survives a
    // day-to-day switch, so without resetting `actionError` on `date()`
    // changing, a failed payment's message on one day would still be
    // showing under the next day's panel.
    const fixture = await render();
    const dialog = fixture.componentRef.injector.get(MatDialog);
    vi.spyOn(dialog, 'open').mockReturnValue({
      afterClosed: () => of({}),
    } as never);

    fixture.nativeElement.querySelector('button[data-testid="pay"]').click();
    await fixture.whenStable();
    http.expectOne((r) => r.url === '/api/bill-instances/inst-1/payments').flush(
      { statusCode: 409, error: 'Conflict', message: 'Already paid' },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    await fixture.whenStable();
    await fixture.whenStable();
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();

    fixture.componentRef.setInput('date', '2026-10-15');
    fixture.componentRef.setInput('instances', []);
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
  });
});
