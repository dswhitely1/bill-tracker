import {
  DestroyRef, Injectable, computed, effect, inject, signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { NotificationItem } from '@bill-tracker/shared-types';
import { NotificationsApi } from '../api/notifications.api';
import { errorMessage } from '../api/api-error';
import { SessionService } from '../auth/session.service';

/** How many the bell's menu offers before sending the user to the page. */
export const RECENT_LIMIT = 5;

@Injectable({ providedIn: 'root' })
export class NotificationsStore {
  private readonly api = inject(NotificationsApi);
  private readonly session = inject(SessionService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly data = signal<NotificationItem[]>([]);
  private readonly unread = signal(0);
  private readonly truncatedState = signal(false);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly loadedState = signal(false);

  /**
   * Monotonic request generation. Two fetches can be in flight at once —
   * e.g. two `visibilitychange` refreshes close together — and resolve
   * out of order; without this, whichever response lands *last* wins even
   * if it was issued *first*, which can mean a stale list overwriting rows
   * a later fetch (or a `markRead`/`markAllRead` patch applied in between)
   * already settled. Same shape as `InstancesStore.fetchGeneration`,
   * guarding against the same kind of late arrival.
   */
  private fetchGeneration = 0;

  readonly items = this.data.asReadonly();
  readonly unreadCount = this.unread.asReadonly();
  readonly truncated = this.truncatedState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly recent = computed(() => this.data().slice(0, RECENT_LIMIT));

  constructor() {
    effect(() => {
      if (!this.session.isAuthenticated()) this.reset();
    });

    // The reminder run fires once a day at a known hour, so a polling
    // timer would mean dozens of requests per session to catch a single
    // transition. This one listener covers the case that actually happens:
    // a tab left open since yesterday.
    const onVisibility = (): void => {
      // Without this guard the event also fires as the tab is *hidden*,
      // so every switch away would cost a request.
      if (document.visibilityState !== 'visible') return;
      if (!this.loadedState()) return;
      void this.fetch();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  async load(force = false): Promise<void> {
    if (this.loadedState() && !force) return;
    await this.fetch();
  }

  refresh(): Promise<void> {
    return this.fetch();
  }

  async markRead(id: string): Promise<void> {
    const before = this.data().find((item) => item.id === id);
    if (before === undefined) return;

    this.errorState.set(null);
    try {
      await firstValueFrom(this.api.markRead(id));
    } catch (error: unknown) {
      // The row stays as it was: showing it read while the server still
      // has it unread would survive until the next fetch and then jump
      // back, which reads as the app losing the click.
      this.errorState.set(errorMessage(error));
      return;
    }

    this.data.update((items) =>
      items.map((item) => (item.id === id ? { ...item, isRead: true } : item)),
    );
    // Only an unread, unresolved row was being counted — the same
    // predicate the server uses. Decrementing for any other row would
    // drift the badge away from what a refetch would say.
    if (!before.isRead && !before.isResolved) {
      this.unread.update((count) => Math.max(0, count - 1));
    }
  }

  async markAllRead(): Promise<void> {
    this.errorState.set(null);
    try {
      await firstValueFrom(this.api.markAllRead());
    } catch (error: unknown) {
      this.errorState.set(errorMessage(error));
      return;
    }
    this.data.update((items) => items.map((item) => ({ ...item, isRead: true })));
    this.unread.set(0);
  }

  reset(): void {
    this.data.set([]);
    this.unread.set(0);
    this.truncatedState.set(false);
    this.loadedState.set(false);
    this.errorState.set(null);
    this.loadingState.set(false);
  }

  private async fetch(): Promise<void> {
    const generation = ++this.fetchGeneration;
    this.loadingState.set(true);
    this.errorState.set(null);
    try {
      const response = await firstValueFrom(this.api.list());
      // A newer fetch has started since this one went out — its response
      // (or the error it threw) belongs to a view nobody is looking at any
      // more. Applying it now would overwrite rows a newer fetch (or a
      // `markRead`/`markAllRead` that landed in between) already settled.
      if (this.fetchGeneration !== generation) return;
      this.data.set(response.items);
      this.unread.set(response.unreadCount);
      this.truncatedState.set(response.truncated);
      this.loadedState.set(true);
    } catch (error: unknown) {
      if (this.fetchGeneration !== generation) return;
      this.errorState.set(errorMessage(error));
    } finally {
      // Likewise for `loading`: only the most recent fetch is allowed to
      // clear it, or an older one settling last would hide the progress
      // bar while the newer fetch is still running.
      if (this.fetchGeneration === generation) this.loadingState.set(false);
    }
  }
}
