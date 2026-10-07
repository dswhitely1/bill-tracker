import { ApplicationRef, provideZonelessChangeDetection } from '@angular/core';
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

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SessionService, useValue: { isAuthenticated: () => true } },
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
      response({ items: [item({ id: 'n1', isRead: true })], unreadCount: 0 }),
    );
    await loading;

    const marking = store.markRead('n1');
    http.expectOne('/api/notifications/n1/read').flush(null);
    await marking;

    expect(store.unreadCount()).toBe(0);
  });

  it('never drives the count below zero', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(
      // A resolved-but-unread row is in `items` yet excluded from the
      // count, so naive decrementing would go negative.
      response({ items: [item({ id: 'n1', isResolved: true })], unreadCount: 0 }),
    );
    await loading;

    const marking = store.markRead('n1');
    http.expectOne('/api/notifications/n1/read').flush(null);
    await marking;

    expect(store.unreadCount()).toBe(0);
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
