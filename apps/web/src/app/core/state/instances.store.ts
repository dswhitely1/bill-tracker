import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { BillInstanceResponse } from '@bill-tracker/shared-types';
import { BillInstancesApi, BillInstanceQuery } from '../api/bill-instances.api';
import { errorMessage } from '../api/api-error';
import { SessionService } from '../auth/session.service';
import { BillsStore } from './bills.store';
import {
  CalendarDate,
  addDays,
  compare,
  endOfMonth,
  isCalendarDate,
  startOfMonth,
  today,
} from '../date/calendar-date';

/**
 * The API rejects when `to` is later than `from` plus this many days —
 * a *difference*, not an inclusive count, so a 401-day span is legal.
 * See `apps/api/src/bills/bill-instances.service.ts`. Measuring it as a
 * day count here would reject ranges the server accepts and explain the
 * refusal with a limit that does not exist.
 */
export const MAX_RANGE_DAYS = 400;

export function rangeError(from: CalendarDate, to: CalendarDate): string | null {
  if (!isCalendarDate(from) || !isCalendarDate(to)) {
    return 'Enter both dates as a real calendar day.';
  }
  if (compare(to, from) < 0) {
    return 'The end date must not precede the start date.';
  }
  if (compare(to, addDays(from, MAX_RANGE_DAYS)) > 0) {
    return `Choose a range of at most ${MAX_RANGE_DAYS} days.`;
  }
  return null;
}

function currentMonth(): BillInstanceQuery {
  const now = today();
  return { from: startOfMonth(now), to: endOfMonth(now) };
}

@Injectable({ providedIn: 'root' })
export class InstancesStore {
  private readonly api = inject(BillInstancesApi);
  private readonly bills = inject(BillsStore);
  private readonly session = inject(SessionService);

  private readonly items = signal<BillInstanceResponse[]>([]);
  private readonly currentQuery = signal<BillInstanceQuery>(currentMonth());
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly loaded = signal(false);
  private readonly fetchedOnState = signal<CalendarDate | null>(null);

  readonly instances = this.items.asReadonly();
  readonly query = this.currentQuery.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly isEmpty = computed(() => this.loaded() && this.items().length === 0);

  /**
   * The browser day the rows currently held were last fetched on. Set only
   * when a fetch succeeds — a range refused by `setQuery` (over-wide,
   * backwards) never reaches `fetch()`, so it cannot advance this. The
   * component owns no day marker of its own for exactly that reason: it
   * can only mark a day as fetched by actually fetching.
   */
  readonly fetchedOn = this.fetchedOnState.asReadonly();

  constructor() {
    effect(() => {
      if (!this.session.isAuthenticated()) this.reset();
    });

    // A template change rewrites, generates, or cascades on the server by
    // rules this store cannot reproduce. Watching the counter rather than
    // having `BillsStore` call in keeps the dependency pointing one way.
    //
    // `loaded` is read untracked on purpose. Tracked, this effect would
    // also depend on it, so the first successful fetch — which sets it
    // true — would re-run the effect and immediately fetch the same range
    // again. The counter is the only thing this effect reacts to.
    effect(() => {
      this.bills.mutations();
      if (untracked(() => this.loaded())) void this.refresh();
    });
  }

  async setQuery(query: BillInstanceQuery): Promise<void> {
    const invalid = rangeError(query.from, query.to);
    if (invalid !== null) {
      // The previous rows stay. Blanking the list to explain a range the
      // person has not committed to yet loses what they were reading.
      this.errorState.set(invalid);
      return;
    }

    this.currentQuery.set(query);
    await this.fetch();
  }

  refresh(): Promise<void> {
    return this.fetch();
  }

  /**
   * Replaces one row from a response the API already returned. The payment
   * endpoints hand back the updated instance, so there is nothing to
   * refetch — and refetching would throw away the rest of the range to
   * learn one row.
   */
  patch(instance: BillInstanceResponse): void {
    this.items.update((current) =>
      current.map((item) => (item.id === instance.id ? instance : item)),
    );
  }

  reset(): void {
    this.items.set([]);
    this.currentQuery.set(currentMonth());
    this.loaded.set(false);
    this.errorState.set(null);
    this.loadingState.set(false);
    this.fetchedOnState.set(null);
  }

  private async fetch(): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);
    try {
      this.items.set(await firstValueFrom(this.api.list(this.currentQuery())));
      this.loaded.set(true);
      this.fetchedOnState.set(today());
    } catch (error: unknown) {
      this.errorState.set(errorMessage(error));
    } finally {
      this.loadingState.set(false);
    }
  }
}
