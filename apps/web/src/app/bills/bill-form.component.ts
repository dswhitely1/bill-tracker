import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { BILL_FREQUENCIES } from '@bill-tracker/shared-types';
import type { BillFrequency } from '@bill-tracker/shared-types';
import { errorMessage } from '../core/api/api-error';
import { BillsStore } from '../core/state/bills.store';
import { CategoriesStore } from '../core/state/categories.store';
import { FieldErrorsComponent } from '../shared/field-errors.component';
import { NotificationService } from '../shared/notification.service';
import { MAX_AMOUNT, amountValidators } from '../shared/money';
import { applyServerErrors } from '../shared/server-errors';
import { endDateAfterStart } from './date-range.validator';
import { FREQUENCY_LABELS } from './bills.component';

@Component({
  selector: 'app-bill-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    FieldErrorsComponent,
  ],
  template: `
    <mat-card>
      @if (busy()) {
        <mat-progress-bar mode="indeterminate" />
      }
      <mat-card-header>
        <mat-card-title>{{ billId() ? 'Edit bill' : 'New bill' }}</mat-card-title>
      </mat-card-header>

      <mat-card-content>
        @if (billId()) {
          <p class="notice" role="status">
            Saving rewrites every future occurrence that is still unpaid and has not been
            edited on its own. Occurrences you have already paid or customised are left alone.
          </p>
        }

        @for (message of formErrors(); track message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }

        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field>
            <mat-label>Name</mat-label>
            <input matInput formControlName="name" />
            <app-field-errors [control]="form.controls.name" label="Name" />
          </mat-form-field>

          <mat-form-field>
            <mat-label>Amount</mat-label>
            <input matInput type="number" step="0.01" min="0.01" [max]="maxAmount" formControlName="defaultAmount" />
            <span matTextPrefix>$&nbsp;</span>
            <app-field-errors [control]="form.controls.defaultAmount" label="Amount" />
          </mat-form-field>

          <mat-form-field>
            <mat-label>Frequency</mat-label>
            <mat-select formControlName="frequency">
              @for (frequency of frequencies; track frequency) {
                <mat-option [value]="frequency">{{ label(frequency) }}</mat-option>
              }
            </mat-select>
            <app-field-errors [control]="form.controls.frequency" label="Frequency" />
          </mat-form-field>

          <mat-form-field>
            <mat-label>Category</mat-label>
            <mat-select formControlName="categoryId">
              <mat-option [value]="null">Uncategorised</mat-option>
              @for (category of categories.categories(); track category.id) {
                <mat-option [value]="category.id">{{ category.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field>
            <mat-label>Starts</mat-label>
            <input matInput [matDatepicker]="startPicker" formControlName="startDate" />
            <mat-datepicker-toggle matIconSuffix [for]="startPicker" />
            <mat-datepicker #startPicker />
            <app-field-errors [control]="form.controls.startDate" label="Start date" />
          </mat-form-field>

          <mat-form-field>
            <mat-label>Ends (optional)</mat-label>
            <input matInput [matDatepicker]="endPicker" formControlName="endDate" />
            <mat-datepicker-toggle matIconSuffix [for]="endPicker" />
            <mat-datepicker #endPicker />
            <mat-hint>Leave empty for a bill that never ends.</mat-hint>
          </mat-form-field>

          @if (form.errors?.['endBeforeStart']) {
            <p class="form-error" role="alert">The end date must not precede the start date.</p>
          }

          @if (billId()) {
            <mat-checkbox formControlName="isActive">
              Active — generate future occurrences
            </mat-checkbox>
          }

          <div class="actions">
            <a matButton routerLink="/bills">Cancel</a>
            <button matButton="filled" type="submit" [disabled]="busy()">Save</button>
          </div>
        </form>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    mat-card {
      max-width: 36rem;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .notice {
      margin: 0 0 1rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .form-error {
      margin: 0 0 1rem;
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BillFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly store = inject(BillsStore);
  protected readonly categories = inject(CategoriesStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly notifications = inject(NotificationService);

  protected readonly frequencies = BILL_FREQUENCIES;
  protected readonly maxAmount = MAX_AMOUNT;

  readonly billId = signal<string | null>(this.route.snapshot.paramMap.get('id'));
  readonly submitting = signal(false);
  readonly loading = signal(false);
  readonly busy = computed(() => this.submitting() || this.loading());
  readonly formErrors = signal<string[]>([]);

  readonly form = this.fb.nonNullable.group(
    {
      name: ['', [Validators.required, Validators.maxLength(100)]],
      defaultAmount: [0, amountValidators],
      frequency: ['MONTHLY' as BillFrequency, [Validators.required]],
      categoryId: this.fb.control<string | null>(null),
      startDate: ['', [Validators.required]],
      endDate: this.fb.control<string | null>(null),
      isActive: [true],
    },
    { validators: [endDateAfterStart] },
  );

  constructor() {
    void this.categories.load();
    const id = this.billId();
    if (id !== null) void this.loadBill(id);
  }

  protected label(frequency: BillFrequency): string {
    return FREQUENCY_LABELS[frequency];
  }

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.formErrors.set([]);

    const raw = this.form.getRawValue();
    const id = this.billId();
    const body = {
      name: raw.name,
      defaultAmount: raw.defaultAmount,
      frequency: raw.frequency,
      startDate: raw.startDate,
      endDate: raw.endDate === '' ? null : raw.endDate,
      categoryId: raw.categoryId,
    };

    const saved = id === null ? this.store.create(body) : this.store.update(id, { ...body, isActive: raw.isActive });

    saved
      .then(() => {
        this.notifications.success(id === null ? 'Bill created' : 'Bill saved');
        void this.router.navigateByUrl('/bills');
      })
      .catch((error: unknown) => {
        this.formErrors.set(applyServerErrors(this.form, error));
      })
      .finally(() => this.submitting.set(false));
  }

  private async loadBill(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const bill = await this.store.get(id);
      this.form.patchValue(bill);
    } catch (error: unknown) {
      this.formErrors.set([errorMessage(error)]);
    } finally {
      this.loading.set(false);
    }
  }
}
