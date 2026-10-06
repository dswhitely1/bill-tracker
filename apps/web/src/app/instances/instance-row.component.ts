import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import type { BillInstanceResponse, BillStatus } from '@bill-tracker/shared-types';
import { CalendarDatePipe } from '../core/date/calendar-date.pipe';
import { formatMoney } from '../shared/money';

const STATUS_LABELS: Record<BillStatus, string> = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
};

@Component({
  selector: 'app-instance-row',
  imports: [MatChipsModule, CalendarDatePipe],
  template: `
    <div class="row">
      <div class="identity">
        <span class="name">{{ instance().billName }}</span>
        <span class="due">{{ instance().dueDate | calendarDate }}</span>
      </div>

      <div class="amounts">
        <span class="owed">{{ owed() }}</span>
        @if (instance().amountPaid > 0) {
          <span class="paid">{{ paid() }} paid of {{ total() }}</span>
        }
      </div>

      <div class="badges">
        <mat-chip [class.paid-chip]="instance().status === 'PAID'">{{ statusLabel() }}</mat-chip>
        @if (instance().isOverdue) {
          <mat-chip class="overdue-chip">Overdue</mat-chip>
        }
        @if (instance().isCustomized) {
          <mat-chip class="custom-chip" title="Edited on its own; template changes leave it alone">
            Customised
          </mat-chip>
        }
      </div>

      <div class="actions">
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    .row {
      display: grid;
      grid-template-columns: 1fr auto auto auto;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .identity,
    .amounts {
      display: flex;
      flex-direction: column;
    }
    .name {
      font: var(--mat-sys-title-small);
    }
    .due,
    .paid {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .badges {
      display: flex;
      gap: 0.25rem;
    }
    .overdue-chip {
      --mat-chip-elevated-container-color: var(--mat-sys-error-container);
    }
    @media (max-width: 48rem) {
      .row {
        grid-template-columns: 1fr;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstanceRowComponent {
  readonly instance = input.required<BillInstanceResponse>();

  /**
   * The remaining balance is shown, never submitted. "Pay in full" sends an
   * empty body and lets the server compute this figure under a row lock;
   * a client-computed one races every other writer.
   */
  readonly owed = computed(() => formatMoney(this.instance().amount - this.instance().amountPaid));
  readonly paid = computed(() => formatMoney(this.instance().amountPaid));
  readonly total = computed(() => formatMoney(this.instance().amount));
  readonly statusLabel = computed(() => STATUS_LABELS[this.instance().status]);
}
