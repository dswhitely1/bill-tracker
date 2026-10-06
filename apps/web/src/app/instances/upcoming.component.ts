import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { BILL_STATUSES } from '@bill-tracker/shared-types';
import type { BillInstanceResponse, BillStatus } from '@bill-tracker/shared-types';
import { errorMessage } from '../core/api/api-error';
import { CalendarDate, today } from '../core/date/calendar-date';
import { InstancesStore } from '../core/state/instances.store';
import { PaymentsService } from '../core/state/payments.service';
import { ConfirmDialogComponent, ConfirmDialogResult } from '../shared/confirm-dialog.component';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { NotificationService } from '../shared/notification.service';
import { InstanceRowComponent } from './instance-row.component';
import { PaymentDialogComponent, PaymentDialogResult } from './payment-dialog.component';
import { PaymentHistoryComponent } from './payment-history.component';

@Component({
  selector: 'app-upcoming',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDatepickerModule,
    MatDialogModule,
    MatExpansionModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    EmptyStateComponent,
    InstanceRowComponent,
    PaymentHistoryComponent,
  ],
  template: `
    <header class="page-header">
      <h1>Upcoming</h1>
    </header>

    <form [formGroup]="rangeForm" class="range" (ngSubmit)="applyRange()">
      <mat-form-field>
        <mat-label>From</mat-label>
        <input matInput [matDatepicker]="fromPicker" formControlName="from" />
        <mat-datepicker-toggle matIconSuffix [for]="fromPicker" />
        <mat-datepicker #fromPicker />
      </mat-form-field>

      <mat-form-field>
        <mat-label>To</mat-label>
        <input matInput [matDatepicker]="toPicker" formControlName="to" />
        <mat-datepicker-toggle matIconSuffix [for]="toPicker" />
        <mat-datepicker #toPicker />
      </mat-form-field>

      <mat-form-field>
        <mat-label>Status</mat-label>
        <mat-select [value]="status()" (valueChange)="setStatus($event)">
          <mat-option [value]="null">Any</mat-option>
          @for (value of statuses; track value) {
            <mat-option [value]="value">{{ value }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field>
        <mat-label>Overdue</mat-label>
        <mat-select [value]="overdue()" (valueChange)="setOverdue($event)">
          <mat-option [value]="null">Any</mat-option>
          <mat-option [value]="true">Overdue only</mat-option>
          <mat-option [value]="false">Not overdue</mat-option>
        </mat-select>
      </mat-form-field>

      <button matButton="filled" type="submit">Apply</button>
    </form>

    @if (store.loading()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (store.error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    @if (actionError(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    @if (store.isEmpty()) {
      <app-empty-state
        icon="event_available"
        title="Nothing due in this range"
        message="Widen the dates, or create a bill so occurrences can be generated."
      />
    } @else {
      <mat-accordion multi>
        @for (instance of store.instances(); track instance.id) {
          <mat-expansion-panel>
            <mat-expansion-panel-header>
              <app-instance-row [instance]="instance" />
            </mat-expansion-panel-header>

            <!--
              The body is deferred behind matExpansionPanelContent on purpose.
              A panel renders its content eagerly by default, which would mount
              one app-payment-history per instance and fire a GET /payments for
              every row the moment the screen loads — thirty requests to show
              thirty collapsed rows. Deferred, the log is read when a person
              actually opens a row, which is what spec §11 describes.
            -->
            <ng-template matExpansionPanelContent>
              <div class="instance-actions">
                @if (instance.status !== 'PAID') {
                  <button matButton="filled" (click)="openPayment(instance)">Record payment</button>
                }
                @if (instance.amountPaid !== 0) {
                  <button matButton (click)="confirmUnpay(instance)">Clear all payments</button>
                }
              </div>

              <app-payment-history [instanceId]="instance.id" />
            </ng-template>
          </mat-expansion-panel>
        }
      </mat-accordion>
    }
  `,
  styles: `
    .range {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .error {
      color: var(--mat-sys-error);
    }
    .instance-actions {
      display: flex;
      gap: 0.5rem;
      margin-bottom: 1rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpcomingComponent {
  protected readonly store = inject(InstancesStore);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);
  private readonly dialog = inject(MatDialog);
  private readonly payments = inject(PaymentsService);
  private readonly notifications = inject(NotificationService);

  protected readonly statuses = BILL_STATUSES;

  readonly status = signal<BillStatus | null>(null);
  readonly overdue = signal<boolean | null>(null);
  readonly actionError = signal<string | null>(null);

  readonly rangeForm = this.fb.nonNullable.group({
    from: this.store.query().from,
    to: this.store.query().to,
  });

  constructor() {
    void this.load();

    const onFocus = (): void => this.refreshIfDayChanged();
    window.addEventListener('focus', onFocus);
    this.destroyRef.onDestroy(() => window.removeEventListener('focus', onFocus));
  }

  applyRange(): Promise<void> {
    return this.load();
  }

  setStatus(value: BillStatus | null): void {
    this.status.set(value);
  }

  setOverdue(value: boolean | null): void {
    this.overdue.set(value);
  }

  /**
   * `isOverdue` is computed against the server's `APP_TIMEZONE` at the
   * moment of the request, so it goes stale when the day turns over. A tab
   * left open overnight would otherwise show yesterday's answer until
   * someone reloaded it.
   *
   * Compared against the store's `fetchedOn`, not a marker this component
   * sets itself. A refused range (over-wide, backwards) never reaches a
   * fetch, so a component-owned marker bumped on every `load()` call would
   * be advanced by a request that never happened — convincing this check
   * that yesterday's rows are fresh. The store only advances its marker
   * when a fetch actually succeeds, so there is nothing to desynchronise.
   *
   * The current day is a parameter so this is testable without stubbing
   * the clock.
   */
  refreshIfDayChanged(now: CalendarDate = today()): void {
    if (now === this.store.fetchedOn()) return;
    void this.store.refresh();
  }

  async openPayment(instance: BillInstanceResponse): Promise<void> {
    const result = await firstValueFrom(
      this.dialog
        .open<PaymentDialogComponent, unknown, PaymentDialogResult | undefined>(
          PaymentDialogComponent,
          { data: { instance } },
        )
        .afterClosed(),
    );
    if (!result) return;

    try {
      const { instance: updated } = await this.payments.record(instance.id, result);
      this.actionError.set(null);
      this.notifications.success(
        updated.status === 'PAID'
          ? `${updated.billName} is paid`
          : `Recorded a payment for ${updated.billName}`,
      );
    } catch (error: unknown) {
      this.actionError.set(errorMessage(error));
    }
  }

  /**
   * `unpay` writes reversals for every live payment rather than deleting
   * rows, so the history survives. The dialog says so, because "clear"
   * otherwise sounds like it erases the record.
   */
  async confirmUnpay(instance: BillInstanceResponse): Promise<void> {
    const choice = await firstValueFrom(
      this.dialog
        .open<ConfirmDialogComponent, unknown, ConfirmDialogResult>(ConfirmDialogComponent, {
          data: {
            title: `Clear payments for ${instance.billName}?`,
            message:
              'This records a reversal for each payment. The original entries stay in the history.',
            confirmLabel: 'Clear payments',
          },
        })
        .afterClosed(),
    );
    if (choice !== 'confirm') return;

    try {
      await this.payments.unpay(instance.id);
      this.actionError.set(null);
    } catch (error: unknown) {
      this.actionError.set(errorMessage(error));
    }
  }

  private async load(): Promise<void> {
    const { from, to } = this.rangeForm.getRawValue();
    await this.store.setQuery({
      from,
      to,
      ...(this.status() === null ? {} : { status: this.status() as BillStatus }),
      ...(this.overdue() === null ? {} : { overdue: this.overdue() as boolean }),
    });
  }
}
