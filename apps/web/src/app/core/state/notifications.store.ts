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
    this.loadingState.set(true);
    this.errorState.set(null);
    try {
      const response = await firstValueFrom(this.api.list());
      this.data.set(response.items);
      this.unread.set(response.unreadCount);
      this.truncatedState.set(response.truncated);
      this.loadedState.set(true);
    } catch (error: unknown) {
      this.errorState.set(errorMessage(error));
    } finally {
      this.loadingState.set(false);
    }
  }
}
