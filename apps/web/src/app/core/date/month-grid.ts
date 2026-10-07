import { CalendarDate, addDays, dayOfWeek, parts, startOfMonth } from './calendar-date';

/** Six rows of seven. Fixed, so the grid does not change height between months. */
const CELLS = 42;

/**
 * The 42 days a month view shows, starting from the Sunday on or before
 * the first of `anchor`'s month.
 *
 * Sunday because the shipped `CalendarDateAdapter.getFirstDayOfWeek()`
 * returns 0; a month grid that disagreed with the datepicker beside it
 * would be a visible defect.
 *
 * `anchor` is any date within the month to render — its day is ignored.
 * Built entirely from string arithmetic: no `Date` is constructed here.
 */
export function monthGrid(anchor: CalendarDate): CalendarDate[] {
  const first = startOfMonth(anchor);
  const start = addDays(first, -dayOfWeek(first));
  return Array.from({ length: CELLS }, (_, index) => addDays(start, index));
}

/** Whether two calendar days fall in the same month of the same year. */
export function isSameMonth(a: CalendarDate, b: CalendarDate): boolean {
  const left = parts(a);
  const right = parts(b);
  return left.year === right.year && left.month === right.month;
}
