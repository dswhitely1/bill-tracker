import { ApplicationRef, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NotificationItem, UserProfile } from '@bill-tracker/shared-types';
import { NotificationsComponent } from './notifications.component';
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
      provideZonelessChangeDetection(),
      // A route for /upcoming must resolve: the reminder link's anchor is
      // a real `routerLink`, and clicking it (as the "marks a reminder
      // read" test does) drives actual navigation. An empty route table
      // would leave that navigation rejecting with "cannot match any
      // routes", which surfaces as an unhandled rejection rather than a
      // test failure.
      provideRouter([{ path: 'upcoming', children: [] }]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      {
        provide: SessionService,
        useValue: { isAuthenticated: () => true, user },
      },
    ],
  });
  http = TestBed.inject(HttpTestingController);
});

const render = async (items: NotificationItem[], extra: Partial<{ truncated: boolean }> = {}) => {
  const fixture = TestBed.createComponent(NotificationsComponent);
  fixture.detectChanges();
  http.expectOne('/api/notifications').flush({
    items,
    unreadCount: items.filter((i) => !i.isRead && !i.isResolved).length,
    truncated: extra.truncated ?? false,
  });
  await TestBed.inject(ApplicationRef).whenStable();
  fixture.detectChanges();
  return fixture;
};

const text = (fixture: { nativeElement: HTMLElement }): string =>
  fixture.nativeElement.textContent ?? '';

describe('NotificationsComponent', () => {
  it('lists each reminder with its horizon, bill, date, and balance', async () => {
    const fixture = await render([item()]);

    expect(text(fixture)).toContain('Due tomorrow');
    expect(text(fixture)).toContain('Rent');
    expect(text(fixture)).toContain('$1,200.00');
  });

  it('links a reminder to the row it is about', async () => {
    const fixture = await render([item()]);

    const link = fixture.nativeElement.querySelector(
      '[data-testid="notification-link"]',
    );
    expect(link?.getAttribute('href')).toContain('billId=b1');
  });

  it('marks a reminder read when its link is followed', async () => {
    const fixture = await render([item()]);

    fixture.nativeElement
      .querySelector('[data-testid="notification-link"]')
      ?.click();
    await TestBed.inject(ApplicationRef).whenStable();

    const request = http.expectOne('/api/notifications/n1/read');
    expect(request.request.method).toBe('POST');
    request.flush(null);
  });

  it('distinguishes a read reminder from an unread one', async () => {
    const fixture = await render([item({ id: 'n1' }), item({ id: 'n2', isRead: true })]);

    const rows = fixture.nativeElement.querySelectorAll('[data-testid="notification-row"]');
    expect(rows[0].classList.contains('unread')).toBe(true);
    expect(rows[1].classList.contains('unread')).toBe(false);
  });

  it('says a reminder is settled once its bill is paid', async () => {
    const fixture = await render([item({ isResolved: true, amountDue: 0 })]);

    // Without this the row reads "$0.00 due", which looks like a bug
    // rather than like a bill that has been paid.
    expect(text(fixture)).toContain('Paid');
  });

  it('clears everything with one action', async () => {
    const fixture = await render([item({ id: 'n1' }), item({ id: 'n2' })]);

    fixture.nativeElement
      .querySelector('[data-testid="mark-all-read"]')
      ?.click();
    await TestBed.inject(ApplicationRef).whenStable();

    const request = http.expectOne('/api/notifications/read-all');
    expect(request.request.method).toBe('POST');
    request.flush({ updated: 2 });
  });

  it('offers no clear-all action when nothing is unread', async () => {
    const fixture = await render([item({ isRead: true })]);

    expect(
      fixture.nativeElement.querySelector('[data-testid="mark-all-read"]'),
    ).toBeNull();
  });

  it('says so when the server capped the list', async () => {
    const fixture = await render([item()], { truncated: true });

    expect(text(fixture)).toContain('most recent 200');
  });

  it('says there is nothing rather than showing a bare page', async () => {
    const fixture = await render([]);

    expect(text(fixture)).toContain('No reminders yet');
  });

  it('explains that reminders are off rather than claiming there are none', async () => {
    user.set(profile({ notifyInApp: false }));
    const fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();

    // "No reminders" would be false and is exactly the wrong thing to
    // tell someone about their bills.
    expect(text(fixture)).toContain('turned off');
    expect(text(fixture)).not.toContain('No reminders yet');
    expect(
      fixture.nativeElement.querySelector('[data-testid="to-settings"]'),
    ).not.toBeNull();
  });
});
