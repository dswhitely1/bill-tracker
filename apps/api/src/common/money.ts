import type { BillStatus } from '@bill-tracker/shared-types';

/**
 * Snap to cents. Summing `numeric(12,2)` values as JS numbers accumulates
 * binary dust (0.1 + 0.2 === 0.30000000000000004), which would make a fully
 * paid bill read as a cent short of its amount and sit at PARTIALLY_PAID
 * forever.
 */
export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Spec §2.1. Payment progress only — overdue is a separate, derived axis. */
export function deriveStatus(amount: number, amountPaid: number): BillStatus {
  if (amountPaid >= amount) return 'PAID';
  if (amountPaid > 0) return 'PARTIALLY_PAID';
  return 'UNPAID';
}
