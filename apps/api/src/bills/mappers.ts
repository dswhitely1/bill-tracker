import type {
  BillInstanceResponse, BillResponse, PaymentLogResponse,
} from '@bill-tracker/shared-types';
import { Bill } from './bill.entity';
import { BillInstance } from './bill-instance.entity';
import { PaymentLog } from './payment-log.entity';
import { compare } from './dates';

export const toBillResponse = (bill: Bill): BillResponse => ({
  id: bill.id,
  categoryId: bill.categoryId,
  name: bill.name,
  defaultAmount: bill.defaultAmount,
  frequency: bill.frequency,
  startDate: bill.startDate,
  endDate: bill.endDate,
  isActive: bill.isActive,
});

/**
 * `bill` is a required parameter rather than a read of `instance.bill`,
 * which is optional on the entity: a caller that forgot to load the
 * relation would otherwise ship `billName: undefined` to the client.
 *
 * `isOverdue` is derived here and nowhere else — it is never stored.
 */
export const toInstanceResponse = (
  instance: BillInstance,
  bill: Bill,
  today: string,
): BillInstanceResponse => ({
  id: instance.id,
  billId: instance.billId,
  billName: bill.name,
  categoryId: bill.categoryId,
  dueDate: instance.dueDate,
  amount: instance.amount,
  amountPaid: instance.amountPaid,
  status: instance.status,
  isOverdue: instance.status !== 'PAID' && compare(instance.dueDate, today) < 0,
  isCustomized: instance.isCustomized,
  paidAt: instance.paidAt === null ? null : instance.paidAt.toISOString(),
  note: instance.note,
});

export const toPaymentResponse = (log: PaymentLog): PaymentLogResponse => ({
  id: log.id,
  billInstanceId: log.billInstanceId,
  amountPaid: log.amountPaid,
  paidAt: log.paidAt.toISOString(),
  note: log.note,
  reversesPaymentId: log.reversesPaymentId,
});
