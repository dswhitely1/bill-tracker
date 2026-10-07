import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { debounceTime, distinctUntilChanged, map } from 'rxjs';
import { BILL_STATUSES } from '@bill-tracker/shared-types';
import type { BillInstanceResponse, BillStatus } from '@bill-tracker/shared-types';
import { CalendarDate, compare, today } from '../core/date/calendar-date';
import { CalendarDatePipe } from '../core/date/calendar-date.pipe';
import { BillsStore } from '../core/state/bills.store';
import { CategoriesStore } from '../core/state/categories.store';
import { InstancesStore, rangeError } from '../core/state/instances.store';
import { SummaryStore } from '../core/state/summary.store';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { formatMoney } from '../shared/money';
import { SORT_LABELS, filterInstances, sortInstances } from './instance-filters';
import { InstanceActionsService } from './instance-actions.service';
import { InstanceRowComponent, STATUS_LABELS } from './instance-row.component';
import { PaymentHistoryComponent } from './payment-history.component';
import {
  NO_CATEGORY,
  SORT_DIRECTIONS,
  SORT_KEYS,
  SortDir,
  SortKey,
  UpcomingParams,
  parseUpcomingParams,
  toQueryParams,
} from './upcoming-params';

/** Only the parameters `GET /api/bill-instances` actually receives. */
function serverQueryKey(p: UpcomingParams): string {
  return JSON.stringify([p.from, p.to, p.status, p.overdue, p.billId]);
}

@Component({
  selector: 'app-upcoming',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDatepickerModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    CalendarDatePipe,
    EmptyStateComponent,
    InstanceRowComponent,
    PaymentHistoryComponent,
  ],
  template: `
    <header class="page-header">
      <h1>Upcoming</h1>
    </header>

    <form [formGroup]="rangeForm" class="range" (ngSubmit)="applyRange()">
      <mat-form-field>
        <mat-label>From</mat-label>
        <input matInput [matDatepicker]="fromPicker" formControlName="from" />
        <mat-datepicker-toggle matIconSuffix [for]="fromPicker" />
        <mat-datepicker #fromPicker />
      </mat-form-field>

      <mat-form-field>
        <mat-label>To</mat-label>
        <input matInput [matDatepicker]="toPicker" formControlName="to" />
        <mat-datepicker-toggle matIconSuffix [for]="toPicker" />
        <mat-datepicker #toPicker />
      </mat-form-field>

      <button matButton="filled" type="submit">Apply</button>
    </form>

    @if (rangeFormError(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    <div class="filters">
      <mat-form-field>
        <mat-label>Search</mat-label>
        <input matInput [formControl]="searchControl" placeholder="Bill name" />
      </mat-form-field>

      <mat-form-field>
        <mat-label>Status</mat-label>
        <mat-select [value]="params().status" (valueChange)="setStatus($event)">
          <mat-option [value]="null">Any</mat-option>
          @for (value of statuses; track value) {
            <mat-option [value]="value">{{ statusLabels[value] }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field>
        <mat-label>Overdue</mat-label>
        <mat-select [value]="params().overdue" (valueChange)="setOverdue($event)">
          <mat-option [value]="null">Any</mat-option>
          <mat-option [value]="true">Overdue only</mat-option>
          <mat-option [value]="false">Not overdue</mat-option>
        </mat-select>
      </mat-form-field>

      <mat-form-field>
        <mat-label>Bill</mat-label>
        <mat-select [value]="params().billId" (valueChange)="setBillId($event)">
          <mat-option [value]="null">Any bill</mat-option>
          @for (bill of bills.bills(); track bill.id) {
            <mat-option [value]="bill.id">{{ bill.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field>
        <mat-label>Category</mat-label>
        <mat-select [value]="params().categoryId" (valueChange)="setCategoryId($event)">
          <mat-option [value]="null">Any category</mat-option>
          <mat-option [value]="noCategory">Uncategorized</mat-option>
          @for (category of categories.categories(); track category.id) {
            <mat-option [value]="category.id">{{ category.name }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field>
        <mat-label>Sort by</mat-label>
        <mat-select [value]="params().sort" (valueChange)="setSort($event)">
          @for (key of sortKeys; track key) {
            <mat-option [value]="key">{{ sortLabels[key] }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field>
        <mat-label>Direction</mat-label>
        <mat-select [value]="params().dir" (valueChange)="setDir($event)">
          <mat-option value="asc">Ascending</mat-option>
          <mat-option value="desc">Descending</mat-option>
        </mat-select>
      </mat-form-field>
    </div>

    @if (hiddenOverdue(); as hidden) {
      <p class="disclosure" role="status">
        Showing overdue bills from {{ params().from | calendarDate }} onward. Rows older than
        that are not shown; your total overdue balance is {{ hidden.total }}, reaching back to
        {{ hidden.earliest | calendarDate }}.
      </p>
    }

    @if (overdueDisclosureUnavailable(); as message) {
      <p class="error" role="alert">
        Could not confirm whether more overdue bills exist outside this range: {{ message }}
      </p>
    }

    @if (store.loading()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (store.error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    @if (actionError(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    @if (noneInRange()) {
      <app-empty-state
        icon="event_available"
        title="Nothing due in this range"
        message="Widen the dates, or create a bill so occurrences can be generated."
      />
    } @else if (noneMatchFilters()) {
      <app-empty-state
        icon="search_off"
        title="No bills match these filters"
        message="Clear the search or choose a different category."
      />
    } @else {
      <mat-accordion multi>
        @for (instance of visible(); track instance.id) {
          <mat-expansion-panel>
            <mat-expansion-panel-header>
              <app-instance-row [instance]="instance" />
            </mat-expansion-panel-header>

            <!--
              The body is deferred behind matExpansionPanelContent on purpose.
              A panel renders its content eagerly by default, which would mount
              one app-payment-history per instance and fire a GET /payments for
              every row the moment the screen loads — thirty requests to show
              thirty collapsed rows. Deferred, the log is read when a person
              actually opens a row, which is what spec §11 describes.
            -->
            <ng-template matExpansionPanelContent>
              <div class="instance-actions">
                @if (instance.status !== 'PAID') {
                  <button matButton="filled" (click)="openPayment(instance)">Record payment</button>
                }
                @if (instance.amountPaid !== 0) {
                  <button matButton (click)="confirmUnpay(instance)">Clear all payments</button>
                }
              </div>

              <app-payment-history [instanceId]="instance.id" />
            </ng-template>
          </mat-expansion-panel>
        }
      </mat-accordion>
    }
  `,
  styles: `
    .range {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .disclosure {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .error {
      color: var(--mat-sys-error);
    }
    .instance-actions {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpcomingComponent {
  protected readonly store = inject(InstancesStore);
  protected readonly bills = inject(BillsStore);
  protected readonly categories = inject(CategoriesStore);
  private readonly summary = inject(SummaryStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly actions = inject(InstanceActionsService);

  protected readonly statuses = BILL_STATUSES;
  protected readonly statusLabels = STATUS_LABELS;
  protected readonly sortKeys = SORT_KEYS;
  protected readonly sortDirections = SORT_DIRECTIONS;
  protected readonly sortLabels = SORT_LABELS;
  protected readonly noCategory = NO_CATEGORY;

  readonly actionError = signal<string | null>(null);

  /**
   * Set by `applyRange()` when the submitted range fails `rangeError`, and
   * cleared the moment a valid one is submitted.
   *
   * This is deliberately separate from the URL's own fallback behaviour in
   * `parseUpcomingParams`. A malformed *URL* — a bookmark, a shared link, a
   * hand-edited address bar — gets no banner and silently resolves to the
   * default range, because there is no "submission" to have gone wrong and
   * a banner would be blaming the person for someone else's stale link. A
   * malformed *form submission* is different: a person just asked this
   * screen for a specific range, so silently substituting another one
   * without saying so would hide exactly the feedback they need. The old
   * component (sub-project 3) showed this message by routing through
   * `InstancesStore.setQuery`, which is no longer reachable from here with
   * an invalid range — `patch()` only ever sends the URL a range that has
   * already passed this check.
   */
  readonly rangeFormError = signal<string | null>(null);

  /**
   * The last `q` value this component itself wrote — via the user typing
   * (debounced into a `patch`) or via the resync subscription below.
   *
   * Distinguishes a genuinely external change to `q` — a link into
   * `/upcoming?q=...` from the dashboard or calendar (Tasks 8/10) while
   * this screen is already mounted, which Angular reuses the component
   * instance for, since only query parameters changed — from the
   * committed echo of a patch this component just issued for the user's
   * own typing. Resyncing on every `q` emission unconditionally would
   * clobber whatever has been typed into the box *since* that patch was
   * issued with the now-stale value it carried.
   */
  private lastPatchedQuery: string | null = null;

  /**
   * The URL is the single source of truth for every filter. Nothing is
   * mirrored into component state, so there is no second copy to drift.
   * `requireSync` is safe: `ActivatedRoute`'s observables replay their
   * current value on subscription.
   */
  private readonly paramMap = toSignal(this.route.queryParamMap, { requireSync: true });
  readonly params = computed<UpcomingParams>(() => parseUpcomingParams(this.paramMap()));

  readonly rangeForm = this.fb.nonNullable.group({
    from: this.params().from,
    to: this.params().to,
  });

  readonly searchControl = this.fb.nonNullable.control(this.params().q);

  /** The rows actually rendered: fetched, then filtered and sorted in memory. */
  readonly visible = computed(() => {
    const p = this.params();
    return sortInstances(
      filterInstances(this.store.instances(), { q: p.q, categoryId: p.categoryId }),
      p.sort,
      p.dir,
    );
  });

  /**
   * Two distinct empties, because they need different sentences. The store
   * owns "the server returned nothing for this range"; this component owns
   * "rows came back but your search or category hid them all".
   *
   * `InstancesStore.loaded` is private, and deliberately so — the store's
   * own `isEmpty` is the supported way to ask this question.
   */
  readonly noneInRange = computed(() => this.store.isEmpty());
  readonly noneMatchFilters = computed(
    () => this.store.instances().length > 0 && this.visible().length === 0,
  );

  /**
   * Overdue debt has no lower bound, but this screen caps its range at 400
   * days. When the oldest overdue row predates the range, the figure on the
   * dashboard is larger than anything this list can show — so say so rather
   * than letting the two quietly disagree.
   */
  readonly hiddenOverdue = computed(() => {
    const p = this.params();
    const current = this.summary.summary();
    if (p.overdue !== true || current === null) return null;
    const earliest = current.overdue.earliestDueDate;
    if (earliest === null || compare(earliest, p.from) >= 0) return null;
    return { total: formatMoney(current.overdue.amount), earliest };
  });

  /**
   * `hiddenOverdue` fails closed: a `null` summary — which includes "the
   * summary request failed" — reads identically to "every overdue row is
   * already on screen". A person on the clamped overdue link with
   * `/api/summary` down would see a truncated list with nothing to say
   * anything is missing, which is exactly the disclosure spec §4.3
   * requires.
   *
   * Scoped to when `overdue` is the active filter, same as `hiddenOverdue`
   * itself: the summary is irrelevant to any other filter, and a banner
   * here would be noise on every ordinary visit to this screen.
   */
  readonly overdueDisclosureUnavailable = computed(() =>
    this.params().overdue === true ? this.summary.error() : null,
  );

  constructor() {
    void this.bills.load();
    void this.categories.load();
    void this.summary.load();

    // A subscription rather than an effect, on purpose.
    //
    // `ActivatedRoute.queryParamMap` replays its current value the moment
    // it is subscribed, so the first fetch is issued here in the
    // constructor — exactly where the previous implementation issued it,
    // and where every existing test expects to find it. An `effect` would
    // instead fire during the first change detection, which is what
    // `fixture.whenStable()` runs: the request would appear *while*
    // whenStable was waiting for quiescence, and the wait would never
    // settle.
    //
    // `distinctUntilChanged` on a key built only from the parameters the
    // API receives is what keeps a keystroke in the search box from
    // issuing a request. The key is a string because the parsed object is
    // a new reference every emission.
    this.route.queryParamMap
      .pipe(
        map((params) => parseUpcomingParams(params)),
        distinctUntilChanged(
          (a, b) => serverQueryKey(a) === serverQueryKey(b),
        ),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((p) => {
        this.rangeForm.setValue({ from: p.from, to: p.to }, { emitEvent: false });
        void this.store.setQuery({
          from: p.from,
          to: p.to,
          ...(p.status === null ? {} : { status: p.status }),
          ...(p.overdue === null ? {} : { overdue: p.overdue }),
          ...(p.billId === null ? {} : { billId: p.billId }),
        });
      });

    // Debounced so a search does not navigate once per character.
    this.searchControl.valueChanges
      .pipe(debounceTime(200), takeUntilDestroyed(this.destroyRef))
      .subscribe((value) => this.patch({ q: value.trim() }));

    // Resyncs `searchControl` when `q` changes from somewhere other than
    // the control itself. `q` is deliberately not part of `serverQueryKey`
    // (it never reaches the API), so it cannot piggyback on the
    // subscription above and needs its own, ungated by that key. Guarded
    // against overwriting newer local typing with the committed echo of
    // this component's own most recent patch — see `lastPatchedQuery`.
    this.route.queryParamMap
      .pipe(
        map((params) => parseUpcomingParams(params).q),
        distinctUntilChanged(),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe((q) => {
        if (q === this.lastPatchedQuery) return;
        this.lastPatchedQuery = q;
        this.searchControl.setValue(q, { emitEvent: false });
      });

    const onFocus = (): void => this.refreshIfDayChanged();
    window.addEventListener('focus', onFocus);
    this.destroyRef.onDestroy(() => window.removeEventListener('focus', onFocus));
  }

  applyRange(): void {
    const { from, to } = this.rangeForm.getRawValue();
    const invalid = rangeError(from, to);
    this.rangeFormError.set(invalid);
    // A rejected range never reaches `patch()`, so it never reaches the
    // URL. `parseUpcomingParams`'s own fallback exists for a *different*
    // case — a malformed URL arrived at from outside this form — and must
    // stay reachable only that way; routing a form rejection through it
    // too would silently replace what the person asked for instead of
    // telling them why it didn't happen.
    if (invalid !== null) return;
    this.patch({ from, to });
  }

  setStatus(value: BillStatus | null): void {
    this.patch({ status: value });
  }

  setOverdue(value: boolean | null): void {
    this.patch({ overdue: value });
  }

  setBillId(value: string | null): void {
    this.patch({ billId: value });
  }

  setCategoryId(value: string | null): void {
    this.patch({ categoryId: value });
  }

  setSort(value: SortKey): void {
    this.patch({ sort: value });
  }

  setDir(value: SortDir): void {
    this.patch({ dir: value });
  }

  /** Exposed for tests; the template drives this through `searchControl`. */
  setSearch(value: string): void {
    this.patch({ q: value.trim() });
  }

  /**
   * `isOverdue` is computed against the server's `APP_TIMEZONE` at the
   * moment of the request, so it goes stale when the day turns over. A tab
   * left open overnight would otherwise show yesterday's answer until
   * someone reloaded it.
   *
   * Compared against the store's `fetchedOn`, not a marker this component
   * sets itself. A refused range (over-wide, backwards) never reaches a
   * fetch, so a component-owned marker bumped on every `load()` call would
   * be advanced by a request that never happened — convincing this check
   * that yesterday's rows are fresh. The store only advances its marker
   * when a fetch actually succeeds, so there is nothing to desynchronise.
   *
   * The current day is a parameter so this is testable without stubbing
   * the clock.
   */
  refreshIfDayChanged(now: CalendarDate = today()): void {
    if (now === this.store.fetchedOn()) return;
    void this.store.refresh();
  }

  /**
   * The dialog wiring, the `PaymentsService` call, and the success
   * notification all live in `InstanceActionsService` now — shared with
   * `DayDetailComponent`'s calendar drill-down, so the same rule enforced
   * here cannot go missing there.
   */
  async openPayment(instance: BillInstanceResponse): Promise<void> {
    const result = await this.actions.recordPayment(instance);
    this.actionError.set(result.ok ? null : result.message);
  }

  async confirmUnpay(instance: BillInstanceResponse): Promise<void> {
    const result = await this.actions.clearPayments(instance);
    this.actionError.set(result.ok ? null : result.message);
  }

  /**
   * The merge base for the *next* `patch()` call, while one is still in
   * flight.
   *
   * Without this, two filter changes issued before the first's navigation
   * commits — choosing a sort key and a direction from two different
   * selects in the same dispatch, say — race: each `patch()` merges its
   * change onto `this.params()`, which reflects only the committed URL, so
   * the second call cannot see the first call's not-yet-committed change
   * and overwrites it when its own navigation lands. Tracking the latest
   * *intended* target here, independently of what has actually committed,
   * means every `patch()` after the first carries every change requested
   * so far, so whichever navigation Angular's router keeps (navigating
   * again before a prior navigation settles cancels that prior one) still
   * carries the full set.
   */
  private pendingParams: UpcomingParams | null = null;

  /**
   * `replaceUrl` on every filter change. Pushing a history entry per
   * adjustment turns Back into a per-keystroke undo; replacing keeps the
   * URL authoritative and bookmarkable, and Back returns to whatever screen
   * the person came from.
   */
  private patch(changes: Partial<UpcomingParams>): void {
    // Every filter change passes through here, so this is the one place
    // that can clear a range-form banner once it stops describing the
    // control the person is touching. Left set, a rejected range's message
    // would outlive the submission that produced it — still on screen,
    // attached to nothing, after a Sort or Category change the person made
    // instead of fixing the dates.
    this.rangeFormError.set(null);
    // Recorded here, centrally, rather than only in the debounced search
    // subscription — so `setSearch()` (the direct, non-debounced path
    // tests use) gets the same clobber protection as typing does.
    if ('q' in changes) this.lastPatchedQuery = changes.q ?? '';
    const next = { ...(this.pendingParams ?? this.params()), ...changes };
    this.pendingParams = next;
    void this.router
      .navigate([], {
        relativeTo: this.route,
        queryParams: toQueryParams(next),
        replaceUrl: true,
      })
      .then(() => {
        // Only clear if nothing newer has taken over as the pending target.
        if (this.pendingParams === next) this.pendingParams = null;
      });
  }
}
