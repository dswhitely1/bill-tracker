import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  BillResponse,
  CreateBillRequest,
  UpdateBillRequest,
} from '@bill-tracker/shared-types';
import { BillsApi } from '../api/bills.api';
import { errorMessage } from '../api/api-error';
import { SessionService } from '../auth/session.service';

@Injectable({ providedIn: 'root' })
export class BillsStore {
  private readonly api = inject(BillsApi);
  private readonly session = inject(SessionService);

  private readonly items = signal<BillResponse[]>([]);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly loaded = signal(false);
  private readonly mutationCount = signal(0);

  readonly bills = this.items.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly isEmpty = computed(() => this.loaded() && this.items().length === 0);

  /**
   * Increments after every successful template change.
   *
   * Each of the three mutations alters generated instances in a way the
   * client cannot predict: `POST` generates them synchronously, `PATCH`
   * rewrites untouched future ones by the rule in bills spec §5.4, and
   * `DELETE` cascades through instances and payment logs. The instance
   * store watches this counter and refetches.
   *
   * Reimplementing the rewrite rule here to avoid that refetch would put
   * the same business rule in two codebases, and the copy would drift.
   */
  readonly mutations = this.mutationCount.asReadonly();

  /**
   * Bumps the counter without a mutation behind it. The stores that watch
   * this counter are the unit under test in their own specs; staging a
   * real bill creation there would test this store instead of them.
   */
  announceMutation(): void {
    this.mutationCount.update((n) => n + 1);
  }

  constructor() {
    effect(() => {
      if (!this.session.isAuthenticated()) this.reset();
    });
  }

  async load(force = false): Promise<void> {
    if (this.loaded() && !force) return;

    this.loadingState.set(true);
    this.errorState.set(null);
    try {
      this.items.set(await firstValueFrom(this.api.list()));
      this.loaded.set(true);
    } catch (error: unknown) {
      this.errorState.set(errorMessage(error));
    } finally {
      this.loadingState.set(false);
    }
  }

  /** Reads one bill directly, so an edit form opened by URL works on a cold store. */
  get(id: string): Promise<BillResponse> {
    return firstValueFrom(this.api.get(id));
  }

  async create(body: CreateBillRequest): Promise<BillResponse> {
    const created = await firstValueFrom(this.api.create(body));
    this.items.update((current) => [...current, created]);
    this.mutationCount.update((count) => count + 1);
    return created;
  }

  async update(id: string, body: UpdateBillRequest): Promise<BillResponse> {
    const updated = await firstValueFrom(this.api.update(id, body));
    this.items.update((current) => current.map((item) => (item.id === id ? updated : item)));
    this.mutationCount.update((count) => count + 1);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.api.remove(id));
    this.items.update((current) => current.filter((item) => item.id !== id));
    this.mutationCount.update((count) => count + 1);
  }

  reset(): void {
    this.items.set([]);
    this.loaded.set(false);
    this.errorState.set(null);
    this.loadingState.set(false);
  }
}
