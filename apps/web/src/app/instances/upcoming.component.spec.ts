import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { provideCalendarDateAdapter } from '../core/date/calendar-date.adapter';
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
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
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
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();

    const req = instancesRequest();
    const from = req.request.params.get('from') ?? '';
    const to = req.request.params.get('to') ?? '';
    expect(from.endsWith('-01')).toBe(true);
    expect(from.slice(0, 7)).toBe(to.slice(0, 7));
    req.flush([]);
  });

  it('names the empty state rather than rendering a blank table', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Nothing due in this range');
  });

  it('shows the amount still owed on a partially paid instance', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
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
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([{ ...base, dueDate: '2099-01-01', isOverdue: true }]);
    await fixture.whenStable();
    await fixture.whenStable();

    // Query the badge itself, not page text: the filter control also says
    // "Overdue", so a textContent check is vacuously true in one direction
    // and unsatisfiable in the other.
    expect(fixture.nativeElement.querySelector('.overdue-chip')).not.toBeNull();
  });

  it('does not mark a row overdue when the server says it is not, however old it is', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([{ ...base, dueDate: '2000-01-01', isOverdue: false }]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('.overdue-chip')).toBeNull();
  });
});

describe('the range controls', () => {
  it('refuses an over-wide range with a message and sends nothing', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.rangeForm.setValue({ from: '2026-01-01', to: '2027-06-01' });
    await fixture.componentInstance.applyRange();
    await fixture.whenStable();

    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('400');
    expect(fixture.nativeElement.textContent).toContain('Rent');
  });

  it('applies a valid range', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.rangeForm.setValue({ from: '2026-11-01', to: '2026-11-30' });
    const applied = fixture.componentInstance.applyRange();
    const req = instancesRequest();
    expect(req.request.params.get('from')).toBe('2026-11-01');
    req.flush([]);
    await applied;
  });
});

describe('the day boundary', () => {
  it('refetches when the browser day has changed since the rows were rendered', async () => {
    // `isOverdue` goes stale at midnight. A tab left open overnight would
    // otherwise show yesterday's answer indefinitely.
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();
    await fixture.whenStable();

    const renderedOn = fixture.componentInstance.renderedOn();
    fixture.componentInstance.refreshIfDayChanged('2099-01-01');
    await fixture.whenStable();

    instancesRequest().flush([base]);
    expect(fixture.componentInstance.renderedOn()).toBe('2099-01-01');
    expect(renderedOn).not.toBe('2099-01-01');
  });

  it('does not refetch when the day is unchanged', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();
    await fixture.whenStable();

    fixture.componentInstance.refreshIfDayChanged(fixture.componentInstance.renderedOn());
    await fixture.whenStable();

    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
  });
});
