import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  CategoryResponse,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from '@bill-tracker/shared-types';
import { CategoriesApi } from '../api/categories.api';
import { errorMessage } from '../api/api-error';
import { SessionService } from '../auth/session.service';

@Injectable({ providedIn: 'root' })
export class CategoriesStore {
  private readonly api = inject(CategoriesApi);
  private readonly session = inject(SessionService);

  private readonly items = signal<CategoryResponse[]>([]);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly loaded = signal(false);

  readonly categories = this.items.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();

  /**
   * True only once a load has actually succeeded and returned nothing. A
   * bare `length === 0` would render the empty state during the first
   * load, and again whenever a load fails — telling a person their data
   * is gone when it is merely unreachable.
   */
  readonly isEmpty = computed(() => this.loaded() && this.items().length === 0);

  constructor() {
    // The store empties itself rather than `SessionService` emptying it,
    // which would make the session depend on every store in the
    // application. A second user signing in on the same tab must never
    // see the first one's rows.
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

  /**
   * Mutations reject rather than swallow. The caller is a form that needs
   * the error to attach messages to its controls; a store that returned
   * `void` on failure would leave the form looking successful.
   */
  async create(body: CreateCategoryRequest): Promise<CategoryResponse> {
    const created = await firstValueFrom(this.api.create(body));
    this.items.update((current) => [...current, created]);
    return created;
  }

  async update(id: string, body: UpdateCategoryRequest): Promise<CategoryResponse> {
    const updated = await firstValueFrom(this.api.update(id, body));
    this.items.update((current) => current.map((item) => (item.id === id ? updated : item)));
    return updated;
  }

  /**
   * The local removal happens only after the server confirms. A delete
   * refused with 409 — the category is still used by bills — must leave
   * the row where it is, not show it vanishing from a list the server
   * still holds.
   */
  async remove(id: string): Promise<void> {
    await firstValueFrom(this.api.remove(id));
    this.items.update((current) => current.filter((item) => item.id !== id));
  }

  reset(): void {
    this.items.set([]);
    this.loaded.set(false);
    this.errorState.set(null);
    this.loadingState.set(false);
  }
}
