import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { BillInstanceResponse } from '@bill-tracker/shared-types';
import { InstancesStore } from '../core/state/instances.store';
import {
  CalendarDate,
  DAY_NAMES_SHORT,
  MONTH_NAMES_LONG,
  addDays,
  addMonths,
  dayOfWeek,
  parts,
} from '../core/date/calendar-date';
import { isSameMonth, monthGrid } from '../core/date/month-grid';
import { TODAY } from '../core/date/today.token';

/** How many bills a cell shows before collapsing the rest into a count. */
const MAX_CHIPS = 3;

interface Chip {
  id: string;
  name: string;
  isOverdue: boolean;
  paid: boolean;
}

interface DayCell {
  date: CalendarDate;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  chips: Chip[];
  overflow: number;
  label: string;
}

@Component({
  selector: 'app-calendar',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule],
  template: `
    <header class="page-header">
      <h1>{{ monthLabel() }}</h1>
      <div class="nav">
        <button matIconButton type="button" aria-label="Previous month" (click)="previousMonth()">
          <mat-icon>chevron_left</mat-icon>
        </button>
        <button matButton type="button" (click)="goToToday()">Today</button>
        <button matIconButton type="button" aria-label="Next month" (click)="nextMonth()">
          <mat-icon>chevron_right</mat-icon>
        </button>
      </div>
    </header>

    @if (store.loading()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (store.error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    <div role="grid" class="grid" [attr.aria-label]="monthLabel()" (keydown)="onKeydown($event)">
      <div role="row" class="week headings">
        @for (name of weekdayNames; track name) {
          <span role="columnheader" class="weekday">{{ name }}</span>
        }
      </div>

      @for (week of weeks(); track $index) {
        <div role="row" class="week">
          @for (cell of week; track cell.date) {
            <div
              role="gridcell"
              class="cell"
              [class.outside]="!cell.inMonth"
              [class.today]="cell.isToday"
              [attr.aria-selected]="cell.date === selected()"
            >
              <button
                type="button"
                class="day"
                [attr.data-date]="cell.date"
                [attr.tabindex]="cell.date === focused() ? 0 : -1"
                [attr.aria-label]="cell.label"
                (click)="select(cell.date)"
                (focus)="focused.set(cell.date)"
              >
                <span class="daynum">{{ cell.day }}</span>
                @for (chip of cell.chips; track chip.id) {
                  <span class="chip" [class.overdue]="chip.isOverdue" [class.paid]="chip.paid">
                    @if (chip.isOverdue) {
                      <span class="marker" aria-hidden="true">!</span>
                    }
                    {{ chip.name }}
                  </span>
                }
                @if (cell.overflow > 0) {
                  <span class="more">+{{ cell.overflow }} more</span>
                }
              </button>
            </div>
          }
        </div>
      }
    </div>

    <ng-content />
  `,
  styles: `
    .nav {
      display: flex;
      align-items: center;
      gap: 0.25rem;
    }
    .week {
      display: grid;
      grid-template-columns: repeat(7, 1fr);
      gap: 2px;
    }
    .weekday {
      text-align: center;
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .day {
      display: flex;
      flex-direction: column;
      align-items: stretch;
      gap: 2px;
      width: 100%;
      min-height: 6rem;
      padding: 0.25rem;
      border: 1px solid var(--mat-sys-outline-variant);
      background: none;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .outside .day {
      opacity: 0.55;
    }
    .today .day {
      outline: 2px solid var(--mat-sys-primary);
    }
    .chip {
      font: var(--mat-sys-label-small);
      border-radius: 0.5rem;
      padding: 0 0.25rem;
      background: var(--mat-sys-surface-variant);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .chip.overdue {
      background: var(--mat-sys-error-container);
    }
    .chip.paid {
      opacity: 0.6;
      text-decoration: line-through;
    }
    .more {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CalendarComponent {
  protected readonly store = inject(InstancesStore);
  // `inject(ElementRef<HTMLElement>)`, as written in the task brief, fails
  // to typecheck under this repo's TypeScript version: `ElementRef` as a
  // generic instantiation expression used here does not resolve to a
  // constructor type `inject`'s overloads accept, so `nativeElement` comes
  // back untyped and `.querySelector<HTMLElement>()` on it is rejected
  // with TS2347 ("Untyped function calls may not accept type arguments").
  // Supplying the type parameter to `inject` directly, rather than to
  // `ElementRef`, is the form that resolves correctly.
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);

  protected readonly weekdayNames = DAY_NAMES_SHORT;

  /**
   * The browser's day, deliberately — this marks where the viewer is in the
   * month, which is a question about the viewer. Overdue state is never
   * derived from it: that always arrives on the instance as `isOverdue`,
   * computed server-side against APP_TIMEZONE.
   */
  private readonly todayDate = inject(TODAY)();

  /** Any date inside the month being shown. */
  readonly anchor = signal<CalendarDate>(this.todayDate);
  readonly focused = signal<CalendarDate>(this.todayDate);
  readonly selected = signal<CalendarDate | null>(null);

  readonly grid = computed(() => monthGrid(this.anchor()));

  readonly monthLabel = computed(() => {
    const { year, month } = parts(this.anchor());
    return `${MONTH_NAMES_LONG[month - 1]} ${year}`;
  });

  private readonly byDay = computed(() => {
    const map = new Map<CalendarDate, BillInstanceResponse[]>();
    for (const instance of this.store.instances()) {
      const bucket = map.get(instance.dueDate);
      if (bucket === undefined) map.set(instance.dueDate, [instance]);
      else bucket.push(instance);
    }
    return map;
  });

  readonly weeks = computed<DayCell[][]>(() => {
    const cells = this.grid().map((date) => this.toCell(date));
    return Array.from({ length: 6 }, (_, row) => cells.slice(row * 7, row * 7 + 7));
  });

  constructor() {
    this.loadRange();
  }

  /**
   * Fetches the whole visible span, not just the month: a spill day
   * rendering as empty while it actually holds a bill is a silent lie. 42
   * days is far inside the API's 400-day cap.
   *
   * Called explicitly from the constructor and from every method that moves
   * the anchor, rather than from an `effect`. An effect would fire during
   * the first change detection — which is what `fixture.whenStable()` runs
   * — so the request would appear while `whenStable()` was waiting for
   * quiescence, and the wait would never settle.
   */
  private loadRange(): void {
    const cells = this.grid();
    void this.store.setQuery({ from: cells[0], to: cells[cells.length - 1] });
  }

  instancesFor(date: CalendarDate): BillInstanceResponse[] {
    return this.byDay().get(date) ?? [];
  }

  select(date: CalendarDate): void {
    this.selected.set(date);
    this.focused.set(date);
  }

  /**
   * Moves focus to a day, pulling the grid to its month if the day is not
   * already on screen. An arrow key that crosses into a spill day needs no
   * refetch, because the spill days were fetched with the rest of the span.
   */
  focus(date: CalendarDate): void {
    if (!this.grid().includes(date)) {
      this.anchor.set(date);
      this.loadRange();
    }
    this.focused.set(date);
    this.focusAfterRender(date);
  }

  previousMonth(): void {
    this.shiftMonth(-1);
  }

  nextMonth(): void {
    this.shiftMonth(1);
  }

  goToToday(): void {
    this.anchor.set(this.todayDate);
    this.loadRange();
    this.focused.set(this.todayDate);
    this.focusAfterRender(this.todayDate);
  }

  onKeydown(event: KeyboardEvent): void {
    const current = this.focused();
    const next = this.nextFocus(event.key, current);
    if (next === null) return;

    event.preventDefault();
    this.focus(next);
  }

  private nextFocus(key: string, current: CalendarDate): CalendarDate | null {
    switch (key) {
      case 'ArrowLeft':
        return addDays(current, -1);
      case 'ArrowRight':
        return addDays(current, 1);
      case 'ArrowUp':
        return addDays(current, -7);
      case 'ArrowDown':
        return addDays(current, 7);
      case 'Home':
        return addDays(current, -dayOfWeek(current));
      case 'End':
        return addDays(current, 6 - dayOfWeek(current));
      case 'PageUp':
        return addMonths(current, -1);
      case 'PageDown':
        return addMonths(current, 1);
      default:
        return null;
    }
  }

  private shiftMonth(delta: number): void {
    const moved = addMonths(this.anchor(), delta);
    this.anchor.set(moved);
    this.loadRange();
    this.focused.set(moved);
    this.focusAfterRender(moved);
  }

  /**
   * The target cell may not exist yet — a month change re-renders the whole
   * grid — so focus is applied after the next render rather than
   * immediately. `afterNextRender` needs an explicit injector here because
   * this runs from an event handler, not a construction context.
   */
  private focusAfterRender(date: CalendarDate): void {
    afterNextRender(
      () => {
        this.host.nativeElement
          .querySelector<HTMLElement>(`[data-date="${date}"]`)
          ?.focus();
      },
      { injector: this.injector },
    );
  }

  private toCell(date: CalendarDate): DayCell {
    const instances = this.byDay().get(date) ?? [];
    const overdue = instances.filter((i) => i.isOverdue).length;
    const { day, month, year } = parts(date);
    const isToday = date === this.todayDate;

    const description =
      instances.length === 0
        ? 'no bills'
        : `${instances.length} bill${instances.length === 1 ? '' : 's'}` +
          (overdue > 0 ? `, ${overdue} overdue` : '');

    return {
      date,
      day,
      inMonth: isSameMonth(date, this.anchor()),
      isToday,
      chips: instances.slice(0, MAX_CHIPS).map((instance) => ({
        id: instance.id,
        name: instance.billName,
        isOverdue: instance.isOverdue,
        paid: instance.status === 'PAID',
      })),
      overflow: Math.max(0, instances.length - MAX_CHIPS),
      // "today" rides in the label itself, not only the `.today` CSS
      // outline — the same reasoning as the overdue chip's `!` marker:
      // colour (or a visual-only outline) is never the only carrier of
      // state, or a screen-reader user has no way to locate today at all.
      label: `${day} ${MONTH_NAMES_LONG[month - 1]} ${year}${isToday ? ', today' : ''}, ${description}`,
    };
  }
}
