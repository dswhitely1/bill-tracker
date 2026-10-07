import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import type { NotificationItem } from '@bill-tracker/shared-types';
import { NotificationsStore } from '../core/state/notifications.store';
import { SessionService } from '../core/auth/session.service';
import { kindLabel, notificationLink } from '../notifications/notification-text';

interface BellRow {
  item: NotificationItem;
  label: string;
  queryParams: ReturnType<typeof notificationLink>;
}

@Component({
  selector: 'app-notification-bell',
  imports: [RouterLink, MatBadgeModule, MatButtonModule, MatIconModule, MatMenuModule],
  template: `
    @if (enabled()) {
      <button
        matIconButton
        data-testid="bell"
        [attr.aria-label]="label()"
        [matMenuTriggerFor]="menu"
      >
        <mat-icon
          [matBadge]="store.unreadCount()"
          [matBadgeHidden]="store.unreadCount() === 0"
          matBadgeSize="small"
          matBadgeColor="warn"
        >
          notifications
        </mat-icon>
      </button>

      <mat-menu #menu>
        @if (rows().length === 0) {
          <span mat-menu-item disabled data-testid="bell-empty">No reminders</span>
        } @else {
          @for (row of rows(); track row.item.id) {
            <a
              mat-menu-item
              data-testid="bell-item"
              routerLink="/upcoming"
              [queryParams]="row.queryParams"
              (click)="markRead(row.item)"
            >
              <span class="bill">{{ row.item.billName }}</span>
              <span class="horizon">{{ row.label }}</span>
            </a>
          }
        }
        <a mat-menu-item routerLink="/notifications" data-testid="bell-see-all">See all</a>
      </mat-menu>
    }
  `,
  styles: `
    .horizon {
      margin-left: 0.5rem;
      opacity: 0.7;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationBellComponent {
  protected readonly store = inject(NotificationsStore);
  private readonly session = inject(SessionService);

  /**
   * Hidden rather than emptied when the channel is off. A bell showing
   * zero would imply there is nothing due, which is a different claim
   * from "you asked not to be shown this".
   */
  protected readonly enabled = computed(() => this.session.user()?.notifyInApp ?? true);

  protected readonly rows = computed<BellRow[]>(() =>
    this.store.recent().map((item) => ({
      item,
      label: kindLabel(item.kind),
      queryParams: notificationLink(item),
    })),
  );

  /**
   * The count belongs in the accessible name, not only in the badge:
   * `matBadge` renders a visually-positioned span that a screen reader
   * reads out of context, if at all.
   */
  protected readonly label = computed(() => {
    const count = this.store.unreadCount();
    return count === 0 ? 'Reminders, none unread' : `Reminders, ${count} unread`;
  });

  constructor() {
    void this.store.load();
  }

  protected markRead(item: NotificationItem): void {
    if (item.isRead) return;
    void this.store.markRead(item.id);
  }
}
