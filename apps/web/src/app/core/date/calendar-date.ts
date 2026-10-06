/**
 * A calendar day as the API sends it: `YYYY-MM-DD`, no time, no zone.
 *
 * Every function here operates on the string directly. **No value from the
 * API is ever passed to `new Date()`** — doing so parses it as UTC midnight
 * and renders it in local time, moving the date backwards for everyone west
 * of Greenwich. That is the off-by-one the API's own date handling exists to
 * avoid, and reintroducing it in the browser would undo that work.
 *
 * The day arithmetic uses Howard Hinnant's civil-calendar algorithms, which
 * convert between a civil date and a day count using integer arithmetic
 * only. They are exact for every proleptic Gregorian date and never touch a
 * time zone.
 */
export type CalendarDate = string;

const PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const MONTH_NAMES_LONG: readonly string[] = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTH_NAMES_SHORT: readonly string[] = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const MONTH_NAMES_NARROW: readonly string[] = [
  'J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D',
];

export const DAY_NAMES_LONG: readonly string[] = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

export const DAY_NAMES_SHORT: readonly string[] = [
  'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
];

export const DAY_NAMES_NARROW: readonly string[] = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function isCalendarDate(value: unknown): value is CalendarDate {
  if (typeof value !== 'string' || !PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

export function parts(date: CalendarDate): { year: number; month: number; day: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

export function fromParts(year: number, month: number, day: number): CalendarDate {
  const clamped = Math.min(day, daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

/** Days since 1970-01-01. Hinnant's `days_from_civil`. */
function toDayNumber(date: CalendarDate): number {
  const { month, day } = parts(date);
  let { year } = parts(date);
  year -= month <= 2 ? 1 : 0;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The inverse. Hinnant's `civil_from_days`. */
function fromDayNumber(dayNumber: number): CalendarDate {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return fromParts(year, month, day);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/**
 * Adds whole months, clamping onto the end of a shorter month.
 *
 * The clamp reads the day from the **anchor**, never from an intermediate
 * result, so `addMonths('2026-01-31', 2)` is `2026-03-31` and not
 * `2026-03-28`. Stepping one month at a time would lose the 31 at February
 * and never recover it — the same drift the API's generator avoids.
 */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const { year, month, day } = parts(date);
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = total - targetYear * 12 + 1;
  return fromParts(targetYear, targetMonth, day);
}

export function addYears(date: CalendarDate, years: number): CalendarDate {
  return addMonths(date, years * 12);
}

export function startOfMonth(date: CalendarDate): CalendarDate {
  const { year, month } = parts(date);
  return fromParts(year, month, 1);
}

export function endOfMonth(date: CalendarDate): CalendarDate {
  const { year, month } = parts(date);
  return fromParts(year, month, daysInMonth(year, month));
}

/** Lexicographic comparison is correct for zero-padded ISO dates. */
export function compare(a: CalendarDate, b: CalendarDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** 0 is Sunday. 1970-01-01 was a Thursday, hence the offset of 4. */
export function dayOfWeek(date: CalendarDate): number {
  return (((toDayNumber(date) + 4) % 7) + 7) % 7;
}

/**
 * The current calendar day in the browser's own time zone.
 *
 * This is the only `Date` in the module, and it **formats** the current
 * instant rather than parsing a stored string. `en-CA` is used because its
 * short date format is `YYYY-MM-DD`.
 *
 * Note what this is not for: deciding whether a bill is overdue. That is
 * derived server-side against `APP_TIMEZONE` and arrives on the instance.
 */
export function today(): CalendarDate {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}
