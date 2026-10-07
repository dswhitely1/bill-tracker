import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatInputHarness } from '@angular/material/input/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentDialogComponent, PaymentDialogResult } from './payment-dialog.component';

const instance = {
  id: 'inst-1',
  billId: 'bill-1',
  billName: 'Rent',
  categoryId: null,
  dueDate: '2026-10-01',
  amount: 1200,
  amountPaid: 500,
  status: 'PARTIALLY_PAID' as const,
  isOverdue: false,
  isCustomized: false,
  paidAt: null,
  note: null,
};

const AMOUNT_FIELD = MatInputHarness.with({ selector: 'input[type=number]' });

let fixture: ComponentFixture<PaymentDialogComponent>;
let loader: HarnessLoader;
let close: ReturnType<typeof vi.fn<(result?: PaymentDialogResult) => void>>;

beforeEach(async () => {
  close = vi.fn<(result?: PaymentDialogResult) => void>();
  TestBed.configureTestingModule({
    imports: [PaymentDialogComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      { provide: MAT_DIALOG_DATA, useValue: { instance } },
      { provide: MatDialogRef, useValue: { close } },
    ],
  });
  fixture = TestBed.createComponent(PaymentDialogComponent);
  loader = TestbedHarnessEnvironment.loader(fixture);
  await fixture.whenStable();
});

describe('PaymentDialogComponent', () => {
  it('shows what is still owed beside the full amount', () => {
    expect(fixture.nativeElement.textContent).toContain('$700.00');
    expect(fixture.nativeElement.textContent).toContain('$1,200.00');
  });

  it('defaults to paying the full remaining balance', async () => {
    expect(await (await loader.getHarness(MatCheckboxHarness)).isChecked()).toBe(true);
  });

  it('omits the amount entirely when paying in full', async () => {
    // The assertion that matters. Sending the displayed $700.00 would be
    // correct only until something else pays part of this instance between
    // the dialog opening and the request landing — which is exactly what
    // the server row lock exists to settle.
    fixture.componentInstance.save();

    expect(close).toHaveBeenCalledWith({ note: null });
    expect(close.mock.calls[0][0]).not.toHaveProperty('amount');
  });

  it('hides the amount field until paying in full is unchecked', async () => {
    expect(await loader.getHarnessOrNull(AMOUNT_FIELD)).toBeNull();

    await (await loader.getHarness(MatCheckboxHarness)).uncheck();
    await fixture.whenStable();

    expect(await loader.getHarnessOrNull(AMOUNT_FIELD)).not.toBeNull();
  });

  it('will not record a null amount when the field is cleared', async () => {
    // Regression: amount had no `required` validator, so clearing it left
    // the form valid and save() closed with `{ amount: null }`. The server
    // treats a null amount as "pay the full balance" (payments.service's
    // `dto.amount ?? balance`), so this used to record the whole balance
    // for a partial payment the user never typed.
    await (await loader.getHarness(MatCheckboxHarness)).uncheck();
    await fixture.whenStable();

    await (await loader.getHarness(AMOUNT_FIELD)).setValue('');
    await fixture.whenStable();

    expect(fixture.componentInstance.form.invalid).toBe(true);

    fixture.componentInstance.save();

    expect(close).not.toHaveBeenCalled();
  });

  it('sends a typed partial amount as a number', async () => {
    await (await loader.getHarness(MatCheckboxHarness)).uncheck();
    await fixture.whenStable();

    await (await loader.getHarness(AMOUNT_FIELD)).setValue('250');
    await fixture.whenStable();

    fixture.componentInstance.save();

    expect(close).toHaveBeenCalledWith({ amount: 250, note: null });
  });
});
