import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { BillInstanceResponse } from '@bill-tracker/shared-types';
import { FieldErrorsComponent } from '../shared/field-errors.component';
import { MAX_AMOUNT, MIN_AMOUNT, amountValidators, formatMoney } from '../shared/money';

export interface PaymentDialogData {
  instance: BillInstanceResponse;
}

export interface PaymentDialogResult {
  /** Undefined means "the remaining balance" — the server computes it. */
  amount?: number;
  note?: string | null;
}

@Component({
  selector: 'app-payment-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    FieldErrorsComponent,
  ],
  template: `
    <h2 mat-dialog-title>Record a payment</h2>
    <mat-dialog-content>
      <p>
        {{ data.instance.billName }} — {{ owed }} remaining of
        {{ total }}.
      </p>

      <form [formGroup]="form" class="dialog-form">
        <mat-checkbox formControlName="payInFull" cdkFocusInitial>
          Pay the full remaining balance
        </mat-checkbox>

        @if (!form.controls.payInFull.value) {
          <mat-form-field>
            <mat-label>Amount</mat-label>
            <input
              matInput
              type="number"
              step="0.01"
              [min]="minAmount"
              [max]="maxAmount"
              formControlName="amount"
            />
            <span matTextPrefix>$&nbsp;</span>
            <app-field-errors [control]="form.controls.amount" label="Amount" />
          </mat-form-field>
        }

        <mat-form-field>
          <mat-label>Note (optional)</mat-label>
          <input matInput formControlName="note" />
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Cancel</button>
      <button matButton="filled" [disabled]="form.invalid" (click)="save()">Record</button>
    </mat-dialog-actions>
  `,
  styles: `
    .dialog-form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      min-width: 20rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentDialogComponent {
  private readonly fb = inject(FormBuilder);
  protected readonly data = inject<PaymentDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<PaymentDialogComponent, PaymentDialogResult | undefined>>(MatDialogRef);

  protected readonly minAmount = MIN_AMOUNT;
  protected readonly maxAmount = MAX_AMOUNT;
  protected readonly owed = formatMoney(this.data.instance.amount - this.data.instance.amountPaid);
  protected readonly total = formatMoney(this.data.instance.amount);

  readonly form = this.fb.nonNullable.group({
    payInFull: [true],
    amount: [this.data.instance.amount - this.data.instance.amountPaid, amountValidators],
    note: this.fb.control<string | null>(null),
  });

  constructor() {
    // The amount control carries `required` (shared/money's amountValidators)
    // so clearing it cannot silently fall through to "pay the full balance"
    // (see payments.service's `dto.amount ?? balance`). Disabling it while
    // paying in full keeps that validator from blocking submission when the
    // field is hidden and irrelevant — `getRawValue()` still reports a
    // disabled control's value, so `save()` is unaffected.
    this.form.controls.amount.disable();
    this.form.controls.payInFull.valueChanges.pipe(takeUntilDestroyed()).subscribe((payInFull) => {
      if (payInFull) {
        this.form.controls.amount.disable();
      } else {
        this.form.controls.amount.enable();
      }
    });
  }

  /**
   * "Pay in full" omits `amount` entirely rather than sending the figure
   * displayed above. The displayed number is for reading; the server's,
   * computed under a row lock, is the one that is correct when something
   * else has paid part of this instance since the dialog opened.
   */
  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    const { payInFull, amount, note } = this.form.getRawValue();
    this.dialogRef.close({
      ...(payInFull ? {} : { amount }),
      note: note === '' ? null : note,
    });
  }
}
