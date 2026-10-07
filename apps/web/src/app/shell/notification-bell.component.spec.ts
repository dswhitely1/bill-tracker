import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NotificationItem, UserProfile } from '@bill-tracker/shared-types';
import { NotificationBellComponent } from './notification-bell.component';
import { SessionService } from '../core/auth/session.service';

const profile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  id: 'u1',
  email: 'don@example.com',
  name: 'Don',
  notifyEmail: true,
  notifyInApp: true,
  ...overrides,
});

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

let http: HttpTestingController;
const user = signal<UserProfile | null>(profile());

beforeEach(() => {
  user.set(profile());
  TestBed.configureTestingModule({
    providers: [
      // A route for /upcoming must resolve: menu entries are real
      // `routerLink`s, and clicking one (as the "marks a reminder read"
      // test does) drives actual navigation. An empty route table leaves
      // that navigation rejecting with "cannot match any routes", which
      // surfaces as an unhandled rejection rather than a test failure.
      provideRouter([{ path: 'upcoming', children: [] }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SessionService, useValue: { isAuthenticated: () => true, user } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
});

const render = async (items: NotificationItem[]) => {
  const fixture = TestBed.createComponent(NotificationBellComponent);
  fixture.detectChanges();
  http.expectOne('/api/notifications').flush({
    items,
    unreadCount: items.filter((i) => !i.isRead && !i.isResolved).length,
    truncated: false,
  });
  await TestBed.inject(ApplicationRef).whenStable();
  fixture.detectChanges();
  return fixture;
};

const openMenu = async (fixture: { nativeElement: HTMLElement; detectChanges: () => void }) => {
  fixture.nativeElement.querySelector<HTMLButtonElement>('[data-testid="bell"]')?.click();
  await TestBed.inject(ApplicationRef).whenStable();
  fixture.detectChanges();
};

describe('NotificationBellComponent', () => {
  it('shows the unread count', async () => {
    const fixture = await render([item({ id: 'n1' }), item({ id: 'n2' })]);

    const bell = fixture.nativeElement.querySelector('[data-testid="bell"]');
    expect(bell?.getAttribute('aria-label')).toBe('Reminders, 2 unread');
  });

  it('names zero unread without a count in the label', async () => {
    const fixture = await render([item({ isRead: true })]);

    expect(
      fixture.nativeElement.querySelector('[data-testid="bell"]')?.getAttribute('aria-label'),
    ).toBe('Reminders, none unread');
  });

  it('offers at most five in the menu', async () => {
    const fixture = await render(
      Array.from({ length: 7 }, (_, i) => item({ id: `n${i}`, billName: `Bill ${i}` })),
    );
    await openMenu(fixture);

    // The overlay renders outside the fixture's own element.
    const entries = document.querySelectorAll('[data-testid="bell-item"]');
    expect(entries).toHaveLength(5);
  });

  it('links a menu entry to the row it is about and marks it read', async () => {
    const fixture = await render([item()]);
    await openMenu(fixture);

    const entry = document.querySelector<HTMLAnchorElement>('[data-testid="bell-item"]');
    expect(entry?.getAttribute('href')).toContain('billId=b1');

    entry?.click();
    await TestBed.inject(ApplicationRef).whenStable();
    http.expectOne('/api/notifications/n1/read').flush(null);
  });

  it('offers a way to the full list', async () => {
    const fixture = await render([item()]);
    await openMenu(fixture);

    const all = document.querySelector<HTMLAnchorElement>('[data-testid="bell-see-all"]');
    expect(all?.getAttribute('href')).toContain('/notifications');
  });

  it('says there is nothing rather than opening an empty menu', async () => {
    const fixture = await render([]);
    await openMenu(fixture);

    expect(document.querySelector('[data-testid="bell-empty"]')).not.toBeNull();
  });

  it('is not rendered at all when in-app reminders are off', async () => {
    user.set(profile({ notifyInApp: false }));
    const fixture = TestBed.createComponent(NotificationBellComponent);
    fixture.detectChanges();
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="bell"]')).toBeNull();
  });
});
