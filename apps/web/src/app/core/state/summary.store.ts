import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { SummaryResponse } from '@bill-tracker/shared-types';
import { SummaryApi } from '../api/summary.api';
import { errorMessage } from '../api/api-error';
import { SessionService } from '../auth/session.service';
import { BillsStore } from './bills.store';
import { PaymentsService } from './payments.service';

@Injectable({ providedIn: 'root' })
export class SummaryStore {
  private readonly api = inject(SummaryApi);
  private readonly bills = inject(BillsStore);
  private readonly payments = inject(PaymentsService);
  private readonly session = inject(SessionService);

  private readonly data = signal<SummaryResponse | null>(null);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly loadedState = signal(false);

  readonly summary = this.data.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly loaded = this.loadedState.asReadonly();

  /**
   * Last-seen counter values. The effect compares against these instead of
   * relying on an effect's first flush running its body regardless of its
   * dependencies — which is what made the old refetch tests tautological:
   * when the first flush landed after `load()` resolved, the body ran with
   * `loadedState` already true and fetched for no reason at all.
   *
   * Initialized from the current values so the first flush is a no-op.
   */
  private lastBillsMutations = this.bills.mutations();
  private lastPaymentsMutations = this.payments.mutations();

  constructor() {
    effect(() => {
      if (!this.session.isAuthenticated()) this.reset();
    });

    // Both counters, because both move these figures: a payment changes
    // every bucket, and creating, editing, or deleting a bill rewrites the
    // instances the buckets are computed from.
    effect(() => {
      const bills = this.bills.mutations();
      const payments = this.payments.mutations();
      const moved =
        bills !== this.lastBillsMutations || payments !== this.lastPaymentsMutations;
      this.lastBillsMutations = bills;
      this.lastPaymentsMutations = payments;

      // `loadedState` is read untracked on purpose: tracked, the first
      // successful fetch would re-run this effect and fetch again.
      if (moved && untracked(() => this.loadedState())) void this.fetch();
    });
  }

  async load(force = false): Promise<void> {
    if (this.loadedState() && !force) return;
    await this.fetch();
  }

  refresh(): Promise<void> {
    return this.fetch();
  }

  reset(): void {
    this.data.set(null);
    this.loadedState.set(false);
    this.errorState.set(null);
    this.loadingState.set(false);
  }

  private async fetch(): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);
    try {
      this.data.set(await firstValueFrom(this.api.get()));
      this.loadedState.set(true);
    } catch (error: unknown) {
      this.errorState.set(errorMessage(error));
    } finally {
      this.loadingState.set(false);
    }
  }
}
