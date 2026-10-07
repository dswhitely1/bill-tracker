import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import type { BillInstanceResponse } from '@bill-tracker/shared-types';
import { errorMessage } from '../core/api/api-error';
import { PaymentsService } from '../core/state/payments.service';
import { ConfirmDialogComponent, ConfirmDialogResult } from '../shared/confirm-dialog.component';
import { NotificationService } from '../shared/notification.service';
import { PaymentDialogComponent, PaymentDialogResult } from './payment-dialog.component';

export type ActionResult = { ok: true } | { ok: false; message: string };

/**
 * Owns both payment mutations the bill list and the calendar drill-down
 * offer, so a rule enforced on one screen cannot quietly go missing on the
 * other. Every mutation goes through the shipped dialogs and
 * `PaymentsService` — there is deliberately only one implementation of
 * each flow, here, rather than one per caller.
 *
 * A cancelled dialog resolves to `{ ok: true }`, the same shape a
 * completed mutation reports. Two states were chosen over three because no
 * caller cares to distinguish "the user cancelled" from "the mutation
 * succeeded" — either way a caller's response is the same: clear whatever
 * error it was showing and do nothing else.
 */
@Injectable({ providedIn: 'root' })
export class InstanceActionsService {
  private readonly dialog = inject(MatDialog);
  private readonly payments = inject(PaymentsService);
  private readonly notifications = inject(NotificationService);

  async recordPayment(instance: BillInstanceResponse): Promise<ActionResult> {
    const result = await firstValueFrom(
      this.dialog
        .open<PaymentDialogComponent, unknown, PaymentDialogResult | undefined>(
          PaymentDialogComponent,
          { data: { instance } },
        )
        .afterClosed(),
    );
    if (!result) return { ok: true };

    try {
      const { instance: updated } = await this.payments.record(instance.id, result);
      this.notifications.success(
        updated.status === 'PAID'
          ? `${updated.billName} is paid`
          : `Recorded a payment for ${updated.billName}`,
      );
      return { ok: true };
    } catch (error: unknown) {
      return { ok: false, message: errorMessage(error) };
    }
  }

  /**
   * `unpay` writes reversals for every live payment rather than deleting
   * rows, so the history survives. The dialog says so, because "clear"
   * otherwise sounds like it erases the record.
   */
  async clearPayments(instance: BillInstanceResponse): Promise<ActionResult> {
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
    if (choice !== 'confirm') return { ok: true };

    try {
      await this.payments.unpay(instance.id);
      return { ok: true };
    } catch (error: unknown) {
      return { ok: false, message: errorMessage(error) };
    }
  }
}
