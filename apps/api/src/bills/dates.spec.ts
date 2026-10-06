import { describe, expect, it, vi } from 'vitest';
import {
  addDays, addMonths, addWeeks, addYears, compare, daysInMonth, isCalendarDate, parse,
  today,
} from './dates';

describe('parse', () => {
  it('reads a well-formed date', () => {
    expect(parse('2026-10-05')).toEqual({ y: 2026, m: 10, d: 5 });
  });

  it('rejects anything that is not YYYY-MM-DD', () => {
    for (const bad of ['', 'lastweek', '2026-10', '26-10-05', '2026/10/05', '2026-10-05T00:00']) {
      expect(() => parse(bad)).toThrow(TypeError);
    }
  });

  it('rejects a date that does not exist on the calendar', () => {
    expect(() => parse('2026-02-31')).toThrow(TypeError);
    expect(() => parse('2026-13-01')).toThrow(TypeError);
    expect(() => parse('2026-00-10')).toThrow(TypeError);
    expect(() => parse('2026-02-29')).toThrow(TypeError); // 2026 is not a leap year
  });
});

describe('daysInMonth', () => {
  it('knows month lengths', () => {
    expect(daysInMonth(2026, 1)).toBe(31);
    expect(daysInMonth(2026, 4)).toBe(30);
  });

  it('knows leap years', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28); // divisible by 100, not 400
  });
});

describe('addMonths', () => {
  it('moves whole months', () => {
    expect(addMonths('2026-10-05', 1)).toBe('2026-11-05');
    expect(addMonths('2026-10-05', 3)).toBe('2027-01-05');
    expect(addMonths('2026-10-05', 0)).toBe('2026-10-05');
  });

  it('clamps to the end of a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('does NOT drift — the anchor day returns when the month is long enough', () => {
    // The whole point. Computing each occurrence from the anchor rather than
    // from the previous result is what keeps a 31st bill on the 31st.
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonths('2026-01-31', 3)).toBe('2026-04-30');
    expect(addMonths('2026-01-31', 4)).toBe('2026-05-31');
  });

  it('clamps into February correctly in a leap year', () => {
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
  });
});

describe('addYears', () => {
  it('moves whole years', () => {
    expect(addYears('2026-10-05', 1)).toBe('2027-10-05');
  });

  it('clamps a Feb 29 anchor into a common year', () => {
    expect(addYears('2028-02-29', 1)).toBe('2029-02-28');
    expect(addYears('2028-02-29', 4)).toBe('2032-02-29');
  });
});

describe('addDays and addWeeks', () => {
  it('crosses month and year boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addWeeks('2026-10-05', 1)).toBe('2026-10-12');
    expect(addWeeks('2026-10-05', 8)).toBe('2026-11-30');
  });

  it('is immune to daylight saving, because it never builds a local Date', () => {
    // US DST ends 2026-11-01. A local-midnight Date would land on the 31st
    // or skip a day here depending on the host zone.
    expect(addDays('2026-10-31', 2)).toBe('2026-11-02');
    expect(addDays('2026-03-07', 2)).toBe('2026-03-09'); // DST begins 2026-03-08
  });
});

describe('compare', () => {
  it('orders lexicographically, which for this format is chronologically', () => {
    expect(compare('2026-01-01', '2026-02-01')).toBe(-1);
    expect(compare('2026-02-01', '2026-01-01')).toBe(1);
    expect(compare('2026-01-01', '2026-01-01')).toBe(0);
  });
});

describe('today', () => {
  it('returns the calendar date in the given zone', () => {
    // 2026-10-06T02:30:00Z is still 2026-10-05 in New York.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-06T02:30:00.000Z'));
    try {
      expect(today('UTC')).toBe('2026-10-06');
      expect(today('America/New_York')).toBe('2026-10-05');
      expect(today('Asia/Tokyo')).toBe('2026-10-06');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isCalendarDate', () => {
  it('accepts only real YYYY-MM-DD strings', () => {
    expect(isCalendarDate('2026-10-05')).toBe(true);
    expect(isCalendarDate('2026-02-31')).toBe(false);
    expect(isCalendarDate('lastweek')).toBe(false);
    expect(isCalendarDate(20261005)).toBe(false);
    expect(isCalendarDate(null)).toBe(false);
  });
});
