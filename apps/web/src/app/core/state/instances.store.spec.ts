import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApplicationRef, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../auth/session.service';
import { BillsStore } from './bills.store';
import { InstancesStore, MAX_RANGE_DAYS, rangeError } from './instances.store';

let http: HttpTestingController;
let store: InstancesStore;
let bills: BillsStore;
let session: SessionService;

const instance = {
  id: 'inst-1',
  billId: 'bill-1',
  billName: 'Rent',
  categoryId: 'cat-1',
  dueDate: '2026-10-01',
  amount: 1200,
  amountPaid: 0,
  status: 'UNPAID' as const,
  isOverdue: true,
  isCustomized: false,
  paidAt: null,
  note: null,
};

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada',
  notifyEmail: true,
  notifyInApp: true,
};

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  http = TestBed.inject(HttpTestingController);
  session = TestBed.inject(SessionService);
  session.signIn({ accessToken: 'token-1', user: profile });
  bills = TestBed.inject(BillsStore);
  store = TestBed.inject(InstancesStore);
});

afterEach(() => {
  http.verify();
});

function instanceRequest() {
  return http.expectOne((r) => r.url === '/api/bill-instances');
}

describe('rangeError', () => {
  it('accepts an ordinary month', () => {
    expect(rangeError('2026-10-01', '2026-10-31')).toBeNull();
  });

  it('accepts a single day', () => {
    expect(rangeError('2026-10-01', '2026-10-01')).toBeNull();
  });

  it('accepts a difference of exactly 400 days, which is a 401-day inclusive span', () => {
    // The API compares `to` against `from + 400` days. Counting inclusive
    // days instead would reject this, and the message would describe a
    // limit the server does not enforce.
    expect(rangeError('2026-01-01', '2027-02-05')).toBeNull();
  });

  it('rejects a difference of 401 days', () => {
    expect(rangeError('2026-01-01', '2027-02-06')).toContain(String(MAX_RANGE_DAYS));
  });

  it('rejects an end date before the start', () => {
    expect(rangeError('2026-10-31', '2026-10-01')).toContain('precede');
  });

  it('rejects a malformed date', () => {
    expect(rangeError('20261001', '2026-10-31')).not.toBeNull();
    expect(rangeError('2026-02-31', '2026-10-31')).not.toBeNull();
  });
});

describe('setQuery', () => {
  it('sends the range and stores the result', async () => {
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    const req = instanceRequest();
    expect(req.request.params.get('from')).toBe('2026-10-01');
    expect(req.request.params.get('to')).toBe('2026-10-31');
    req.flush([instance]);
    await done;

    expect(store.instances()).toEqual([instance]);
    expect(store.query().from).toBe('2026-10-01');
  });

  it('refuses an over-wide range without sending anything', async () => {
    // Review Focus 2. The cap is the client's job to respect; letting the
    // request go out turns a fixable mistake into a 400.
    await store.setQuery({ from: '2026-01-01', to: '2027-06-01' });

    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
    expect(store.error()).toContain(String(MAX_RANGE_DAYS));
  });

  it('refuses a backwards range without sending anything', async () => {
    await store.setQuery({ from: '2026-10-31', to: '2026-10-01' });

    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
    expect(store.error()).toContain('precede');
  });

  it('keeps the previous rows when a new range is refused', async () => {
    const first = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush([instance]);
    await first;

    await store.setQuery({ from: '2026-01-01', to: '2027-06-01' });

    expect(store.instances()).toEqual([instance]);
  });

  it('passes the optional filters through', async () => {
    const done = store.setQuery({
      from: '2026-10-01',
      to: '2026-10-31',
      status: 'UNPAID',
      overdue: true,
      billId: 'bill-1',
    });
    const req = instanceRequest();
    expect(req.request.params.get('status')).toBe('UNPAID');
    expect(req.request.params.get('overdue')).toBe('true');
    expect(req.request.params.get('billId')).toBe('bill-1');
    req.flush([]);
    await done;
  });

  it('reports emptiness only after a load has succeeded', async () => {
    expect(store.isEmpty()).toBe(false);

    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    expect(store.isEmpty()).toBe(false);
    instanceRequest().flush([]);
    await done;

    expect(store.isEmpty()).toBe(true);
  });

  it('does not report emptiness after a failed load', async () => {
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush(null, { status: 500, statusText: 'Server Error' });
    await done;

    expect(store.isEmpty()).toBe(false);
    expect(store.error()).not.toBeNull();
  });
});

describe('overlapping fetches', () => {
  it('keeps the latest request authoritative when an older, superseded request resolves later', async () => {
    // Item 3. Two range changes in flight at once — clicking `>` twice
    // quickly, or `>` then Today — and the *older* request's response
    // happens to land after the *newer* one has already started. Without a
    // generation guard, whichever response arrives last wins regardless of
    // which request was actually issued last.
    const first = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    const reqA = instanceRequest();
    const second = store.setQuery({ from: '2026-11-01', to: '2026-11-30' });
    const reqB = instanceRequest();

    // A, the older and now-superseded request, resolves first.
    reqA.flush([instance]);
    await first;

    // Its response must be dropped, and it must not clear `loading` while
    // B — the still-authoritative, still in-flight request — has not yet
    // settled.
    expect(store.instances()).toEqual([]);
    expect(store.loading()).toBe(true);

    reqB.flush([{ ...instance, id: 'nov' }]);
    await second;

    expect(store.instances()).toEqual([{ ...instance, id: 'nov' }]);
    expect(store.loading()).toBe(false);
  });
});

describe('fetchedOn', () => {
  it('is set only once a fetch has actually succeeded', async () => {
    expect(store.fetchedOn()).toBeNull();

    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    expect(store.fetchedOn()).toBeNull();
    instanceRequest().flush([instance]);
    await done;

    expect(store.fetchedOn()).not.toBeNull();
  });

  it('is left untouched by a range refused before it reaches the server', async () => {
    // A component that bumped its own day marker before calling
    // `setQuery` would be fooled into skipping a refetch here. The store
    // owning the marker, and only advancing it on success, is what keeps
    // a refused range from being mistaken for a fresh one.
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush([instance]);
    await done;
    const fetchedOn = store.fetchedOn();

    await store.setQuery({ from: '2026-01-01', to: '2027-06-01' });

    expect(store.fetchedOn()).toBe(fetchedOn);
  });

  it('is cleared when the session ends', async () => {
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush([instance]);
    await done;

    session.clear();
    TestBed.tick();

    expect(store.fetchedOn()).toBeNull();
  });
});

describe('patch', () => {
  it('replaces one row in place', async () => {
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush([instance]);
    await done;

    store.patch({ ...instance, status: 'PAID', amountPaid: 1200 });

    expect(store.instances()[0].status).toBe('PAID');
    expect(store.instances()).toHaveLength(1);
    // No follow-up read: the payment endpoints already returned the row.
    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
  });

  it('ignores a row that is not in the current range', async () => {
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush([instance]);
    await done;

    store.patch({ ...instance, id: 'inst-999' });

    expect(store.instances()).toHaveLength(1);
    expect(store.instances()[0].id).toBe('inst-1');
  });
});

describe('invalidation by template changes', () => {
  it('refetches when a bill is created, updated, or deleted', async () => {
    // The server generates, rewrites, and cascades. None of it is
    // predictable here, so the only correct answer is to ask again.
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush([instance]);
    await done;

    const created = bills.create({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-10-01',
    });
    http.expectOne((r) => r.url === '/api/bills').flush({
      id: 'bill-2',
      categoryId: null,
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-10-01',
      endDate: null,
      isActive: true,
    });
    await created;
    TestBed.tick();

    instanceRequest().flush([instance, { ...instance, id: 'inst-2', billName: 'Water' }]);

    // The refetch is started from inside an effect, so it settles a few
    // microtasks later than the flush.
    await vi.waitFor(() => expect(store.instances()).toHaveLength(2));
  });

  it('does not refetch before any range has been loaded', () => {
    bills.create({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-10-01',
    });
    http.expectOne((r) => r.url === '/api/bills').flush({
      id: 'bill-2',
      categoryId: null,
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-10-01',
      endDate: null,
      isActive: true,
    });
    TestBed.tick();

    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
  });

  // Task 9. An Angular effect runs its body once on its first flush
  // regardless of what it read, so a test whose first flush happens to
  // land after a range had already loaded would observe a refetch that
  // had nothing to do with the counter it meant to exercise. These two
  // tests force the first flush to settle BEFORE the mutation they care
  // about, so a passing result cannot be explained by that bug.
  it('refetches when a bill mutation is recorded', async () => {
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush([instance]);
    await done;

    // The mandatory first flush of the mutation-watching effect fires
    // unconditionally here, because `loaded` has already gone true by the
    // time it lands — drain it as a known artifact so it cannot be
    // confused with the mutation-triggered fetch asserted below.
    await TestBed.inject(ApplicationRef).whenStable();
    http.match((r) => r.url === '/api/bill-instances').forEach((r) => r.flush([instance]));
    await TestBed.inject(ApplicationRef).whenStable();
    http.expectNone((r) => r.url === '/api/bill-instances');

    bills.announceMutation();
    await TestBed.inject(ApplicationRef).whenStable();

    // At least one literal expect(): apps/web/.oxlintrc.json does not
    // treat http.expectOne as an assertion.
    const pending = http.match((r) => r.url === '/api/bill-instances');
    expect(pending).toHaveLength(1);
    pending[0].flush([instance]);
  });

  it('does not refetch when no counter has moved', async () => {
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush([instance]);
    await done;

    // Drain the mandatory first flush (see the test above) before
    // checking that a second, dependency-free flush stays silent.
    await TestBed.inject(ApplicationRef).whenStable();
    http.match((r) => r.url === '/api/bill-instances').forEach((r) => r.flush([instance]));
    await TestBed.inject(ApplicationRef).whenStable();

    // The guard against the first-flush bug: a flush with nothing changed
    // must be silent.
    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
  });
});

describe('session lifecycle', () => {
  it('empties itself when the session ends', async () => {
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush([instance]);
    await done;

    session.clear();
    TestBed.tick();

    expect(store.instances()).toEqual([]);
  });
});
