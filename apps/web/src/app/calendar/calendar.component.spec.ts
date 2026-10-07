import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BillInstanceResponse } from '@bill-tracker/shared-types';
import { SessionService } from '../core/auth/session.service';
import { provideCalendarDateAdapter } from '../core/date/calendar-date.adapter';
import { TODAY } from '../core/date/today.token';
import { CalendarComponent } from './calendar.component';

let http: HttpTestingController;

const base: BillInstanceResponse = {
  id: 'inst-1',
  billId: 'bill-1',
  billName: 'Rent',
  categoryId: 'cat-1',
  dueDate: '2026-10-09',
  amount: 1200,
  amountPaid: 0,
  status: 'UNPAID',
  isOverdue: false,
  isCustomized: false,
  paidAt: null,
  note: null,
};

function instancesRequest() {
  return http.expectOne((r) => r.url === '/api/bill-instances');
}

/**
 * Elements `render()` has attached to `document.body` (see below), removed
 * again in `afterEach` so one test's DOM does not leak into the next.
 */
const attachedElements: HTMLElement[] = [];

/**
 * Creates the fixture and answers its constructor-time request.
 *
 * `InstancesStore` carries a mutation-watching effect that reads its own
 * `loaded` flag `untracked` so that reacting to it does not also depend on
 * it — but that guard only protects *reruns*. The effect's own first run is
 * scheduled, not synchronous, and if this request's fetch has already
 * resolved by the time that first run happens, the effect sees
 * `loaded() === true` on what it thinks is a plain dependency-registration
 * pass and fires an unsolicited second `GET /api/bill-instances` (the same
 * race documented in `upcoming.component.spec.ts` and
 * `dashboard.component.spec.ts` against this same store). The leading
 * `whenStable()` lets that first, dependency-registering pass run while
 * `loaded()` is still false, before the fetch is answered.
 *
 * The fixture's element is attached to `document.body`: `focusAfterRender`
 * calls real `.focus()` on a grid cell, and a detached element never
 * becomes `document.activeElement` in JSDOM, which would make every
 * assertion against it vacuously pass no matter what the component did.
 */
async function render(rows: BillInstanceResponse[] = [base]) {
  const fixture = TestBed.createComponent(CalendarComponent);
  document.body.appendChild(fixture.nativeElement);
  attachedElements.push(fixture.nativeElement);
  await fixture.whenStable();
  instancesRequest().flush(rows);
  await fixture.whenStable();
  await fixture.whenStable();
  return fixture;
}

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [CalendarComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      provideCalendarDateAdapter(),
      // The grid is anchored on the browser's day. Pinning it through the
      // token keeps every assertion about which cells exist stable —
      // `vi.spyOn` on a module namespace object is not reliable across
      // Vite's ESM transform, and the codebase already prefers passing the
      // day in over stubbing the clock.
      { provide: TODAY, useValue: () => '2026-10-09' },
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
  vi.restoreAllMocks();
  http.verify();
  for (const el of attachedElements.splice(0)) el.remove();
});

describe('CalendarComponent grid', () => {
  it('renders 42 day cells', async () => {
    const fixture = await render();
    expect(fixture.nativeElement.querySelectorAll('[role="gridcell"]')).toHaveLength(42);
  });

  it('exposes grid semantics so assistive technology can navigate it', async () => {
    const fixture = await render();
    expect(fixture.nativeElement.querySelector('[role="grid"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('[role="row"]').length).toBeGreaterThan(0);
    expect(fixture.nativeElement.querySelectorAll('[role="columnheader"]')).toHaveLength(7);
  });

  it('names the month it is showing', async () => {
    const fixture = await render();
    expect(fixture.nativeElement.textContent).toContain('October 2026');
  });

  it('fetches the whole visible span, not just the month', async () => {
    const fixture = TestBed.createComponent(CalendarComponent);
    const req = instancesRequest();

    // October 2026 starts on a Thursday, so the grid opens on 2026-09-27
    // and runs 42 days to 2026-11-07. Spill days that showed as empty
    // while actually holding bills would be a silent lie.
    expect(req.request.params.get('from')).toBe('2026-09-27');
    expect(req.request.params.get('to')).toBe('2026-11-07');

    // See `render()`'s comment: lets the store's mutation-watching effect
    // take its first, dependency-registering run while `loaded()` is still
    // false, before the fetch below resolves and sets it true.
    await fixture.whenStable();
    req.flush([]);
    await fixture.whenStable();
  });

  it('places a bill on its due date', async () => {
    const fixture = await render();
    const cell = fixture.nativeElement.querySelector('[data-date="2026-10-09"]');
    expect(cell.textContent).toContain('Rent');
  });

  it('dims days outside the anchored month but still shows their bills', async () => {
    const fixture = await render([{ ...base, id: 'spill', dueDate: '2026-09-28' }]);
    const cell = fixture.nativeElement.querySelector('[data-date="2026-09-28"]');
    expect(cell.closest('[role="gridcell"]').className).toContain('outside');
    expect(cell.textContent).toContain('Rent');
  });

  it('marks today', async () => {
    const fixture = await render();
    const cell = fixture.nativeElement.querySelector('[data-date="2026-10-09"]');
    expect(cell.closest('[role="gridcell"]').className).toContain('today');
  });

  it('names today in the accessible label, not only the visual outline', async () => {
    // The same reasoning as the overdue chip's `!` marker: a visual-only
    // cue (here, the `.today` CSS outline) leaves a screen-reader user with
    // no way to locate today at all.
    const fixture = await render();
    const todayLabel = fixture.nativeElement
      .querySelector('[data-date="2026-10-09"]')
      .getAttribute('aria-label');
    const otherLabel = fixture.nativeElement
      .querySelector('[data-date="2026-10-10"]')
      .getAttribute('aria-label');

    expect(todayLabel).toContain('today');
    expect(otherLabel).not.toContain('today');
  });

  it('describes each day for assistive technology, including what is on it', async () => {
    const fixture = await render([
      { ...base, id: 'a', dueDate: '2026-10-09' },
      { ...base, id: 'b', dueDate: '2026-10-09', isOverdue: true },
    ]);
    const label = fixture.nativeElement
      .querySelector('[data-date="2026-10-09"]')
      .getAttribute('aria-label');

    expect(label).toContain('October');
    expect(label).toContain('2 bills');
    expect(label).toContain('1 overdue');
  });

  it('says a day is empty rather than leaving it unlabelled', async () => {
    const fixture = await render([]);
    const label = fixture.nativeElement
      .querySelector('[data-date="2026-10-15"]')
      .getAttribute('aria-label');
    expect(label).toContain('no bills');
  });

  it('marks an overdue chip with more than colour', async () => {
    const fixture = await render([{ ...base, isOverdue: true }]);
    const chip = fixture.nativeElement.querySelector('[data-date="2026-10-09"] .chip');

    // Colour is never the only carrier of state: a greyscale printout and a
    // colour-blind reader must both still read the calendar.
    expect(chip.className).toContain('overdue');
    expect(chip.textContent).toContain('!');
  });

  it('caps the chips per day and counts the rest', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({
      ...base,
      id: `inst-${i}`,
      billName: `Bill ${i}`,
      dueDate: '2026-10-09',
    }));
    const fixture = await render(rows);
    const cell = fixture.nativeElement.querySelector('[data-date="2026-10-09"]');

    expect(cell.querySelectorAll('.chip')).toHaveLength(3);
    expect(cell.textContent).toContain('+2 more');
  });

  it('marks the selected cell with aria-selected, not aria-pressed', async () => {
    // `aria-selected` is a supported state only on roles `option`, `row`,
    // `tab`, `treeitem`, `gridcell`, `columnheader`, and `rowheader` — so it
    // belongs on the `role="gridcell"` div, not the `<button>` inside it,
    // whose implicit role is `button` and does not support it.
    // `aria-pressed` signals toggle-button state and would have been valid
    // on the button; it must appear nowhere, since selection is not a
    // toggle.
    const fixture = await render();
    const button = fixture.nativeElement.querySelector('[data-date="2026-10-09"]');
    const gridcell = button.closest('[role="gridcell"]');
    expect(gridcell.getAttribute('aria-selected')).toBe('false');
    expect(button.hasAttribute('aria-pressed')).toBe(false);
    expect(gridcell.hasAttribute('aria-pressed')).toBe(false);

    fixture.componentInstance.select('2026-10-09');
    await fixture.whenStable();
    expect(gridcell.getAttribute('aria-selected')).toBe('true');
  });
});

describe('CalendarComponent month navigation', () => {
  // Each navigation issues its request synchronously, so the request is
  // flushed *before* awaiting. Awaiting first would park `whenStable()` on
  // a pending request that nothing has answered yet.
  it('moves to the previous month and refetches its span', async () => {
    const fixture = await render();
    fixture.componentInstance.previousMonth();

    const req = instancesRequest();
    expect(req.request.params.get('from')).toBe('2026-08-30');
    req.flush([]);
    await fixture.whenStable();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('September 2026');
  });

  it('moves to the next month', async () => {
    const fixture = await render();
    fixture.componentInstance.nextMonth();
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('November 2026');
  });

  it('returns to the current month', async () => {
    const fixture = await render();
    fixture.componentInstance.nextMonth();
    instancesRequest().flush([]);
    await fixture.whenStable();

    fixture.componentInstance.goToToday();
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('October 2026');
  });
});

describe('CalendarComponent keyboard navigation', () => {
  function press(fixture: ComponentFixture<CalendarComponent>, key: string): void {
    fixture.nativeElement
      .querySelector('[role="grid"]')
      .dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }

  it('keeps exactly one cell in the tab order', async () => {
    const fixture = await render();
    const tabbable = [...fixture.nativeElement.querySelectorAll('[data-date]')].filter(
      (el: Element) => el.getAttribute('tabindex') === '0',
    );
    expect(tabbable).toHaveLength(1);
  });

  it('moves a day at a time with the left and right arrows', async () => {
    const fixture = await render();
    press(fixture, 'ArrowRight');
    await fixture.whenStable();
    expect(fixture.componentInstance.focused()).toBe('2026-10-10');

    press(fixture, 'ArrowLeft');
    await fixture.whenStable();
    expect(fixture.componentInstance.focused()).toBe('2026-10-09');
  });

  it('moves a week at a time with the up and down arrows', async () => {
    const fixture = await render();
    press(fixture, 'ArrowDown');
    await fixture.whenStable();
    expect(fixture.componentInstance.focused()).toBe('2026-10-16');

    press(fixture, 'ArrowUp');
    await fixture.whenStable();
    expect(fixture.componentInstance.focused()).toBe('2026-10-09');
  });

  it('moves to the start and end of the week', async () => {
    const fixture = await render();
    press(fixture, 'Home');
    await fixture.whenStable();
    // 2026-10-09 is a Friday; its week starts on Sunday the 4th.
    expect(fixture.componentInstance.focused()).toBe('2026-10-04');

    press(fixture, 'End');
    await fixture.whenStable();
    expect(fixture.componentInstance.focused()).toBe('2026-10-10');
  });

  it('changes month with PageUp and PageDown', async () => {
    const fixture = await render();
    press(fixture, 'PageDown');
    instancesRequest().flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.componentInstance.focused()).toBe('2026-11-09');
    expect(fixture.nativeElement.textContent).toContain('November 2026');
  });

  it('follows an arrow across a month boundary without refetching, since the spill day is already loaded', async () => {
    const fixture = await render();
    fixture.componentInstance.focus('2026-10-31');
    await fixture.whenStable();
    press(fixture, 'ArrowRight');
    await fixture.whenStable();

    // 2026-11-01 is inside the rendered grid, so no refetch is needed.
    // `http.verify()` in `afterEach` would fail if one were issued anyway.
    expect(fixture.componentInstance.focused()).toBe('2026-11-01');
  });

  // `focused()` is a signal; the roving `tabindex` is bound to that same
  // signal, so every test above is blind to whether DOM focus actually
  // moved — `focusAfterRender` could be deleted, mis-selectored, or
  // silently no-op on its optional chain, and the signal-only assertions
  // would not notice. These read `document.activeElement` instead.
  describe('real DOM focus, not just the signal', () => {
    it('moves focus to the cell within the already-rendered month', async () => {
      const fixture = await render();
      press(fixture, 'ArrowRight');
      await fixture.whenStable();

      expect(document.activeElement?.getAttribute('data-date')).toBe('2026-10-10');
    });

    it('moves focus to the newly focused cell after a month change re-renders the grid', async () => {
      // `afterNextRender` exists for exactly this case: at the moment
      // `PageDown` is handled, the target cell is not in the DOM yet — the
      // whole grid is re-rendered for the new month first.
      const fixture = await render();
      press(fixture, 'PageDown');
      instancesRequest().flush([]);
      await fixture.whenStable();
      await fixture.whenStable();

      expect(document.activeElement?.getAttribute('data-date')).toBe('2026-11-09');
    });
  });
});
