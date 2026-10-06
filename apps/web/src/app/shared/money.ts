import { ValidatorFn, Validators } from '@angular/forms';

/**
 * Multi-currency is not in any sub-project. The constant exists so that
 * when it becomes a real requirement there is one place to change, rather
 * than a `'USD'` at every call site.
 */
export const CURRENCY = 'USD';

/** Money carries two decimal places, so this is the smallest amount above zero. */
export const MIN_AMOUNT = 0.01;

/** The `numeric(12,2)` column's capacity — bills spec §7.1. */
export const MAX_AMOUNT = 9999999999.99;

const FORMATTER = new Intl.NumberFormat('en-US', { style: 'currency', currency: CURRENCY });

export function formatMoney(value: number): string {
  return FORMATTER.format(value);
}

/**
 * Mirrors the API's own bounds so an out-of-range figure produces a
 * message beside the field rather than a 400 from the server.
 */
export const amountValidators: ValidatorFn[] = [
  Validators.required,
  Validators.min(MIN_AMOUNT),
  Validators.max(MAX_AMOUNT),
];
