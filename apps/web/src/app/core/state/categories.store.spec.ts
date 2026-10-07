import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../auth/session.service';
import { CategoriesStore } from './categories.store';

let http: HttpTestingController;
let store: CategoriesStore;
let session: SessionService;

const utilities = { id: 'cat-1', name: 'Utilities', color: '#2f80ed' };
const housing = { id: 'cat-2', name: 'Housing', color: null };

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
  store = TestBed.inject(CategoriesStore);
});

afterEach(() => {
  http.verify();
});

describe('load', () => {
  it('fills the store', async () => {
    const loaded = store.load();
    http.expectOne('/api/categories').flush([utilities, housing]);
    await loaded;

    expect(store.categories()).toEqual([utilities, housing]);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('does not report emptiness before the first load has finished', async () => {
    // Review Focus 4. A length check alone renders "you have none" during
    // the first load, and a list a moment later, which reads as a bug.
    expect(store.isEmpty()).toBe(false);

    const loaded = store.load();
    expect(store.isEmpty()).toBe(false);
    expect(store.loading()).toBe(true);

    http.expectOne('/api/categories').flush([]);
    await loaded;

    expect(store.isEmpty()).toBe(true);
  });

  it('does not refetch on a second call', async () => {
    const first = store.load();
    http.expectOne('/api/categories').flush([utilities]);
    await first;

    await store.load();
    expect(http.match('/api/categories')).toHaveLength(0);
  });

  it('refetches when forced', async () => {
    const first = store.load();
    http.expectOne('/api/categories').flush([utilities]);
    await first;

    const second = store.load(true);
    http.expectOne('/api/categories').flush([utilities, housing]);
    await second;

    expect(store.categories()).toHaveLength(2);
  });

  it('records a readable error and stops loading when the request fails', async () => {
    const loaded = store.load();
    http.expectOne('/api/categories').flush(null, { status: 0, statusText: 'Unknown Error' });
    await loaded;

    expect(store.error()).toContain('Cannot reach the server');
    expect(store.loading()).toBe(false);
    // A failed load is not an empty list, and must not render as one.
    expect(store.isEmpty()).toBe(false);
  });

  it('retries after a failure, since the first attempt did not mark it loaded', async () => {
    const failed = store.load();
    http.expectOne('/api/categories').flush(null, { status: 500, statusText: 'Server Error' });
    await failed;

    const retried = store.load();
    http.expectOne('/api/categories').flush([utilities]);
    await retried;

    expect(store.categories()).toEqual([utilities]);
    expect(store.error()).toBeNull();
  });
});

describe('mutations', () => {
  async function seed() {
    const loaded = store.load();
    http.expectOne('/api/categories').flush([utilities]);
    await loaded;
  }

  it('appends a created category from the response, without refetching', async () => {
    await seed();

    const created = store.create({ name: 'Insurance' });
    http.expectOne('/api/categories').flush({ id: 'cat-3', name: 'Insurance', color: null });
    await created;

    expect(store.categories().map((c) => c.name)).toEqual(['Utilities', 'Insurance']);
    expect(http.match('/api/categories')).toHaveLength(0);
  });

  it('replaces an updated category in place', async () => {
    await seed();

    const updated = store.update('cat-1', { name: 'Power' });
    http.expectOne('/api/categories/cat-1').flush({ ...utilities, name: 'Power' });
    await updated;

    expect(store.categories()[0].name).toBe('Power');
    expect(store.categories()).toHaveLength(1);
  });

  it('drops a removed category', async () => {
    await seed();

    const removed = store.remove('cat-1');
    http.expectOne('/api/categories/cat-1').flush(null);
    await removed;

    expect(store.categories()).toEqual([]);
  });

  it('leaves the list untouched when a delete is refused with 409', async () => {
    // The category is still in use. Removing it locally would show a row
    // disappearing that the server still holds.
    await seed();

    const removed = store.remove('cat-1');
    http
      .expectOne('/api/categories/cat-1')
      .flush({ message: 'This category is used by 3 bill(s).' }, {
        status: 409,
        statusText: 'Conflict',
      });

    await expect(removed).rejects.toBeDefined();
    expect(store.categories()).toEqual([utilities]);
  });

  it('rejects rather than swallowing a failed create, so the form can show why', async () => {
    await seed();

    const created = store.create({ name: '' });
    http.expectOne('/api/categories').flush(
      { message: ['name should not be empty'], errors: { name: ['name should not be empty'] } },
      { status: 400, statusText: 'Bad Request' },
    );

    await expect(created).rejects.toBeDefined();
    expect(store.categories()).toEqual([utilities]);
  });
});

describe('session lifecycle', () => {
  it('empties itself when the session ends', async () => {
    const loaded = store.load();
    http.expectOne('/api/categories').flush([utilities]);
    await loaded;

    session.clear();
    TestBed.tick();

    expect(store.categories()).toEqual([]);
  });

  it('loads again for the next session rather than serving the previous one', async () => {
    const loaded = store.load();
    http.expectOne('/api/categories').flush([utilities]);
    await loaded;

    session.clear();
    TestBed.tick();
    session.signIn({ accessToken: 'token-2', user: { ...profile, id: 'user-2' } });

    const reloaded = store.load();
    http.expectOne('/api/categories').flush([housing]);
    await reloaded;

    expect(store.categories()).toEqual([housing]);
  });
});
