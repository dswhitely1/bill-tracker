import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../auth/session.service';
import { BillsStore } from './bills.store';

let http: HttpTestingController;
let store: BillsStore;
let session: SessionService;

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
  store = TestBed.inject(BillsStore);
});

afterEach(() => {
  http.verify();
});

async function seed() {
  const loaded = store.load();
  http.expectOne((r) => r.url === '/api/bills').flush([rent]);
  await loaded;
}

describe('load', () => {
  it('fills the store and reports emptiness only after a successful load', async () => {
    expect(store.isEmpty()).toBe(false);
    await seed();

    expect(store.bills()).toEqual([rent]);
    expect(store.isEmpty()).toBe(false);
  });

  it('reports an empty account as empty', async () => {
    const loaded = store.load();
    http.expectOne((r) => r.url === '/api/bills').flush([]);
    await loaded;

    expect(store.isEmpty()).toBe(true);
  });
});

describe('get', () => {
  it('reads one bill without disturbing the list', async () => {
    await seed();

    const fetched = store.get('bill-1');
    http.expectOne('/api/bills/bill-1').flush(rent);

    expect(await fetched).toEqual(rent);
    expect(store.bills()).toEqual([rent]);
  });
});

describe('the mutations counter', () => {
  it('starts at zero', () => {
    expect(store.mutations()).toBe(0);
  });

  it('increments on create, because the server generates instances synchronously', async () => {
    await seed();
    const before = store.mutations();

    const created = store.create({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-01-01',
    });
    http.expectOne((r) => r.url === '/api/bills').flush({ ...rent, id: 'bill-2', name: 'Water' });
    await created;

    expect(store.mutations()).toBe(before + 1);
    expect(store.bills()).toHaveLength(2);
  });

  it('increments on update, because a template edit rewrites future instances', async () => {
    await seed();
    const before = store.mutations();

    const updated = store.update('bill-1', { defaultAmount: 1300 });
    http.expectOne('/api/bills/bill-1').flush({ ...rent, defaultAmount: 1300 });
    await updated;

    expect(store.mutations()).toBe(before + 1);
    expect(store.bills()[0].defaultAmount).toBe(1300);
  });

  it('increments on delete, because the delete cascades through instances', async () => {
    await seed();
    const before = store.mutations();

    const removed = store.remove('bill-1');
    http.expectOne('/api/bills/bill-1').flush(null);
    await removed;

    expect(store.mutations()).toBe(before + 1);
    expect(store.bills()).toEqual([]);
  });

  it('does not increment when a mutation fails', async () => {
    // Nothing changed on the server, so nothing downstream is stale.
    await seed();
    const before = store.mutations();

    const updated = store.update('bill-1', { defaultAmount: -1 });
    http
      .expectOne('/api/bills/bill-1')
      .flush({ message: ['bad'] }, { status: 400, statusText: 'Bad Request' });
    await expect(updated).rejects.toBeDefined();

    expect(store.mutations()).toBe(before);
  });
});

describe('session lifecycle', () => {
  it('empties itself when the session ends', async () => {
    await seed();

    session.clear();
    TestBed.tick();

    expect(store.bills()).toEqual([]);
  });
});
