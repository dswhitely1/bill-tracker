import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
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

/**
 * The component loads `CategoriesStore` for the category filter's options,
 * so every fixture must answer this request too or `http.verify()` fails.
 */
function categoriesRequest() {
  return http.expectOne((r) => r.url === '/api/categories');
}

/**
 * The component also loads `SummaryStore`, for the overdue disclosure. All
 * three of these fire from the constructor, so they are answered before
 * the first `whenStable()` — a pending request would otherwise keep the
 * fixture from ever reaching quiescence.
 */
const emptySummary = {
  asOf: '2026-10-15',
  overdue: { count: 0, amount: 0, earliestDueDate: null },
  thisMonth: { count: 0, total: 0, paid: 0 },
  next7Days: { count: 0, amount: 0 },
  byCategory: [],
};

/**
 * Creates the fixture and answers the three constructor-time requests.
 *
 * The summary request is flushed only after an intermediate `whenStable()`,
 * not alongside bills and categories. `SummaryStore`'s mutation-watching
 * effect reads its own `loaded` flag `untracked` so that reacting to it
 * does not also depend on it — but that guard only protects *reruns*. The
 * effect's own first run is scheduled, not synchronous, and if this
 * store's fetch already resolved by the time that first run happens, the
 * effect sees `loaded() === true` on what it thinks is a plain
 * dependency-registration pass and fires an unsolicited second
 * `GET /api/summary`. Flushing bills and categories, letting a tick run
 * (which is where that first, dependency-registering pass actually
 * happens, while `loaded()` is still false), and only then flushing
 * summary avoids the race.
 */
async function createFixture(summary: unknown = emptySummary) {
  const fixture = TestBed.createComponent(UpcomingComponent);
  billsRequest().flush([]);
  categoriesRequest().flush([]);
  await fixture.whenStable();
  http.expectOne((r) => r.url === '/api/summary').flush(summary as object);
  await fixture.whenStable();
  return fixture;
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
    const fixture = await createFixture();
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
    await createFixture();

    const req = instancesRequest();
    const from = req.request.params.get('from') ?? '';
    const to = req.request.params.get('to') ?? '';
    expect(from.endsWith('-01')).toBe(true);
    expect(from.slice(0, 7)).toBe(to.slice(0, 7));
    req.flush([]);
  });

  it('names the empty state rather than rendering a blank table', async () => {
    const fixture = await createFixture();
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Nothing due in this range');
  });

  it('shows the amount still owed on a partially paid instance', async () => {
    const fixture = await createFixture();
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
    const fixture = await createFixture();
    instancesRequest().flush([{ ...base, dueDate: '2099-01-01', isOverdue: true }]);
    await fixture.whenStable();
    await fixture.whenStable();

    // Query the badge itself, not page text: the filter control also says
    // "Overdue", so a textContent check is vacuously true in one direction
    // and unsatisfiable in the other.
    expect(fixture.nativeElement.querySelector('.overdue-chip')).not.toBeNull();
  });

  it('does not mark a row overdue when the server says it is not, however old it is', async () => {
    const fixture = await createFixture();
    instancesRequest().flush([{ ...base, dueDate: '2000-01-01', isOverdue: false }]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.overdue-chip')).toBeNull();
  });
});

describe('the range controls', () => {
  it('falls back to the current range when an invalid one is submitted, keeping existing rows', async () => {
    // The filters are URL params now (Task 7): an invalid range submitted
    // through the picker is sanitised by `parseUpcomingParams` rather than
    // surfaced as a form error — see "renders the default view for a
    // malformed URL instead of erroring" below, which is the same
    // behaviour reached by typing the bad range into the address bar
    // directly. The range it falls back to is the same current month the
    // screen already loaded, so no second request is sent and the rows
    // already on screen are undisturbed.
    const fixture = await createFixture();
    instancesRequest().flush([base]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.rangeForm.setValue({ from: '2026-01-01', to: '2027-06-01' });
    fixture.componentInstance.applyRange();
    await fixture.whenStable();
    await fixture.whenStable();

    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('Rent');
  });

  it('applies a valid range', async () => {
    const fixture = await createFixture();
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.rangeForm.setValue({ from: '2026-11-01', to: '2026-11-30' });
    fixture.componentInstance.applyRange();
    await fixture.whenStable();
    const req = instancesRequest();
    expect(req.request.params.get('from')).toBe('2026-11-01');
    req.flush([]);
    await fixture.whenStable();
  });
});

describe('the bill filter', () => {
  // Spec §11 requires status, overdue, and billId; the store and API
  // already support billId (store spec proves it reaches the wire), but
  // the component rendered no control for it.
  it('puts the chosen bill id on the request', async () => {
    // A real UUID, not 'bill-1': `parseUpcomingParams`' `readUuid` would
    // otherwise silently drop it on the URL round trip, and the request
    // this test is checking for would never be sent.
    const billId = '11111111-1111-1111-1111-111111111111';
    const fixture = await createFixture();
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    // Setting the filter alone patches the URL and refetches now; there is
    // no separate "apply" step for anything but the date range.
    fixture.componentInstance.setBillId(billId);
    await fixture.whenStable();
    await fixture.whenStable();
    const req = instancesRequest();
    expect(req.request.params.get('billId')).toBe(billId);
    req.flush([]);
    await fixture.whenStable();
  });

  it('omits billId when "Any bill" is selected', async () => {
    const fixture = await createFixture();
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.setBillId(null);
    await fixture.whenStable();

    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
  });
});

describe('the day boundary', () => {
  it('refetches when the browser day has changed since the rows were fetched', async () => {
    // `isOverdue` goes stale at midnight. A tab left open overnight would
    // otherwise show yesterday's answer indefinitely.
    const fixture = await createFixture();
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
    const fixture = await createFixture();
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
    const fixture = await createFixture();
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
    const fixture = await createFixture();
    dialogReturning(fixture, { note: null });
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

    // A successful payment bumps `PaymentsService.mutations()`, which is
    // exactly what `SummaryStore`'s own effect watches for — correctly, a
    // payment changes every one of its buckets. The resulting background
    // refetch is answered here so `http.verify()` finds nothing pending.
    http.expectOne((r) => r.url === '/api/summary').flush(emptySummary);

    expect(fixture.nativeElement.textContent).toContain('Paid');
  });

  it('shows a failed payment without changing the row', async () => {
    const fixture = await createFixture();
    dialogReturning(fixture, { note: null });
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
    const fixture = await createFixture();
    dialogReturning(fixture, undefined);
    instancesRequest().flush([base]);
    await fixture.whenStable();
    await fixture.whenStable();

    await fixture.componentInstance.openPayment(base);

    expect(http.match('/api/bill-instances/inst-1/payments')).toHaveLength(0);
  });

  it('clears payments and patches the row from the bare instance response', async () => {
    const partiallyPaid = { ...base, status: 'PARTIALLY_PAID' as const, amountPaid: 500 };
    const fixture = await createFixture();
    dialogReturning(fixture, 'confirm');
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

    // Same background refetch as above: `unpay` also bumps
    // `PaymentsService.mutations()`.
    http.expectOne((r) => r.url === '/api/summary').flush(emptySummary);

    expect(fixture.nativeElement.textContent).toContain('Unpaid');
    expect(fixture.nativeElement.textContent).not.toContain('paid of');
  });
});

describe('UpcomingComponent URL state', () => {
  it('reads its filters from the query string rather than from component state', async () => {
    await TestBed.inject(Router).navigate([], {
      queryParams: { from: '2026-03-01', to: '2026-03-31', status: 'PAID', overdue: 'false' },
    });

    await createFixture();
    const req = instancesRequest();

    expect(req.request.params.get('from')).toBe('2026-03-01');
    expect(req.request.params.get('to')).toBe('2026-03-31');
    expect(req.request.params.get('status')).toBe('PAID');
    expect(req.request.params.get('overdue')).toBe('false');
    req.flush([]);
  });

  it('renders the default view for a malformed URL instead of erroring', async () => {
    await TestBed.inject(Router).navigate([], {
      queryParams: { status: 'BANANA', from: '2026-13-45', sort: 'nonsense', overdue: 'maybe' },
    });

    const fixture = await createFixture();
    const req = instancesRequest();

    // Nothing invalid reaches the API...
    expect(req.request.params.has('status')).toBe(false);
    expect(req.request.params.has('overdue')).toBe(false);
    const from = req.request.params.get('from') ?? '';
    expect(from.endsWith('-01')).toBe(true);
    req.flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    // ...and the component settled on real defaults rather than carrying
    // the garbage forward. Asserting the absence of "BANANA" from the DOM
    // would pass even if the parse had failed entirely, because that word
    // is never rendered under any circumstances.
    expect(fixture.componentInstance.params().status).toBeNull();
    expect(fixture.componentInstance.params().overdue).toBeNull();
    expect(fixture.componentInstance.params().sort).toBe('dueDate');
  });

  it('writes a filter change back into the URL', async () => {
    const fixture = await createFixture();
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.setStatus('PAID');
    await fixture.whenStable();

    expect(TestBed.inject(Router).url).toContain('status=PAID');
    instancesRequest().flush([]);
  });

  it('does not refetch when only a client-side filter changes', async () => {
    // A real UUID, not 'cat-1': `parseUpcomingParams`' `readCategoryId`
    // validates the shape of anything that survives the URL round trip,
    // so a non-UUID value would silently parse back to `null` and this
    // test would pass without ever exercising the category filter.
    const categoryId = '22222222-2222-2222-2222-222222222222';
    const fixture = await createFixture();
    instancesRequest().flush([
      { ...base, id: 'a', billName: 'Electric', categoryId },
      { ...base, id: 'b', billName: 'Rent', categoryId: null },
    ]);
    await fixture.whenStable();
    await fixture.whenStable();

    // Sorting and searching run over rows already in memory. A refetch here
    // would issue a request per keystroke.
    fixture.componentInstance.setSort('amount');
    await fixture.whenStable();
    fixture.componentInstance.setCategoryId(categoryId);
    await fixture.whenStable();

    http.expectNone((r) => r.url === '/api/bill-instances');
    // The client-side path actually ran: `setCategoryId` is only
    // meaningful without a refetch if the in-memory filter in `visible()`
    // reacted to it. Only the row carrying this category survives.
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Electric');
    expect(text).not.toContain('Rent');
  });

  it('applies the search term to the rows it already holds', async () => {
    const fixture = await createFixture();
    instancesRequest().flush([
      { ...base, id: 'a', billName: 'Electric' },
      { ...base, id: 'b', billName: 'Rent' },
    ]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.setSearch('elec');
    await fixture.whenStable();
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Electric');
    expect(text).not.toContain('Rent');
  });

  it('orders rows by the chosen sort key', async () => {
    const fixture = await createFixture();
    instancesRequest().flush([
      { ...base, id: 'a', billName: 'Alpha', amount: 50 },
      { ...base, id: 'b', billName: 'Beta', amount: 900 },
    ]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.setSort('amount');
    fixture.componentInstance.setDir('desc');
    await fixture.whenStable();
    await fixture.whenStable();

    const text: string = fixture.nativeElement.textContent;
    expect(text.indexOf('Beta')).toBeLessThan(text.indexOf('Alpha'));
  });

  it('discloses overdue rows that fall outside the range it can show', async () => {
    await TestBed.inject(Router).navigate([], {
      queryParams: { overdue: 'true', from: '2026-10-01', to: '2026-10-31' },
    });
    // The summary's all-time figure reaches further back than the range.
    const fixture = await createFixture({
      ...emptySummary,
      overdue: { count: 3, amount: 450, earliestDueDate: '2024-01-05' },
    });
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('$450.00');
    expect(fixture.nativeElement.textContent).toContain('older than');
  });

  it('shows no disclosure when the range already covers every overdue row', async () => {
    await TestBed.inject(Router).navigate([], {
      queryParams: { overdue: 'true', from: '2026-01-01', to: '2026-10-31' },
    });
    const fixture = await createFixture({
      ...emptySummary,
      overdue: { count: 1, amount: 100, earliestDueDate: '2026-02-01' },
    });
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).not.toContain('older than');
  });
});
