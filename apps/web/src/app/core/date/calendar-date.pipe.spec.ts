import { describe, expect, it } from 'vitest';
import { CalendarDatePipe } from './calendar-date.pipe';

const pipe = new CalendarDatePipe();

describe('CalendarDatePipe', () => {
  it('formats medium by default', () => {
    expect(pipe.transform('2026-10-06')).toBe('Oct 6, 2026');
  });

  it('formats long with the weekday', () => {
    expect(pipe.transform('2026-10-06', 'long')).toBe('Tuesday, October 6, 2026');
  });

  it('formats short without the year', () => {
    expect(pipe.transform('2026-10-06', 'short')).toBe('Oct 6');
  });

  it('does not pad the day, so it reads like prose', () => {
    expect(pipe.transform('2026-10-06')).not.toContain('06,');
  });

  it('returns an empty string for null', () => {
    expect(pipe.transform(null)).toBe('');
  });

  it('returns the input unchanged when it is not a calendar date', () => {
    // A malformed value should be visible, not silently rendered as some
    // other day.
    expect(pipe.transform('20261006')).toBe('20261006');
  });

  it('renders the same string regardless of the host time zone', () => {
    // The real regression guard: a Date-based implementation would move
    // this date by a day in a negative-offset zone.
    expect(pipe.transform('2026-01-01')).toBe('Jan 1, 2026');
    expect(pipe.transform('2026-12-31')).toBe('Dec 31, 2026');
  });
});
