import type { BillStatus } from '@bill-tracker/shared-types';
import { deriveStatus, round2 } from '../common/money';

export interface PaymentEvent {
  /** Negative on a reversal row. */
  amountPaid: number;
  paidAt: Date;
}

export interface PaymentState {
  amountPaid: number;
  status: BillStatus;
  paidAt: Date | null;
}

/**
 * The instance's cached state, derived from its whole payment log — spec §6.1.
 *
 * Always recomputed from the full log rather than incremented, so a lost
 * update cannot turn into a permanently wrong balance. `paidAt` is the
 * timestamp of the event that brought the running total to full, and is
 * cleared whenever the total falls back below the amount — so a bill paid,
 * reversed, and paid again reports the second crossing, not the first.
 */
export function paymentState(amount: number, events: PaymentEvent[]): PaymentState {
  const ordered = [...events].sort((a, b) => a.paidAt.getTime() - b.paidAt.getTime());

  let running = 0;
  let crossedAt: Date | null = null;
  for (const event of ordered) {
    running = round2(running + event.amountPaid);
    if (running >= amount) {
      crossedAt ??= event.paidAt;
    } else {
      crossedAt = null;
    }
  }

  const status = deriveStatus(amount, running);
  return { amountPaid: running, status, paidAt: status === 'PAID' ? crossedAt : null };
}
