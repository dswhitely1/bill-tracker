import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
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
    // The observable consequence of not fetching: a fetch cycle always
    // flips `loading` true before awaiting the response, so if the second
    // `load()` had actually issued a request, this would read true (and
    // the request would still be stuck unflushed below).
    expect(store.loading()).toBe(false);
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

    // Creating a bill generates instances, which moves every card.
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

    TestBed.inject(SessionService).clear();
    TestBed.tick();

    expect(store.summary()).toBeNull();
    expect(store.loaded()).toBe(false);
  });
});
