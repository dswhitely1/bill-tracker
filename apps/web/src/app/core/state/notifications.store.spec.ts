import { ApplicationRef, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NotificationItem, NotificationListResponse } from '@bill-tracker/shared-types';
import { NotificationsStore } from './notifications.store';
import { SessionService } from '../auth/session.service';

const item = (overrides: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n1',
  kind: 'DUE_TOMORROW',
  isRead: false,
  createdAt: '2026-10-07T08:00:00.000Z',
  billInstanceId: 'bi1',
  billId: 'b1',
  billName: 'Rent',
  dueDate: '2026-10-08',
  amountDue: 1200,
  isResolved: false,
  ...overrides,
});

const response = (
  overrides: Partial<NotificationListResponse> = {},
): NotificationListResponse => ({
  items: [item()],
  unreadCount: 1,
  truncated: false,
  ...overrides,
});

let http: HttpTestingController;
let store: NotificationsStore;

// A real signal, not a plain function: the store's session-reset effect
// only re-runs when a dependency it reads actually changes, and a plain
// function is never a tracked dependency at all.
const authenticated = signal(true);

beforeEach(() => {
  authenticated.set(true);
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SessionService, useValue: { isAuthenticated: authenticated } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  store = TestBed.inject(NotificationsStore);
});

afterEach(() => {
  http.verify();
});

const stable = () => TestBed.inject(ApplicationRef).whenStable();

describe('NotificationsStore.load', () => {
  it('holds the items and the unread count', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(response());
    await loading;

    expect(store.items()).toHaveLength(1);
    expect(store.unreadCount()).toBe(1);
    expect(store.truncated()).toBe(false);
  });

  it('does not fetch a second time unless forced', async () => {
    const first = store.load();
    http.expectOne('/api/notifications').flush(response());
    await first;

    await store.load();
    expect(http.match('/api/notifications')).toHaveLength(0);

    const forced = store.load(true);
    const requests = http.match('/api/notifications');
    expect(requests).toHaveLength(1);
    requests[0].flush(response());
    await forced;
  });

  it('surfaces a failure as a message rather than throwing', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush('nope', { status: 500, statusText: 'Error' });
    await loading;

    expect(store.error()).not.toBeNull();
    expect(store.loading()).toBe(false);
  });
});

describe('NotificationsStore.recent', () => {
  it('offers at most five, newest first as the server returned them', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(
      response({
        items: Array.from({ length: 8 }, (_, i) => item({ id: `n${i}`, billName: `Bill ${i}` })),
        unreadCount: 8,
      }),
    );
    await loading;

    expect(store.recent()).toHaveLength(5);
    expect(store.recent()[0].billName).toBe('Bill 0');
  });

  it('offers everything when there are fewer than five', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(response());
    await loading;

    expect(store.recent()).toHaveLength(1);
  });
});

describe('NotificationsStore.markRead', () => {
  it('marks the row read and decrements the count without refetching', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(
      response({
        items: [item({ id: 'n1' }), item({ id: 'n2' })],
        unreadCount: 2,
      }),
    );
    await loading;

    const marking = store.markRead('n1');
    http.expectOne('/api/notifications/n1/read').flush(null);
    await marking;

    // Patched locally: the server returns no body, and refetching the
    // whole list to learn one row would throw away the rest.
    expect(store.items().find((i) => i.id === 'n1')?.isRead).toBe(true);
    expect(store.items().find((i) => i.id === 'n2')?.isRead).toBe(false);
    expect(store.unreadCount()).toBe(1);
  });

  it('does not decrement twice for a row already read', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(
      // Two rows, one already read. Only n2 is counted — and the count
      // must start above zero, or Math.max(0, …) clamps the missing
      // guard away and the test cannot tell a guarded decrement from an
      // unguarded one.
      response({
        items: [item({ id: 'n1', isRead: true }), item({ id: 'n2' })],
        unreadCount: 1,
      }),
    );
    await loading;

    const marking = store.markRead('n1');
    http.expectOne('/api/notifications/n1/read').flush(null);
    await marking;

    expect(store.unreadCount()).toBe(1);
  });

  it('never drives the count below zero', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(
      // A resolved-but-unread row is in `items` yet excluded from the
      // count, so naive decrementing would go negative. n2 is the one
      // row actually being counted, and the count starts above zero for
      // the same reason as the test above.
      response({
        items: [item({ id: 'n1', isResolved: true }), item({ id: 'n2' })],
        unreadCount: 1,
      }),
    );
    await loading;

    const marking = store.markRead('n1');
    http.expectOne('/api/notifications/n1/read').flush(null);
    await marking;

    expect(store.unreadCount()).toBe(1);
  });

  it('leaves the row alone when the request fails', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(response());
    await loading;

    const marking = store.markRead('n1');
    http
      .expectOne('/api/notifications/n1/read')
      .flush('nope', { status: 500, statusText: 'Error' });
    await marking;

    expect(store.items()[0].isRead).toBe(false);
    expect(store.unreadCount()).toBe(1);
    expect(store.error()).not.toBeNull();
  });
});

describe('NotificationsStore.markAllRead', () => {
  it('reads every row and zeroes the count', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(
      response({ items: [item({ id: 'n1' }), item({ id: 'n2' })], unreadCount: 2 }),
    );
    await loading;

    const marking = store.markAllRead();
    http.expectOne('/api/notifications/read-all').flush({ updated: 2 });
    await marking;

    expect(store.items().every((i) => i.isRead)).toBe(true);
    expect(store.unreadCount()).toBe(0);
  });
});

describe('NotificationsStore stale-response guard', () => {
  it('does not let an out-of-order stale list response undo a mark-read', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(
      response({ items: [item({ id: 'n1' }), item({ id: 'n2' })], unreadCount: 2 }),
    );
    await loading;

    // A refresh goes out — this is what visibilitychange does — and it is
    // still in flight when the user clicks a reminder.
    const first = store.refresh();
    const staleList = http.expectOne('/api/notifications');

    const marking = store.markRead('n1');
    http.expectOne('/api/notifications/n1/read').flush(null);
    await marking;

    // A second refresh goes out before the first one has resolved — e.g.
    // the tab is switched to and from again — and its response, reflecting
    // the mark-read that already landed on the server, arrives first.
    const second = store.refresh();
    const freshList = http.expectOne('/api/notifications');
    freshList.flush(
      response({ items: [item({ id: 'n1', isRead: true }), item({ id: 'n2' })], unreadCount: 1 }),
    );
    await second;

    // Only now does the first, now-stale request land, out of order,
    // still carrying n1 as unread. Without the generation guard this is
    // the response fetch() would apply last, undoing the mark-read a
    // second time even though the server has long since caught up.
    staleList.flush(
      response({ items: [item({ id: 'n1' }), item({ id: 'n2' })], unreadCount: 2 }),
    );
    await first;

    expect(store.items().find((i) => i.id === 'n1')?.isRead).toBe(true);
    expect(store.unreadCount()).toBe(1);
  });

  it('does not let an in-flight list response undo a mark-read', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(
      response({ items: [item({ id: 'n1' }), item({ id: 'n2' })], unreadCount: 2 }),
    );
    await loading;

    // One refresh in flight — what visibilitychange does — and no second
    // fetch to bump the generation. Only the mark-read's own bump, on its
    // success path, can invalidate this response.
    const refreshing = store.refresh();
    const inFlight = http.expectOne('/api/notifications');

    const marking = store.markRead('n1');
    http.expectOne('/api/notifications/n1/read').flush(null);
    await marking;

    // Only now does the in-flight list response land, still carrying n1 as
    // unread — the request was issued before the mark-read landed.
    inFlight.flush(
      response({ items: [item({ id: 'n1' }), item({ id: 'n2' })], unreadCount: 2 }),
    );
    await refreshing;

    expect(store.items().find((i) => i.id === 'n1')?.isRead).toBe(true);
    expect(store.unreadCount()).toBe(1);
  });
});

describe('NotificationsStore session reset', () => {
  it('drops everything when the session ends', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(response());
    await loading;

    authenticated.set(false);
    await TestBed.inject(ApplicationRef).whenStable();

    expect(store.items()).toHaveLength(0);
    expect(store.unreadCount()).toBe(0);
  });
});

describe('NotificationsStore visibility refresh', () => {
  it('refetches when the tab becomes visible again', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(response());
    await loading;
    await stable();

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await stable();

    const requests = http.match('/api/notifications');
    expect(requests).toHaveLength(1);
    requests[0].flush(response());
  });

  it('does not refetch as the tab is being hidden', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(response());
    await loading;
    await stable();

    // Without the visibilityState guard, every switch away from the tab
    // costs a request.
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await stable();

    expect(http.match('/api/notifications')).toHaveLength(0);
  });

  it('does not refetch before anything has been loaded', async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await stable();

    expect(http.match('/api/notifications')).toHaveLength(0);
  });
});
