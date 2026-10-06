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
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { BILL_STATUSES } from '@bill-tracker/shared-types';
import type { BillStatus } from '@bill-tracker/shared-types';
import { InstancesStore } from '../core/state/instances.store';
import { CalendarDate, today } from '../core/date/calendar-date';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { InstanceRowComponent } from './instance-row.component';

@Component({
  selector: 'app-upcoming',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    EmptyStateComponent,
    InstanceRowComponent,
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

    @if (store.isEmpty()) {
      <app-empty-state
        icon="event_available"
        title="Nothing due in this range"
        message="Widen the dates, or create a bill so occurrences can be generated."
      />
    } @else {
      @for (instance of store.instances(); track instance.id) {
        <app-instance-row [instance]="instance" />
      }
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
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpcomingComponent {
  protected readonly store = inject(InstancesStore);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly statuses = BILL_STATUSES;

  readonly status = signal<BillStatus | null>(null);
  readonly overdue = signal<boolean | null>(null);

  /** The browser day the current rows were fetched on — see `refreshIfDayChanged`. */
  readonly renderedOn = signal<CalendarDate>(today());

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
   * The current day is a parameter so this is testable without stubbing
   * the clock.
   */
  refreshIfDayChanged(now: CalendarDate = today()): void {
    if (now === this.renderedOn()) return;
    this.renderedOn.set(now);
    void this.store.refresh();
  }

  private async load(): Promise<void> {
    const { from, to } = this.rangeForm.getRawValue();
    this.renderedOn.set(today());
    await this.store.setQuery({
      from,
      to,
      ...(this.status() === null ? {} : { status: this.status() as BillStatus }),
      ...(this.overdue() === null ? {} : { overdue: this.overdue() as boolean }),
    });
  }
}
