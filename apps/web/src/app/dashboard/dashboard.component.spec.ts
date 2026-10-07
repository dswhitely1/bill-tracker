import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SummaryResponse } from '@bill-tracker/shared-types';
import { SessionService } from '../core/auth/session.service';
import { DashboardComponent } from './dashboard.component';

let http: HttpTestingController;

const payload: SummaryResponse = {
  asOf: '2026-10-15',
  overdue: { count: 2, amount: 450, earliestDueDate: '2026-09-01' },
  thisMonth: { count: 4, total: 1000, paid: 250 },
  next7Days: { count: 1, amount: 120 },
  byCategory: [
    { categoryId: 'cat-1', categoryName: 'Utilities', color: '#112233', total: 600, paid: 200 },
    { categoryId: null, categoryName: null, color: null, total: 400, paid: 50 },
  ],
};

function summaryRequest() {
  return http.expectOne((r) => r.url === '/api/summary');
}

/**
 * `SummaryStore`'s mutation-watching effect reads its own `loaded` flag
 * `untracked`, so reacting to it does not also depend on it — but that
 * guard only protects *reruns*. The effect's own first run is scheduled,
 * not synchronous, and if the store's fetch has already resolved by the
 * time that first run happens, the effect sees `loaded() === true` on
 * what it thinks is a plain dependency-registration pass and fires an
 * unsolicited second `GET /api/summary` (see `upcoming.component.spec.ts`
 * for the same race against the same store). The extra `whenStable()`
 * before flushing lets that first, dependency-registering pass run while
 * `loaded()` is still false, avoiding it.
 */
async function render(body: SummaryResponse = payload) {
  const fixture = TestBed.createComponent(DashboardComponent);
  await fixture.whenStable();
  summaryRequest().flush(body);
  await fixture.whenStable();
  await fixture.whenStable();
  return fixture;
}

function hrefs(fixture: { nativeElement: HTMLElement }): string[] {
  return [...fixture.nativeElement.querySelectorAll('a')].map((a) => a.getAttribute('href') ?? '');
}

/** Scopes an assertion to one card, found by its title, rather than the whole document. */
function cardText(fixture: { nativeElement: HTMLElement }, title: string): string {
  const titles = [...fixture.nativeElement.querySelectorAll('mat-card-title')];
  const match = titles.find((el) => el.textContent?.trim() === title);
  return match?.closest('mat-card')?.textContent ?? '';
}

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [DashboardComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
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

describe('DashboardComponent figures', () => {
  it('shows the overdue count and total', async () => {
    const fixture = await render();
    const text = cardText(fixture, 'Overdue');
    expect(text).toContain('$450.00');
    expect(text).toContain('2 bill(s) past due');
  });

  it('shows this month’s total and how much of it is paid', async () => {
    const fixture = await render();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('$1,000.00');
    expect(text).toContain('$250.00');
  });

  it('shows the next seven days', async () => {
    const fixture = await render();
    expect(fixture.nativeElement.textContent).toContain('$120.00');
  });

  it('names an uncategorized group rather than rendering a blank label', async () => {
    const fixture = await render();
    expect(fixture.nativeElement.textContent).toContain('Uncategorized');
    expect(fixture.nativeElement.textContent).toContain('Utilities');
  });

  it('renders zero figures as money, never as null or NaN', async () => {
    const empty: SummaryResponse = {
      asOf: '2026-10-15',
      overdue: { count: 0, amount: 0, earliestDueDate: null },
      thisMonth: { count: 0, total: 0, paid: 0 },
      next7Days: { count: 0, amount: 0 },
      byCategory: [],
    };
    const fixture = await render(empty);

    const overdue = cardText(fixture, 'Overdue');
    const month = cardText(fixture, 'Due this month');
    const next7 = cardText(fixture, 'Next 7 days');

    expect(overdue).toContain('$0.00');
    // Both the total and the paid-so-far figure render here; a single
    // `toContain` would pass even if one of the two were blank or NaN.
    expect((month.match(/\$0\.00/g) ?? []).length).toBe(2);
    expect(next7).toContain('$0.00');

    const text: string = fixture.nativeElement.textContent;
    expect(text).not.toContain('NaN');
    expect(text).not.toContain('null');
  });
});

describe('DashboardComponent links', () => {
  it('links the overdue card to the overdue filter', async () => {
    const fixture = await render();
    expect(hrefs(fixture).some((h) => h.includes('/upcoming') && h.includes('overdue=true'))).toBe(
      true,
    );
  });

  it('starts the overdue link at the oldest overdue row when it is inside the cap', async () => {
    const fixture = await render();
    const link = hrefs(fixture).find((h) => h.includes('overdue=true')) ?? '';
    expect(link).toContain('from=2026-09-01');
    expect(link).toContain('to=2026-10-15');
  });

  it('clamps the overdue link to the API’s range cap when the debt is older', async () => {
    const fixture = await render({
      ...payload,
      overdue: { count: 5, amount: 900, earliestDueDate: '2019-01-01' },
    });
    const link = hrefs(fixture).find((h) => h.includes('overdue=true')) ?? '';

    // 400 days before 2026-10-15. The card still states the full figure;
    // /upcoming discloses what it cannot show.
    expect(link).toContain('from=2025-09-10');
  });

  it('does not link the overdue card when nothing is overdue', async () => {
    const fixture = await render({
      ...payload,
      overdue: { count: 0, amount: 0, earliestDueDate: null },
    });
    expect(hrefs(fixture).some((h) => h.includes('overdue=true'))).toBe(false);
  });

  it('links the next-seven-days card to a seven-day range', async () => {
    const fixture = await render();
    const link = hrefs(fixture).find((h) => h.includes('from=2026-10-15')) ?? '';
    expect(link).toContain('to=2026-10-21');
  });

  it('links the month card to the calendar month', async () => {
    const fixture = await render();
    // The month card's own link has neither `categoryId` (a category row)
    // nor `overdue=true` nor the next-7-days' `from` — ruling those out
    // leaves only this card's link, which shares its date computation
    // with every category row.
    const link =
      hrefs(fixture).find(
        (h) =>
          h.includes('/upcoming') &&
          !h.includes('categoryId') &&
          !h.includes('overdue=true') &&
          !h.includes('from=2026-10-15'),
      ) ?? '';
    expect(link).toContain('from=2026-10-01');
    expect(link).toContain('to=2026-10-31');
  });

  it('links a category row to that category', async () => {
    const fixture = await render();
    const link = hrefs(fixture).find((h) => h.includes('categoryId=cat-1')) ?? '';
    expect(link).not.toBe('');
    // Same start/end-of-month computation the month card itself uses.
    expect(link).toContain('from=2026-10-01');
    expect(link).toContain('to=2026-10-31');
  });

  it('links the uncategorized row to the no-category sentinel', async () => {
    const fixture = await render();
    expect(hrefs(fixture).some((h) => h.includes('categoryId=none'))).toBe(true);
  });
});

describe('DashboardComponent states', () => {
  it('reports a failure instead of rendering empty cards', async () => {
    const fixture = TestBed.createComponent(DashboardComponent);
    await fixture.whenStable();
    summaryRequest().flush(
      { statusCode: 500, error: 'Internal Server Error', message: 'boom' },
      { status: 500, statusText: 'Internal Server Error' },
    );
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
  });
});

describe('DashboardComponent refetch', () => {
  it('refetches the summary on every mount, even when the store already had it loaded', async () => {
    // Gate 2. `SummaryStore.load()` unforced is a no-op once `loaded` is
    // true, and its only invalidation is the two mutation counters, which
    // do not fire when the browser's day turns over. `/upcoming` refetches
    // on window focus when the day changes; this screen must not rely on a
    // stale cache instead, or its Overdue card can disagree with
    // `/upcoming`'s badges by a day after an overnight tab.
    //
    // Simulated here by mounting the component twice against the same
    // (root-scoped) `SummaryStore` — standing in for leaving /dashboard,
    // visiting another screen, and coming back, which reuses the store but
    // not the component.
    const first = await render();
    expect(first.nativeElement.textContent).toContain('2 bill(s) past due');

    const second = TestBed.createComponent(DashboardComponent);
    await second.whenStable();
    summaryRequest().flush({
      ...payload,
      overdue: { count: 5, amount: 999, earliestDueDate: '2026-10-01' },
    });
    await second.whenStable();
    await second.whenStable();

    expect(second.nativeElement.textContent).toContain('5 bill(s) past due');
  });
});
