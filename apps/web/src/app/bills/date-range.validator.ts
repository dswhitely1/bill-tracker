import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { compare, isCalendarDate } from '../core/date/calendar-date';

/**
 * A group-level validator, because the rule is about the pair rather than
 * either control: the API requires `endDate` to be null or `>= startDate`.
 *
 * Comparison goes through `compare`, which is lexicographic over
 * zero-padded ISO dates — correct across month and year boundaries, which
 * a day-of-month comparison is not.
 */
export const endDateAfterStart: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const startDate = control.get('startDate')?.value;
  const endDate = control.get('endDate')?.value;

  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) return null;
  return compare(endDate, startDate) < 0 ? { endBeforeStart: true } : null;
};
