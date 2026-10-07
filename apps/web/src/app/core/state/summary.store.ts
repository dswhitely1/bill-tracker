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

  constructor() {
    effect(() => {
      if (!this.session.isAuthenticated()) this.reset();
    });

    // Both counters, because both move these figures: a payment changes
    // every bucket, and creating, editing, or deleting a bill rewrites the
    // instances the buckets are computed from.
    //
    // `loadedState` is read untracked on purpose. Tracked, the first
    // successful fetch — which sets it true — would re-run this effect and
    // immediately fetch again. The counters are the only triggers.
    effect(() => {
      this.bills.mutations();
      this.payments.mutations();
      if (untracked(() => this.loadedState())) void this.fetch();
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
