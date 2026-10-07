import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SummaryResponse } from '@bill-tracker/shared-types';
import { SessionService } from '../auth/session.service';
import { BillsStore } from './bills.store';
import { PaymentsService } from './payments.service';
import { SummaryStore } from './summary.store';

let http: HttpTestingController;

const payload: SummaryResponse = {
  asOf: '2026-10-15',
  overdue: { count: 2, amount: 300, earliestDueDate: '2026-09-01' },
  thisMonth: { count: 4, total: 1000, paid: 250 },
  next7Days: { count: 1, amount: 120 },
  byCategory: [
    { categoryId: 'cat-1', categoryName: 'Utilities', color: '#112233', total: 400, paid: 100 },
  ],
};

// Distinguishable from `payload` in every bucket, so a test can prove a
// refetch happened by checking which one the store ends up holding.
const secondPayload: SummaryResponse = {
  asOf: '2026-10-16',
  overdue: { count: 5, amount: 900, earliestDueDate: '2026-09-02' },
  thisMonth: { count: 6, total: 2000, paid: 500 },
  next7Days: { count: 3, amount: 240 },
  byCategory: [
    { categoryId: 'cat-2', categoryName: 'Rent', color: '#445566', total: 800, paid: 200 },
  ],
};

function summaryRequest() {
  return http.expectOne((r) => r.url === '/api/summary');
}

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      provideHttpClientTesting(),
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

describe('SummaryStore', () => {
  it('loads the summary once and holds it', async () => {
    const store = TestBed.inject(SummaryStore);
    const loading = store.load();
    summaryRequest().flush(payload);
    await loading;

    expect(store.summary()).toEqual(payload);
    expect(store.loaded()).toBe(true);
    expect(store.error()).toBeNull();
  });

  it('does not refetch on a second load unless forced', async () => {
    const store = TestBed.inject(SummaryStore);
    const first = store.load();
    summaryRequest().flush(payload);
    await first;

    await store.load();
    // The observable consequence of not fetching: the data is still
    // exactly the first response, not a second answer the store never
    // asked for. `http.expectNone` below is what actually enforces no
    // request went out; this is here to satisfy `vitest/expect-expect`
    // with a real assertion rather than a filler one.
    expect(store.summary()).toEqual(payload);
    http.expectNone((r) => r.url === '/api/summary');

    const forced = store.load(true);
    summaryRequest().flush(payload);
    await forced;
  });

  it('surfaces a failure as a message and leaves loaded false', async () => {
    const store = TestBed.inject(SummaryStore);
    const loading = store.load();
    summaryRequest().flush(
      { statusCode: 500, error: 'Internal Server Error', message: 'boom' },
      { status: 500, statusText: 'Internal Server Error' },
    );
    await loading;

    expect(store.error()).not.toBeNull();
    expect(store.loaded()).toBe(false);
    expect(store.summary()).toBeNull();
  });

  it('refetches when a bill mutation is announced', async () => {
    const store = TestBed.inject(SummaryStore);
    const loading = store.load();
    summaryRequest().flush(payload);
    await loading;

    // An Angular effect runs its body once on its own first flush,
    // regardless of what it depends on. Without this drain, the
    // `TestBed.tick()` below would BE that first run — `loadedState` is
    // already true by then, so `fetch()` would fire unconditionally and
    // the test would pass even if the effect never read the counter.
    TestBed.tick();
    await vi.waitFor(() => expect(store.summary()).toEqual(payload));
    http.match((r) => r.url === '/api/summary').forEach((r) => r.flush(payload));

    // Creating a bill generates instances, which moves every card. Any
    // request from here on can only be explained by this announcement.
    TestBed.inject(BillsStore).announceMutation();
    TestBed.tick();
    summaryRequest().flush(secondPayload);

    // The refetch is started from inside an effect, so it settles a few
    // microtasks later than the flush. Only true because the refetch
    // happened and was answered: the store now holds the second response,
    // not the one from the initial load.
    await vi.waitFor(() => expect(store.summary()).toEqual(secondPayload));
  });

  it('refetches when a payment mutation is announced', async () => {
    const store = TestBed.inject(SummaryStore);
    const loading = store.load();
    summaryRequest().flush(payload);
    await loading;

    // Drain the effect's first execution — see the bill-mutation test
    // above for why this is required, not cosmetic.
    TestBed.tick();
    await vi.waitFor(() => expect(store.summary()).toEqual(payload));
    http.match((r) => r.url === '/api/summary').forEach((r) => r.flush(payload));

    // A dashboard that still shows the pre-payment overdue total after the
    // user pays is worse than no dashboard: it looks authoritative.
    TestBed.inject(PaymentsService).announceMutation();
    TestBed.tick();
    summaryRequest().flush(secondPayload);

    await vi.waitFor(() => expect(store.summary()).toEqual(secondPayload));
  });

  it('does not fetch on a mutation announced before anything was loaded', async () => {
    const store = TestBed.inject(SummaryStore);
    TestBed.inject(BillsStore).announceMutation();
    TestBed.tick();

    // The observable consequence of not fetching: `loading` never flips
    // true, because the effect's untracked read of `loaded` is false and
    // the guard short-circuits before a fetch cycle can begin.
    expect(store.loading()).toBe(false);
    http.expectNone((r) => r.url === '/api/summary');
  });

  it('empties itself when the session ends', async () => {
    const store = TestBed.inject(SummaryStore);
    const loading = store.load();
    summaryRequest().flush(payload);
    await loading;

    // Drain the effect's first execution, so the reset below depends on
    // `session.clear()` actually running the session effect, rather than
    // on this effect having been declared before the mutation-watching
    // one and so happening to zero `loadedState` during their shared
    // first flush.
    TestBed.tick();
    await vi.waitFor(() => expect(store.summary()).toEqual(payload));
    http.match((r) => r.url === '/api/summary').forEach((r) => r.flush(payload));

    TestBed.inject(SessionService).clear();
    TestBed.tick();

    expect(store.summary()).toBeNull();
    expect(store.loaded()).toBe(false);
  });

  // Task 9. An Angular effect runs its body once on its first flush
  // regardless of what it read, so a test whose first flush happens to
  // land after `load()` has already resolved would observe a fetch that
  // had nothing to do with the counter it meant to exercise. These two
  // tests force the first flush to settle BEFORE the mutation they care
  // about, so a passing result cannot be explained by that bug.
  it('refetches when a bill mutation is recorded', async () => {
    const store = TestBed.inject(SummaryStore);
    const bills = TestBed.inject(BillsStore);

    const loading = store.load();
    summaryRequest().flush(payload);
    await loading;

    // The mandatory first flush of the mutation-watching effect fires
    // unconditionally here, because `loadedState` has already gone true
    // by the time it lands — drain it as a known artifact so it cannot be
    // confused with the mutation-triggered fetch asserted below.
    await TestBed.inject(ApplicationRef).whenStable();
    http.match((r) => r.url === '/api/summary').forEach((r) => r.flush(payload));
    await TestBed.inject(ApplicationRef).whenStable();
    http.expectNone((r) => r.url === '/api/summary');

    bills.announceMutation();
    await TestBed.inject(ApplicationRef).whenStable();

    // At least one literal expect(): apps/web/.oxlintrc.json does not
    // treat http.expectOne as an assertion.
    const pending = http.match((r) => r.url === '/api/summary');
    expect(pending).toHaveLength(1);
    pending[0].flush(payload);
  });

  it('does not refetch when no counter has moved', async () => {
    const store = TestBed.inject(SummaryStore);

    const loading = store.load();
    summaryRequest().flush(payload);
    await loading;

    // Drain the mandatory first flush (see the test above) before
    // checking that a second, dependency-free flush stays silent.
    await TestBed.inject(ApplicationRef).whenStable();
    http.match((r) => r.url === '/api/summary').forEach((r) => r.flush(payload));
    await TestBed.inject(ApplicationRef).whenStable();

    // The guard against the first-flush bug: a flush with nothing changed
    // must be silent.
    expect(http.match((r) => r.url === '/api/summary')).toHaveLength(0);
  });
});
