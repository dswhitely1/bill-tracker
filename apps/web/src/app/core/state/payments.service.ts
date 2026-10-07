import { Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  BillInstanceResponse,
  PaymentLogResponse,
  PaymentResultResponse,
  RecordPaymentRequest,
} from '@bill-tracker/shared-types';
import { BillInstancesApi } from '../api/bill-instances.api';
import { InstancesStore } from './instances.store';

/**
 * Payment mutations patch a single row rather than refetching a range,
 * because every one of these endpoints returns the updated instance
 * (bills spec §7.3). Refetching would throw away the rest of the range to
 * learn one row.
 *
 * Nothing here is swallowed. A 409 from a double reversal and a 400 from
 * an over-payment both reach the caller, which is what lets the screen
 * show the server's own message instead of a shrug.
 */
@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private readonly api = inject(BillInstancesApi);
  private readonly instances = inject(InstancesStore);

  private readonly changeCount = signal(0);

  /**
   * Increments after every successful payment mutation. An open payment
   * history watches this: recording, reversing or clearing a payment
   * changes the log it is displaying, and nothing else would tell it.
   */
  readonly mutations = this.changeCount.asReadonly();

  /**
   * Bumps the counter without a mutation behind it. The stores that watch
   * this counter are the unit under test in their own specs; staging a
   * real payment there would test this service instead of them.
   */
  announceMutation(): void {
    this.changeCount.update((n) => n + 1);
  }

  /** An omitted `amount` means the remaining balance, computed server-side under a row lock. */
  async record(id: string, body: RecordPaymentRequest = {}): Promise<PaymentResultResponse> {
    const result = await firstValueFrom(this.api.recordPayment(id, body));
    this.instances.patch(result.instance);
    this.changeCount.update((count) => count + 1);
    return result;
  }

  async reverse(id: string, paymentId: string): Promise<PaymentResultResponse> {
    const result = await firstValueFrom(this.api.reversePayment(id, paymentId));
    this.instances.patch(result.instance);
    this.changeCount.update((count) => count + 1);
    return result;
  }

  /** Returns the instance alone — `unpay` has no payment row to hand back. */
  async unpay(id: string): Promise<BillInstanceResponse> {
    const instance = await firstValueFrom(this.api.unpay(id));
    this.instances.patch(instance);
    this.changeCount.update((count) => count + 1);
    return instance;
  }

  history(id: string): Promise<PaymentLogResponse[]> {
    return firstValueFrom(this.api.payments(id));
  }

  /**
   * Re-reads one instance. Used after a conflict, where the local row is
   * known to disagree with the server and showing the stale version
   * alongside the error would be worse than either alone.
   */
  async reload(id: string): Promise<BillInstanceResponse> {
    const instance = await firstValueFrom(this.api.get(id));
    this.instances.patch(instance);
    return instance;
  }
}
