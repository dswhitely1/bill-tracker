import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addYears,
  compare,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  endOfMonth,
  fromParts,
  isCalendarDate,
  parts,
  startOfMonth,
  today,
} from './calendar-date';

describe('isCalendarDate', () => {
  it.each(['2026-10-06', '2000-02-29', '1999-12-31'])('accepts %s', (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  it.each([
    ['2026-02-31', 'a day that does not exist in that month'],
    ['2026-13-01', 'a month past December'],
    ['2026-00-01', 'a zero month'],
    ['2026-10-00', 'a zero day'],
    ['20261006', 'ISO 8601 basic format, which new Date() cannot parse'],
    ['2026-10-6', 'an unpadded day'],
    ['2026-10-06T00:00:00Z', 'a timestamp'],
    ['', 'the empty string'],
  ])('rejects %s — %s', (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });

  it.each([null, undefined, 20261006, new Date(), {}])('rejects the non-string %s', (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });

  it('accepts 2024-02-29 and rejects 2026-02-29, so leap years are real', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
  });
});

describe('parts and fromParts', () => {
  it('splits a date into one-based month and day', () => {
    expect(parts('2026-10-06')).toEqual({ year: 2026, month: 10, day: 6 });
  });

  it('pads single digits when building', () => {
    expect(fromParts(2026, 1, 6)).toBe('2026-01-06');
  });

  it('clamps a day past the end of its month', () => {
    expect(fromParts(2026, 2, 31)).toBe('2026-02-28');
  });

  it('round-trips every date it produces', () => {
    const date = fromParts(2026, 7, 4);
    expect(fromParts(parts(date).year, parts(date).month, parts(date).day)).toBe(date);
  });
});

describe('daysInMonth', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2024, 2, 29],
    [2000, 2, 29],
    [1900, 2, 28],
    [2026, 4, 30],
    [2026, 12, 31],
  ])('%i-%i has %i days', (year, month, expected) => {
    expect(daysInMonth(year, month)).toBe(expected);
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('crosses a leap day', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
  });

  it('skips the leap day in a common year', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('goes backwards', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('adds a full common year', () => {
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
  });
});

describe('addMonths', () => {
  it('clamps onto a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('clamps from the anchor rather than the previous result, so there is no drift', () => {
    // The whole point. Two single-month steps from January 31 would land
    // on March 28; one two-month step must land on March 31.
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
  });

  it('clamps to 29 in a leap February', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('crosses a year boundary', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('goes backwards across a year boundary', () => {
    expect(addMonths('2026-02-15', -3)).toBe('2025-11-15');
  });

  it('handles twelve months as exactly one year', () => {
    expect(addMonths('2026-06-15', 12)).toBe('2027-06-15');
  });
});

describe('addYears', () => {
  it('clamps February 29 onto a common year', () => {
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
  });

  it('leaves an ordinary date alone', () => {
    expect(addYears('2026-06-15', 2)).toBe('2028-06-15');
  });
});

describe('startOfMonth and endOfMonth', () => {
  it('finds the first of the month', () => {
    expect(startOfMonth('2026-10-06')).toBe('2026-10-01');
  });

  it('finds the last of a 31-day month', () => {
    expect(endOfMonth('2026-10-06')).toBe('2026-10-31');
  });

  it('finds the last of a leap February', () => {
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
  });
});

describe('compare', () => {
  it('orders earlier before later', () => {
    expect(compare('2026-01-01', '2026-01-02')).toBeLessThan(0);
    expect(compare('2026-01-02', '2026-01-01')).toBeGreaterThan(0);
    expect(compare('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('sorts a list correctly, including across years', () => {
    const sorted = ['2027-01-01', '2026-12-31', '2026-02-01'].sort(compare);
    expect(sorted).toEqual(['2026-02-01', '2026-12-31', '2027-01-01']);
  });
});

describe('daysBetween', () => {
  it('counts a single day', () => {
    expect(daysBetween('2026-10-06', '2026-10-07')).toBe(1);
  });

  it('counts zero for the same day', () => {
    expect(daysBetween('2026-10-06', '2026-10-06')).toBe(0);
  });

  it('returns a negative count when the range runs backwards', () => {
    expect(daysBetween('2026-10-07', '2026-10-06')).toBe(-1);
  });

  it('counts a leap year as 366 days', () => {
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
  });
});

describe('dayOfWeek', () => {
  it.each([
    ['2026-10-04', 0, 'Sunday'],
    ['2026-10-05', 1, 'Monday'],
    ['2026-10-10', 6, 'Saturday'],
    ['1970-01-01', 4, 'Thursday — the epoch, which the arithmetic is anchored on'],
  ])('%s is %i (%s)', (date, expected) => {
    expect(dayOfWeek(date)).toBe(expected);
  });
});

describe('today', () => {
  it('returns a value its own validator accepts', () => {
    expect(isCalendarDate(today())).toBe(true);
  });

  it('agrees with Intl for the current instant', () => {
    expect(today()).toBe(new Intl.DateTimeFormat('en-CA').format(new Date()));
  });
});
