import { Pipe, PipeTransform } from '@angular/core';
import {
  CalendarDate,
  DAY_NAMES_LONG,
  MONTH_NAMES_LONG,
  MONTH_NAMES_SHORT,
  dayOfWeek,
  isCalendarDate,
  parts,
} from './calendar-date';

export type CalendarDateFormat = 'short' | 'medium' | 'long';

/**
 * Renders a `CalendarDate` by reading its digits, never by parsing it.
 *
 * Angular's own `DatePipe` would be the obvious choice and is the wrong
 * one: it accepts a `YYYY-MM-DD` string by handing it to the `Date`
 * constructor, which treats it as UTC midnight and then formats it in the
 * host zone — so a due date of the 1st renders as the previous month's
 * last day for anyone behind UTC.
 *
 * A value that is not a calendar date is returned unchanged rather than
 * coerced, so a malformed date is visible instead of silently becoming a
 * different day.
 */
@Pipe({ name: 'calendarDate' })
export class CalendarDatePipe implements PipeTransform {
  transform(value: CalendarDate | null | undefined, format: CalendarDateFormat = 'medium'): string {
    if (value === null || value === undefined) return '';
    if (!isCalendarDate(value)) return String(value);

    const { year, month, day } = parts(value);

    if (format === 'short') return `${MONTH_NAMES_SHORT[month - 1]} ${day}`;
    if (format === 'long') {
      return `${DAY_NAMES_LONG[dayOfWeek(value)]}, ${MONTH_NAMES_LONG[month - 1]} ${day}, ${year}`;
    }
    return `${MONTH_NAMES_SHORT[month - 1]} ${day}, ${year}`;
  }
}
