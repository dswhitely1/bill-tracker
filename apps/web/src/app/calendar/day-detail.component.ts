import { ChangeDetectionStrategy, Component, inject, input, linkedSignal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import type { BillInstanceResponse } from '@bill-tracker/shared-types';
import { CalendarDate } from '../core/date/calendar-date';
import { CalendarDatePipe } from '../core/date/calendar-date.pipe';
import { InstanceActionsService } from '../instances/instance-actions.service';
import { InstanceRowComponent } from '../instances/instance-row.component';

/**
 * One day's bills, with the same actions the list offers.
 *
 * Every mutation goes through `InstanceActionsService`, which itself goes
 * through the shipped dialogs and `PaymentsService` — the same seam
 * `UpcomingComponent` uses, so a rule enforced on /upcoming cannot be
 * missing here. This component owns nothing but the delegation and its
 * own error signal.
 */
@Component({
  selector: 'app-day-detail',
  imports: [MatButtonModule, MatCardModule, CalendarDatePipe, InstanceRowComponent],
  template: `
    <mat-card class="panel">
      <mat-card-header>
        <mat-card-title>{{ date() | calendarDate }}</mat-card-title>
      </mat-card-header>

      <mat-card-content>
        @if (actionError(); as message) {
          <p class="error" role="alert">{{ message }}</p>
        }

        @if (instances().length === 0) {
          <p class="empty">Nothing due on this day.</p>
        } @else {
          @for (instance of instances(); track instance.id) {
            <app-instance-row [instance]="instance">
              @if (instance.status !== 'PAID') {
                <button matButton="filled" data-testid="pay" (click)="openPayment(instance)">
                  Record payment
                </button>
              }
              @if (instance.amountPaid !== 0) {
                <button matButton data-testid="clear" (click)="confirmUnpay(instance)">
                  Clear all payments
                </button>
              }
            </app-instance-row>
          }
        }
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    .panel {
      margin-top: 1rem;
    }
    .error {
      color: var(--mat-sys-error);
    }
    .empty {
      color: var(--mat-sys-on-surface-variant);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DayDetailComponent {
  readonly date = input.required<CalendarDate>();
  readonly instances = input.required<BillInstanceResponse[]>();

  private readonly actions = inject(InstanceActionsService);

  /**
   * A `linkedSignal`, not a plain `signal`: `CalendarComponent` renders
   * this component behind `@if (selected(); as day) { ... }`, which only
   * destroys and recreates the view on a truthy↔falsy transition of
   * `selected()` — not when one non-null day replaces another. The same
   * `DayDetailComponent` instance survives a day-to-day switch, so a plain
   * signal would carry yesterday's error into today's panel. Resetting to
   * `null` whenever `date()` changes is exactly what `linkedSignal`'s
   * `source`/`computation` pair is for.
   */
  readonly actionError = linkedSignal<CalendarDate, string | null>({
    source: this.date,
    computation: () => null,
  });

  async openPayment(instance: BillInstanceResponse): Promise<void> {
    const result = await this.actions.recordPayment(instance);
    this.actionError.set(result.ok ? null : result.message);
  }

  async confirmUnpay(instance: BillInstanceResponse): Promise<void> {
    const result = await this.actions.clearPayments(instance);
    this.actionError.set(result.ok ? null : result.message);
  }
}
