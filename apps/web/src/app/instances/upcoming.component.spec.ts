import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { provideCalendarDateAdapter } from '../core/date/calendar-date.adapter';
import { InstancesStore } from '../core/state/instances.store';
import { UpcomingComponent } from './upcoming.component';

let http: HttpTestingController;

const base = {
  id: 'inst-1',
  billId: 'bill-1',
  billName: 'Rent',
  categoryId: 'cat-1',
  dueDate: '2026-10-01',
  amount: 1200,
  amountPaid: 0,
  status: 'UNPAID' as const,
  isOverdue: false,
  isCustomized: false,
  paidAt: null,
  note: null,
};

function instancesRequest() {
  return http.expectOne((r) => r.url === '/api/bill-instances');
}

/**
 * The component loads `BillsStore` in its constructor (for the bill
 * filter's options), alongside its own instances request. Every test that
 * creates the fixture must answer this request too, or `http.verify()`
 * fails on an outstanding call.
 */
function billsRequest() {
  return http.expectOne((r) => r.url === '/api/bills');
}

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [UpcomingComponent],
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
  http.verify();
});

describe('UpcomingComponent', () => {
  it('lists instances with their bill name, due date, and amount', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();
    // Twice: the store resumes its `load()` one microtask after
    // `flush()` returns, because `firstValueFrom` wraps the
    // response in a native promise. The first `whenStable()` can
    // settle before that continuation runs; the second observes
    // the render it produced.
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Rent');
    expect(text).toContain('Oct 1, 2026');
    expect(text).toContain('$1,200.00');
  });

  it('defaults to the current month', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    await fixture.whenStable();

    const req = instancesRequest();
    const from = req.request.params.get('from') ?? '';
    const to = req.request.params.get('to') ?? '';
    expect(from.endsWith('-01')).toBe(true);
    expect(from.slice(0, 7)).toBe(to.slice(0, 7));
    req.flush([]);
  });

  it('names the empty state rather than rendering a blank table', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    await fixture.whenStable();
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Nothing due in this range');
  });

  it('shows the amount still owed on a partially paid instance', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    await fixture.whenStable();
    instancesRequest().flush([
      { ...base, status: 'PARTIALLY_PAID', amountPaid: 500 },
    ]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('$700.00');
  });
});

describe('overdue comes from the server', () => {
  it('marks a row overdue when the server says so, whatever its due date', async () => {
    // Review Focus 5. `isOverdue` is derived against the server's
    // APP_TIMEZONE. A browser in UTC+14 or UTC-11 is on a different
    // calendar day, so a locally derived badge would disagree with the
    // API on exactly the rows a person cares most about.
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    await fixture.whenStable();
    instancesRequest().flush([{ ...base, dueDate: '2099-01-01', isOverdue: true }]);
    await fixture.whenStable();
    await fixture.whenStable();

    // Query the badge itself, not page text: the filter control also says
    // "Overdue", so a textContent check is vacuously true in one direction
    // and unsatisfiable in the other.
    expect(fixture.nativeElement.querySelector('.overdue-chip')).not.toBeNull();
  });

  it('does not mark a row overdue when the server says it is not, however old it is', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    await fixture.whenStable();
    instancesRequest().flush([{ ...base, dueDate: '2000-01-01', isOverdue: false }]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.overdue-chip')).toBeNull();
  });
});

describe('the range controls', () => {
  it('refuses an over-wide range with a message and sends nothing', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.rangeForm.setValue({ from: '2026-01-01', to: '2027-06-01' });
    await fixture.componentInstance.applyRange();
    await fixture.whenStable();

    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('400');
    expect(fixture.nativeElement.textContent).toContain('Rent');
  });

  it('applies a valid range', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    await fixture.whenStable();
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.rangeForm.setValue({ from: '2026-11-01', to: '2026-11-30' });
    const applied = fixture.componentInstance.applyRange();
    const req = instancesRequest();
    expect(req.request.params.get('from')).toBe('2026-11-01');
    req.flush([]);
    await applied;
  });
});

describe('the bill filter', () => {
  // Spec §11 requires status, overdue, and billId; the store and API
  // already support billId (store spec proves it reaches the wire), but
  // the component rendered no control for it.
  it('puts the chosen bill id on the request', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([{ id: 'bill-1', categoryId: null, name: 'Rent', defaultAmount: 1200, frequency: 'MONTHLY', startDate: '2026-01-01', endDate: null, isActive: true }]);
    await fixture.whenStable();
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.setBillId('bill-1');
    const applied = fixture.componentInstance.applyRange();
    const req = instancesRequest();
    expect(req.request.params.get('billId')).toBe('bill-1');
    req.flush([]);
    await applied;
  });

  it('omits billId when "Any bill" is selected', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    await fixture.whenStable();
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.setBillId(null);
    const applied = fixture.componentInstance.applyRange();
    const req = instancesRequest();
    expect(req.request.params.has('billId')).toBe(false);
    req.flush([]);
    await applied;
  });
});

describe('the day boundary', () => {
  it('refetches when the browser day has changed since the rows were fetched', async () => {
    // `isOverdue` goes stale at midnight. A tab left open overnight would
    // otherwise show yesterday's answer indefinitely.
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();
    await fixture.whenStable();

    const store = TestBed.inject(InstancesStore);
    expect(store.fetchedOn()).not.toBeNull();

    // A date far from whatever the real fetch stamped stands in for "the
    // browser day has moved on" — the component cannot fake the system
    // clock, only the day it compares against.
    fixture.componentInstance.refreshIfDayChanged('2099-01-01');
    await fixture.whenStable();

    instancesRequest().flush([base]);
    await fixture.whenStable();
  });

  it('does not refetch when the day is unchanged', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();
    await fixture.whenStable();

    const store = TestBed.inject(InstancesStore);
    fixture.componentInstance.refreshIfDayChanged(store.fetchedOn() ?? undefined);
    await fixture.whenStable();

    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
  });

  it('does not let a refused range advance the day marker, so a later check still refetches', async () => {
    // Review addition for Task 12. `load()` used to stamp a component-local
    // marker with `today()` before calling `store.setQuery`, even when the
    // range was refused as invalid or over-wide and no fetch happened. That
    // let a refused submission convince `refreshIfDayChanged` that stale
    // rows were fresh. The store now owns the marker and only advances it
    // on a fetch that actually succeeds.
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();
    await fixture.whenStable();

    const store = TestBed.inject(InstancesStore);
    const fetchedOn = store.fetchedOn();

    fixture.componentInstance.rangeForm.setValue({ from: '2026-01-01', to: '2027-06-01' });
    await fixture.componentInstance.applyRange();
    await fixture.whenStable();
    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
    expect(store.fetchedOn()).toBe(fetchedOn);

    fixture.componentInstance.refreshIfDayChanged('2099-01-01');
    await fixture.whenStable();

    instancesRequest().flush([base]);
    await fixture.whenStable();
  });
});

/**
 * Spies on the dialog the component will actually use.
 *
 * It must take the fixture rather than reaching for `TestBed.inject`: with
 * `provideRouter` and `provideHttpClient` both present, `MatDialog`
 * (`providedIn: 'root'`) resolves to two distinct instances depending on
 * which injector asks first — the component's own and the TestBed module's.
 * Spying on the wrong one silently misses every call the component makes,
 * and the test then opens a real dialog that nothing ever closes.
 */
function dialogReturning(
  fixture: ComponentFixture<UpcomingComponent>,
  value: unknown,
) {
  return vi
    .spyOn(fixture.componentRef.injector.get(MatDialog), 'open')
    .mockReturnValue({ afterClosed: () => of(value) } as never);
}

const payment = {
  id: 'pay-1',
  billInstanceId: 'inst-1',
  amountPaid: 1200,
  paidAt: '2026-10-01T12:00:00.000Z',
  note: null,
  reversesPaymentId: null,
};

describe('payment actions', () => {
  it('records a payment and patches the row from the response', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    dialogReturning(fixture, { note: null });
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();
    await fixture.whenStable();

    const done = fixture.componentInstance.openPayment(base);
    // The dialog's `afterClosed()` settles through its own promise hop
    // before `openPayment` reaches the HTTP call, so the request does not
    // exist yet on the tick `openPayment` is invoked.
    await fixture.whenStable();
    const req = http.expectOne('/api/bill-instances/inst-1/payments');
    expect(req.request.body).toEqual({ note: null });
    req.flush({ instance: { ...base, status: 'PAID', amountPaid: 1200 }, payment });
    await done;
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Paid');
  });

  it('shows a failed payment without changing the row', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    dialogReturning(fixture, { note: null });
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();
    await fixture.whenStable();

    const done = fixture.componentInstance.openPayment(base);
    await fixture.whenStable();
    http
      .expectOne('/api/bill-instances/inst-1/payments')
      .flush({ message: 'Amount exceeds the balance' }, { status: 400, statusText: 'Bad Request' });
    await done;
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.componentInstance.actionError()).toContain('Amount exceeds the balance');
    expect(fixture.nativeElement.textContent).toContain('Unpaid');
  });

  it('sends nothing when the dialog is dismissed', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    dialogReturning(fixture, undefined);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();
    await fixture.whenStable();

    await fixture.componentInstance.openPayment(base);

    expect(http.match('/api/bill-instances/inst-1/payments')).toHaveLength(0);
  });

  it('clears payments and patches the row from the bare instance response', async () => {
    const partiallyPaid = { ...base, status: 'PARTIALLY_PAID' as const, amountPaid: 500 };
    const fixture = TestBed.createComponent(UpcomingComponent);
    billsRequest().flush([]);
    dialogReturning(fixture, 'confirm');
    await fixture.whenStable();
    instancesRequest().flush([partiallyPaid]);
    await fixture.whenStable();
    await fixture.whenStable();

    const done = fixture.componentInstance.confirmUnpay(partiallyPaid);
    // Same hop as openPayment above: the confirm dialog's afterClosed()
    // settles before confirmUnpay reaches the HTTP call.
    await fixture.whenStable();
    const req = http.expectOne('/api/bill-instances/inst-1/unpay');
    expect(req.request.method).toBe('POST');
    req.flush({ ...base, status: 'UNPAID', amountPaid: 0 });
    await done;
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Unpaid');
    expect(fixture.nativeElement.textContent).not.toContain('paid of');
  });
});
