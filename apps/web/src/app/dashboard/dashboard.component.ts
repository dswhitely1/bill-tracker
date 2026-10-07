import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { CategorySummary } from '@bill-tracker/shared-types';
import { MAX_RANGE_DAYS } from '../core/state/instances.store';
import { SummaryStore } from '../core/state/summary.store';
import { CalendarDate, addDays, compare, endOfMonth, startOfMonth } from '../core/date/calendar-date';
import { CalendarDatePipe } from '../core/date/calendar-date.pipe';
import { formatMoney } from '../shared/money';
import { NO_CATEGORY, defaultParams, toQueryParams } from '../instances/upcoming-params';

interface CategoryRow extends CategorySummary {
  label: string;
  totalLabel: string;
  paidLabel: string;
  queryParams: Record<string, string>;
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, MatButtonModule, MatCardModule, MatProgressBarModule, CalendarDatePipe],
  template: `
    <header class="page-header">
      <h1>Dashboard</h1>
      @if (store.summary(); as summary) {
        <p class="as-of">As of {{ summary.asOf | calendarDate }}</p>
      }
    </header>

    @if (store.loading()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (store.error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    @if (store.summary(); as summary) {
      <div class="cards">
        <mat-card class="card overdue">
          <mat-card-header><mat-card-title>Overdue</mat-card-title></mat-card-header>
          <mat-card-content>
            <p class="figure">{{ overdueAmount() }}</p>
            <p class="detail">{{ summary.overdue.count }} bill(s) past due</p>
          </mat-card-content>
          @if (summary.overdue.count > 0) {
            <mat-card-actions>
              <a matButton routerLink="/upcoming" [queryParams]="overdueLink()">View overdue</a>
            </mat-card-actions>
          }
        </mat-card>

        <mat-card class="card">
          <mat-card-header><mat-card-title>Due this month</mat-card-title></mat-card-header>
          <mat-card-content>
            <p class="figure">{{ monthTotal() }}</p>
            <p class="detail">{{ monthPaid() }} paid ({{ monthProgress() }}%)</p>
            <mat-progress-bar mode="determinate" [value]="monthProgress()" />
          </mat-card-content>
          <mat-card-actions>
            <a matButton routerLink="/upcoming" [queryParams]="monthLink()">View this month</a>
          </mat-card-actions>
        </mat-card>

        <mat-card class="card">
          <mat-card-header><mat-card-title>Next 7 days</mat-card-title></mat-card-header>
          <mat-card-content>
            <p class="figure">{{ next7Amount() }}</p>
            <p class="detail">{{ summary.next7Days.count }} bill(s) coming up</p>
          </mat-card-content>
          <mat-card-actions>
            <a matButton routerLink="/upcoming" [queryParams]="next7Link()">View the week</a>
          </mat-card-actions>
        </mat-card>

        <mat-card class="card wide">
          <mat-card-header><mat-card-title>This month by category</mat-card-title></mat-card-header>
          <mat-card-content>
            @if (categoryRows().length === 0) {
              <p class="detail">Nothing due this month.</p>
            } @else {
              <ul class="categories">
                @for (row of categoryRows(); track row.categoryId) {
                  <li>
                    <span class="swatch" [style.background]="row.color ?? 'transparent'"></span>
                    <a routerLink="/upcoming" [queryParams]="row.queryParams">{{ row.label }}</a>
                    <span class="amounts">{{ row.totalLabel }} · {{ row.paidLabel }} paid</span>
                  </li>
                }
              </ul>
            }
          </mat-card-content>
        </mat-card>
      </div>
    }
  `,
  styles: `
    .cards {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
      gap: 1rem;
    }
    .wide {
      grid-column: 1 / -1;
    }
    .figure {
      font: var(--mat-sys-headline-medium);
      margin: 0;
    }
    .detail,
    .as-of {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .overdue .figure {
      color: var(--mat-sys-error);
    }
    .error {
      color: var(--mat-sys-error);
    }
    .categories {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    .categories li {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.25rem 0;
    }
    .swatch {
      width: 0.75rem;
      height: 0.75rem;
      border-radius: 50%;
      border: 1px solid var(--mat-sys-outline-variant);
    }
    .amounts {
      margin-left: auto;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DashboardComponent {
  protected readonly store = inject(SummaryStore);

  constructor() {
    void this.store.load();
  }

  protected readonly overdueAmount = computed(() =>
    formatMoney(this.store.summary()?.overdue.amount ?? 0),
  );
  protected readonly monthTotal = computed(() =>
    formatMoney(this.store.summary()?.thisMonth.total ?? 0),
  );
  protected readonly monthPaid = computed(() =>
    formatMoney(this.store.summary()?.thisMonth.paid ?? 0),
  );
  protected readonly next7Amount = computed(() =>
    formatMoney(this.store.summary()?.next7Days.amount ?? 0),
  );

  /** Guarded against a zero total, which would otherwise be a division by zero. */
  protected readonly monthProgress = computed(() => {
    const month = this.store.summary()?.thisMonth;
    if (month === undefined || month.total === 0) return 0;
    return Math.round((month.paid / month.total) * 100);
  });

  /**
   * The overdue figure is all-time, but /upcoming caps a range at
   * MAX_RANGE_DAYS. Starting the link at the oldest overdue row makes it
   * exact for anyone whose debt is inside the cap; clamping to the cap
   * keeps it legal for anyone whose debt is not, and /upcoming discloses
   * the difference rather than quietly showing a smaller total.
   */
  protected readonly overdueLink = computed(() => {
    const summary = this.store.summary();
    if (summary === null) return {};
    const asOf = summary.asOf as CalendarDate;
    const floor = addDays(asOf, -MAX_RANGE_DAYS);
    const earliest = summary.overdue.earliestDueDate as CalendarDate | null;
    const from = earliest !== null && compare(earliest, floor) > 0 ? earliest : floor;
    return toQueryParams({ ...defaultParams(asOf), from, to: asOf, overdue: true });
  });

  protected readonly monthLink = computed(() => {
    const asOf = (this.store.summary()?.asOf ?? '') as CalendarDate;
    if (asOf === '') return {};
    return toQueryParams({
      ...defaultParams(asOf),
      from: startOfMonth(asOf),
      to: endOfMonth(asOf),
    });
  });

  protected readonly next7Link = computed(() => {
    const asOf = (this.store.summary()?.asOf ?? '') as CalendarDate;
    if (asOf === '') return {};
    return toQueryParams({ ...defaultParams(asOf), from: asOf, to: addDays(asOf, 6) });
  });

  protected readonly categoryRows = computed<CategoryRow[]>(() => {
    const summary = this.store.summary();
    if (summary === null) return [];
    const asOf = summary.asOf as CalendarDate;

    return summary.byCategory.map((row) => ({
      ...row,
      label: row.categoryName ?? 'Uncategorized',
      totalLabel: formatMoney(row.total),
      paidLabel: formatMoney(row.paid),
      queryParams: toQueryParams({
        ...defaultParams(asOf),
        from: startOfMonth(asOf),
        to: endOfMonth(asOf),
        categoryId: row.categoryId ?? NO_CATEGORY,
      }) as Record<string, string>,
    }));
  });
}
