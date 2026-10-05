/**
 * Calendar arithmetic on `YYYY-MM-DD` strings. Nothing here constructs a
 * local `Date`, and nothing returns one: a due date is a calendar day, and
 * every conversion to an instant is a chance to shift it by one. The two
 * places a `Date` appears are `Date.UTC` for day arithmetic and
 * `Intl.DateTimeFormat` for reading the wall clock, both timezone-explicit.
 */

export interface DateParts {
  y: number;
  /** 1-12, not the 0-11 a JS Date uses. */
  m: number;
  d: number;
}

const PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function daysInMonth(year: number, month: number): number {
  // Day 0 of month+1 is the last day of month. `month` being 1-based makes
  // this read as the next month's day zero.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function format(p: DateParts): string {
  const y = String(p.y).padStart(4, '0');
  const m = String(p.m).padStart(2, '0');
  const d = String(p.d).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parse(date: string): DateParts {
  const match = typeof date === 'string' ? PATTERN.exec(date) : null;
  if (!match) throw new TypeError(`Not a YYYY-MM-DD date: ${String(date)}`);
  const parts = { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
  if (parts.m < 1 || parts.m > 12) {
    throw new TypeError(`Month out of range in ${date}`);
  }
  if (parts.d < 1 || parts.d > daysInMonth(parts.y, parts.m)) {
    throw new TypeError(`Day out of range for that month in ${date}`);
  }
  return parts;
}

/** Non-throwing form, for validators and query parsing. */
export function isCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    parse(value);
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: string, n: number): string {
  const { y, m, d } = parse(date);
  const shifted = new Date(Date.UTC(y, m - 1, d) + n * 86_400_000);
  return format({
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
  });
}

export function addWeeks(date: string, n: number): string {
  return addDays(date, n * 7);
}

/**
 * Clamped, and deliberately anchored to `date`'s own day — never to a
 * previously computed result. Jan 31 + 1 is Feb 28, and Jan 31 + 2 is
 * Mar 31. Iterating month-by-month instead would strand the bill on the
 * 28th for the rest of its life.
 */
export function addMonths(date: string, n: number): string {
  const { y, m, d } = parse(date);
  const index = y * 12 + (m - 1) + n;
  const ny = Math.floor(index / 12);
  const nm = (((index % 12) + 12) % 12) + 1;
  return format({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) });
}

export function addYears(date: string, n: number): string {
  // Via months so Feb 29 clamps to Feb 28 in common years for free.
  return addMonths(date, n * 12);
}

export function compare(a: string, b: string): -1 | 0 | 1 {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/** The current calendar date in `timeZone`. `en-CA` formats as YYYY-MM-DD. */
export function today(timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
