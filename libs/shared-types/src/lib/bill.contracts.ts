import type { BillFrequency, BillStatus } from './enums.js';

/** Dates are `YYYY-MM-DD`. Timestamps are ISO 8601. Money is a `number`. */
export interface BillResponse {
  id: string;
  categoryId: string | null;
  name: string;
  defaultAmount: number;
  frequency: BillFrequency;
  startDate: string;
  endDate: string | null;
  isActive: boolean;
}

export interface CreateBillRequest {
  name: string;
  defaultAmount: number;
  frequency: BillFrequency;
  startDate: string;
  endDate?: string | null;
  categoryId?: string | null;
}

export interface UpdateBillRequest {
  name?: string;
  defaultAmount?: number;
  frequency?: BillFrequency;
  startDate?: string;
  endDate?: string | null;
  categoryId?: string | null;
  isActive?: boolean;
}

export interface BillInstanceResponse {
  id: string;
  billId: string;
  billName: string;
  categoryId: string | null;
  dueDate: string;
  amount: number;
  amountPaid: number;
  status: BillStatus;
  /** Derived, never stored: `status !== 'PAID' && dueDate < today`. */
  isOverdue: boolean;
  isCustomized: boolean;
  paidAt: string | null;
  note: string | null;
}

export interface UpdateBillInstanceRequest {
  amount?: number;
  note?: string | null;
}

export interface PaymentLogResponse {
  id: string;
  billInstanceId: string;
  amountPaid: number;
  paidAt: string;
  note: string | null;
  reversesPaymentId: string | null;
}

export interface RecordPaymentRequest {
  /** Omitted means the full remaining balance — spec §6.2. */
  amount?: number;
  paidAt?: string;
  note?: string | null;
}

export interface PaymentResultResponse {
  instance: BillInstanceResponse;
  payment: PaymentLogResponse;
}
