import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { firstValueFrom } from 'rxjs';
import type { BillFrequency, BillResponse } from '@bill-tracker/shared-types';
import { errorMessage } from '../core/api/api-error';
import { BillsStore } from '../core/state/bills.store';
import { CategoriesStore } from '../core/state/categories.store';
import { CalendarDatePipe } from '../core/date/calendar-date.pipe';
import { ConfirmDialogComponent, ConfirmDialogResult } from '../shared/confirm-dialog.component';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { NotificationService } from '../shared/notification.service';
import { formatMoney } from '../shared/money';

export const FREQUENCY_LABELS: Record<BillFrequency, string> = {
  ONE_TIME: 'One time',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  ANNUALLY: 'Annually',
};

@Component({
  selector: 'app-bills',
  imports: [
    RouterLink,
    MatButtonModule,
    MatChipsModule,
    MatDialogModule,
    MatIconModule,
    MatProgressBarModule,
    MatTableModule,
    CalendarDatePipe,
    EmptyStateComponent,
  ],
  template: `
    <header class="page-header">
      <h1>Bills</h1>
      <a matButton="filled" routerLink="/bills/new">
        <mat-icon>add</mat-icon>
        New bill
      </a>
    </header>

    @if (store.loading()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (store.error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    } @else if (store.isEmpty()) {
      <app-empty-state
        icon="receipt_long"
        title="No bills yet"
        message="A bill is a template. Create one and the app generates every occurrence it is due on."
      >
        <a matButton="filled" routerLink="/bills/new">Create your first bill</a>
      </app-empty-state>
    } @else {
      <table mat-table [dataSource]="store.bills()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let bill">
            <a [routerLink]="['/bills', bill.id]">{{ bill.name }}</a>
            @if (!bill.isActive) {
              <mat-chip class="inactive">Inactive</mat-chip>
            }
          </td>
        </ng-container>

        <ng-container matColumnDef="amount">
          <th mat-header-cell *matHeaderCellDef>Amount</th>
          <td mat-cell *matCellDef="let bill">{{ money(bill.defaultAmount) }}</td>
        </ng-container>

        <ng-container matColumnDef="frequency">
          <th mat-header-cell *matHeaderCellDef>Frequency</th>
          <td mat-cell *matCellDef="let bill">{{ frequencyLabel(bill.frequency) }}</td>
        </ng-container>

        <ng-container matColumnDef="category">
          <th mat-header-cell *matHeaderCellDef>Category</th>
          <td mat-cell *matCellDef="let bill">{{ categoryName(bill.categoryId) }}</td>
        </ng-container>

        <ng-container matColumnDef="starts">
          <th mat-header-cell *matHeaderCellDef>Starts</th>
          <td mat-cell *matCellDef="let bill">{{ bill.startDate | calendarDate }}</td>
        </ng-container>

        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef aria-label="Actions"></th>
          <td mat-cell *matCellDef="let bill">
            <button
              matIconButton
              [attr.aria-label]="'Delete ' + bill.name"
              (click)="confirmRemove(bill)"
            >
              <mat-icon>delete</mat-icon>
            </button>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
    }

    @if (lastError(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }
  `,
  styles: `
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    table {
      width: 100%;
    }
    .inactive {
      margin-left: 0.5rem;
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BillsComponent {
  protected readonly store = inject(BillsStore);
  private readonly categories = inject(CategoriesStore);
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);

  protected readonly columns = ['name', 'amount', 'frequency', 'category', 'starts', 'actions'];
  readonly lastError = signal<string | null>(null);

  private readonly categoryNames = computed(
    () => new Map(this.categories.categories().map((c) => [c.id, c.name])),
  );

  constructor() {
    void this.store.load();
    void this.categories.load();
  }

  protected money(value: number): string {
    return formatMoney(value);
  }

  protected frequencyLabel(frequency: BillFrequency): string {
    return FREQUENCY_LABELS[frequency];
  }

  protected categoryName(categoryId: string | null): string {
    return categoryId === null ? 'Uncategorised' : (this.categoryNames().get(categoryId) ?? '—');
  }

  /**
   * Deleting a bill is a real delete that cascades through its instances
   * and their payment logs. The API offers `PATCH { isActive: false }` as
   * the non-destructive path, so the dialog offers it too — and gives it
   * initial focus, because losing payment history to a reflexive Enter
   * keypress is not a recoverable mistake.
   */
  async confirmRemove(bill: BillResponse): Promise<void> {
    const choice = await firstValueFrom(
      this.dialog
        .open<ConfirmDialogComponent, unknown, ConfirmDialogResult>(ConfirmDialogComponent, {
          data: {
            title: `Delete ${bill.name}?`,
            message:
              'This permanently deletes the bill, every occurrence it generated, and their payment history. Deactivating stops new occurrences and keeps every record.',
            confirmLabel: 'Delete permanently',
            alternateLabel: 'Deactivate instead',
          },
        })
        .afterClosed(),
    );

    try {
      if (choice === 'confirm') {
        await this.store.remove(bill.id);
        this.notifications.success(`Deleted ${bill.name}`);
      } else if (choice === 'alternate') {
        await this.store.update(bill.id, { isActive: false });
        this.notifications.success(`Deactivated ${bill.name}`);
      } else {
        return;
      }
      this.lastError.set(null);
    } catch (error: unknown) {
      this.lastError.set(errorMessage(error));
    }
  }
}
