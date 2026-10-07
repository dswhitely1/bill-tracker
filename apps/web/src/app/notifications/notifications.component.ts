import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { NotificationItem } from '@bill-tracker/shared-types';
import { NotificationsStore } from '../core/state/notifications.store';
import { SessionService } from '../core/auth/session.service';
import { CalendarDatePipe } from '../core/date/calendar-date.pipe';
import { formatMoney } from '../shared/money';
import { LIST_CAP_LABEL, kindLabel, notificationLink } from './notification-text';

interface Row {
  item: NotificationItem;
  label: string;
  amountLabel: string;
  queryParams: ReturnType<typeof notificationLink>;
}

@Component({
  selector: 'app-notifications',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatProgressBarModule,
    CalendarDatePipe,
  ],
  template: `
    <header class="page-header">
      <h1>Reminders</h1>
      @if (notificationsEnabled() && store.unreadCount() > 0) {
        <button
          matButton
          data-testid="mark-all-read"
          (click)="markAllRead()"
        >
          Mark all read
        </button>
      }
    </header>

    @if (store.loading()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (store.error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    @if (!notificationsEnabled()) {
      <p class="muted">
        @if (notifyEmail()) {
          In-app reminders are turned off, so nothing is shown here. Reminders are still
          being recorded, and turning them back on will reveal them.
        } @else {
          In-app reminders are turned off and email reminders are off too, so no
          reminders are being recorded right now. Turning in-app back on in settings
          will show reminders from that point forward, not any history from while
          both were off.
        }
      </p>
      <a matButton routerLink="/settings" data-testid="to-settings">Open settings</a>
    } @else if (rows().length === 0 && !store.loading() && store.error() === null) {
      <p class="muted">No reminders yet. They arrive three days and one day before a bill is due.</p>
    } @else {
      <mat-list>
        @for (row of rows(); track row.item.id) {
          <mat-list-item
            data-testid="notification-row"
            [class.unread]="!row.item.isRead"
          >
            <mat-icon matListItemIcon>{{ row.item.isResolved ? 'check_circle' : 'schedule' }}</mat-icon>
            <a
              matListItemTitle
              data-testid="notification-link"
              routerLink="/upcoming"
              [queryParams]="row.queryParams"
              (click)="markRead(row.item)"
            >
              {{ row.item.billName }}
            </a>
            <span matListItemLine>
              {{ row.label }} — {{ row.item.dueDate | calendarDate }} —
              @if (row.item.isResolved) {
                Paid
              } @else {
                {{ row.amountLabel }}
              }
            </span>
          </mat-list-item>
        }
      </mat-list>

      @if (store.truncated()) {
        <p class="muted">Showing the {{ capLabel }} reminders.</p>
      }
    }
  `,
  styles: `
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .unread {
      font-weight: 600;
    }
    .muted {
      opacity: 0.75;
    }
    .error {
      color: var(--mat-sys-error, #b3261e);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsComponent {
  protected readonly store = inject(NotificationsStore);
  private readonly session = inject(SessionService);

  protected readonly capLabel = LIST_CAP_LABEL;

  /**
   * The bell is hidden and this page explains itself rather than showing
   * an empty list, because "no reminders" would be false — and false is
   * exactly the wrong thing to tell someone about their bills.
   */
  protected readonly notificationsEnabled = computed(
    () => this.session.user()?.notifyInApp ?? true,
  );

  /**
   * Which explanation the toggles-off branch owes the user. With email
   * still on, reminders keep being recorded server-side (spec §4.3 joins
   * on `notify_in_app OR notify_email`) and reappear once in-app is
   * switched back on. With both off, the join produces no rows at all —
   * nothing is recorded — so promising that history will reappear would
   * be false; the only honest promise is reminders from that point on.
   */
  protected readonly notifyEmail = computed(() => this.session.user()?.notifyEmail ?? true);

  protected readonly rows = computed<Row[]>(() =>
    this.store.items().map((item) => ({
      item,
      label: kindLabel(item.kind),
      amountLabel: `${formatMoney(item.amountDue)} due`,
      queryParams: notificationLink(item),
    })),
  );

  constructor() {
    void this.store.load();
  }

  protected markRead(item: NotificationItem): void {
    if (item.isRead) return;
    void this.store.markRead(item.id);
  }

  protected markAllRead(): void {
    void this.store.markAllRead();
  }
}
