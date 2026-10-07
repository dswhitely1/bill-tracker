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
   * Monotonic request generation. Bumped in two situations, both of which
   * make an in-flight `fetch()` response stale:
   *
   * - Two fetches overlap and resolve out of order — e.g. two
   *   `visibilitychange` refreshes close together — so whichever started
   *   later must win even if it resolves first.
   * - A `markRead`/`markAllRead` call succeeds against the server while a
   *   fetch is still in flight. That fetch's response was computed from
   *   server state *before* the mutation, so applying it now would revert
   *   the row the mutation just changed — reading as the app losing the
   *   click. Bumping here, not in `fetch()`, is what lets this one counter
   *   catch both: a read racing a newer read, and a read racing a write.
   *
   * Same shape as `InstancesStore.fetchGeneration`, guarding against the
   * same kind of late arrival.
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

    // The server write succeeded, so server state has moved on from
    // whatever any already in-flight fetch is about to return. Bumping
    // here — only on the success path, since a failed write leaves server
    // state untouched and an in-flight fetch's response still accurate —
    // makes that fetch's eventual write a no-op instead of a silent
    // revert of the row being patched below. The traded cost is accepted:
    // the in-flight response is discarded wholesale, so any rows that
    // arrived server-side during that window wait for the next refresh
    // rather than appearing immediately. That is strictly better than
    // reverting the click the user just made.
    this.fetchGeneration++;

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
    // Same reasoning as `markRead`: only a successful write can have
    // moved server state, so only a successful write invalidates a fetch
    // already in flight.
    this.fetchGeneration++;
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
