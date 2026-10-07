import { HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  BillInstanceResponse,
  PaymentResultResponse,
  RecordPaymentRequest,
} from '@bill-tracker/shared-types';
import { PaymentsService } from '../core/state/payments.service';
import { NotificationService } from '../shared/notification.service';
import { InstanceActionsService } from './instance-actions.service';

const instance: BillInstanceResponse = {
  id: 'inst-1',
  billId: 'bill-1',
  billName: 'Rent',
  categoryId: 'cat-1',
  dueDate: '2026-10-09',
  amount: 1200,
  amountPaid: 0,
  status: 'UNPAID',
  isOverdue: false,
  isCustomized: false,
  paidAt: null,
  note: null,
};

const payment = {
  id: 'pay-1',
  billInstanceId: 'inst-1',
  amountPaid: 1200,
  paidAt: '2026-10-09T00:00:00.000Z',
  note: null,
  reversesPaymentId: null,
};

let dialogOpen: ReturnType<typeof vi.fn<(...args: unknown[]) => { afterClosed: () => unknown }>>;
let record: ReturnType<
  typeof vi.fn<(id: string, body?: RecordPaymentRequest) => Promise<PaymentResultResponse>>
>;
let unpay: ReturnType<typeof vi.fn<(id: string) => Promise<BillInstanceResponse>>>;
let success: ReturnType<typeof vi.fn<(message: string) => void>>;
let service: InstanceActionsService;

function dialogCloses(value: unknown): void {
  dialogOpen.mockReturnValue({ afterClosed: () => of(value) });
}

beforeEach(() => {
  dialogOpen = vi.fn<(...args: unknown[]) => { afterClosed: () => unknown }>();
  record = vi.fn<(id: string, body?: RecordPaymentRequest) => Promise<PaymentResultResponse>>();
  unpay = vi.fn<(id: string) => Promise<BillInstanceResponse>>();
  success = vi.fn<(message: string) => void>();

  TestBed.configureTestingModule({
    providers: [
      { provide: MatDialog, useValue: { open: dialogOpen } },
      { provide: PaymentsService, useValue: { record, unpay } },
      {
        provide: NotificationService,
        useValue: { success, error: vi.fn<(message: string) => void>() },
      },
    ],
  });
  service = TestBed.inject(InstanceActionsService);
});

describe('InstanceActionsService.recordPayment', () => {
  it('sends nothing and reports ok when the dialog is dismissed', async () => {
    dialogCloses(undefined);

    const result = await service.recordPayment(instance);

    expect(result).toEqual({ ok: true });
    expect(record).not.toHaveBeenCalled();
  });

  it('records the payment through PaymentsService and notifies on success', async () => {
    dialogCloses({});
    const updated = { ...instance, status: 'PAID' as const, amountPaid: 1200 };
    record.mockResolvedValue({ instance: updated, payment });

    const result = await service.recordPayment(instance);

    expect(result).toEqual({ ok: true });
    expect(record).toHaveBeenCalledWith('inst-1', {});
    expect(success).toHaveBeenCalledWith('Rent is paid');
  });

  it('notifies with a partial-payment message when the bill is not yet paid off', async () => {
    dialogCloses({ amount: 500 });
    const updated = { ...instance, status: 'PARTIALLY_PAID' as const, amountPaid: 500 };
    record.mockResolvedValue({ instance: updated, payment });

    await service.recordPayment(instance);

    expect(success).toHaveBeenCalledWith('Recorded a payment for Rent');
  });

  it('reports a failed payment instead of throwing', async () => {
    dialogCloses({});
    record.mockRejectedValue(
      new HttpErrorResponse({ status: 409, error: { message: 'Already paid' } }),
    );

    const result = await service.recordPayment(instance);

    expect(result).toEqual({ ok: false, message: 'Already paid' });
    expect(success).not.toHaveBeenCalled();
  });
});

describe('InstanceActionsService.clearPayments', () => {
  it('sends nothing and reports ok when the dialog is cancelled', async () => {
    dialogCloses(undefined);

    const result = await service.clearPayments(instance);

    expect(result).toEqual({ ok: true });
    expect(unpay).not.toHaveBeenCalled();
  });

  it('clears payments through PaymentsService on confirm', async () => {
    dialogCloses('confirm');
    unpay.mockResolvedValue({ ...instance, status: 'UNPAID', amountPaid: 0 });

    const result = await service.clearPayments(instance);

    expect(result).toEqual({ ok: true });
    expect(unpay).toHaveBeenCalledWith('inst-1');
  });

  it('reports a failed clear instead of throwing', async () => {
    dialogCloses('confirm');
    unpay.mockRejectedValue(
      new HttpErrorResponse({ status: 409, error: { message: 'Nothing to clear' } }),
    );

    const result = await service.clearPayments(instance);

    expect(result).toEqual({ ok: false, message: 'Nothing to clear' });
  });
});
