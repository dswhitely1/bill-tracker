import { describe, expect, it } from 'vitest';
import { dayOfWeek } from './calendar-date';
import { isSameMonth, monthGrid } from './month-grid';

describe('monthGrid', () => {
  it('always returns exactly 42 cells', () => {
    for (const anchor of ['2026-01-15', '2026-02-15', '2026-05-15', '2026-11-15']) {
      expect(monthGrid(anchor)).toHaveLength(42);
    }
  });

  it('starts on a Sunday, matching the shipped DateAdapter’s first day of week', () => {
    for (const anchor of ['2026-01-15', '2026-02-15', '2026-08-15', '2027-03-15']) {
      expect(dayOfWeek(monthGrid(anchor)[0])).toBe(0);
    }
  });

  it('ignores the anchor’s day: any date in a month yields the same grid', () => {
    expect(monthGrid('2026-10-01')).toEqual(monthGrid('2026-10-31'));
  });

  it('contains every day of the anchor’s month', () => {
    const grid = monthGrid('2026-10-09');
    for (let day = 1; day <= 31; day += 1) {
      expect(grid).toContain(`2026-10-${String(day).padStart(2, '0')}`);
    }
  });

  it('is contiguous — each cell is the day after the one before it', () => {
    const grid = monthGrid('2026-10-09');
    const asNumbers = grid.map((cell) => {
      const [y, m, d] = cell.split('-').map(Number);
      // Date.UTC's month parameter is 0-based; the string's is 1-based.
      return Date.UTC(y, m - 1, d);
    });
    // The anchor arithmetic is string-based; this reference check is the
    // only place a Date appears, and it is UTC-explicit.
    for (let i = 1; i < grid.length; i += 1) {
      expect(asNumbers[i] - asNumbers[i - 1]).toBe(86_400_000);
    }
  });

  it('handles a month that begins on a Sunday without a blank leading week', () => {
    // 2026-11-01 is a Sunday.
    expect(dayOfWeek('2026-11-01')).toBe(0);
    expect(monthGrid('2026-11-10')[0]).toBe('2026-11-01');
  });

  it('handles a month that begins on a Saturday', () => {
    // 2026-08-01 is a Saturday, so the grid opens six days earlier.
    expect(dayOfWeek('2026-08-01')).toBe(6);
    expect(monthGrid('2026-08-10')[0]).toBe('2026-07-26');
  });

  it('crosses a year boundary in both directions', () => {
    expect(monthGrid('2026-01-10')).toContain('2025-12-28');
    expect(monthGrid('2026-12-10')).toContain('2027-01-02');
  });

  it('spans a leap February', () => {
    const grid = monthGrid('2028-02-10');
    expect(grid).toContain('2028-02-29');
    expect(grid).toContain('2028-03-01');
  });

  it('spans a non-leap February without inventing a 29th', () => {
    const grid = monthGrid('2026-02-10');
    expect(grid).not.toContain('2026-02-29');
    expect(grid).toContain('2026-02-28');
  });

  it('covers every weekday a month can start on', () => {
    // One month per starting weekday, verified by construction.
    const anchors = [
      '2026-11-10', '2026-06-10', '2026-09-10', '2026-07-10',
      '2026-10-10', '2026-05-10', '2026-08-10',
    ];
    const starts = new Set(anchors.map((a) => dayOfWeek(`${a.slice(0, 8)}01`)));
    expect(starts.size).toBe(7);
    for (const anchor of anchors) {
      const grid = monthGrid(anchor);
      expect(grid).toHaveLength(42);
      expect(dayOfWeek(grid[0])).toBe(0);
      expect(grid).toContain(`${anchor.slice(0, 8)}01`);
    }
  });
});

describe('isSameMonth', () => {
  it('is true for two days in the same month of the same year', () => {
    expect(isSameMonth('2026-10-01', '2026-10-31')).toBe(true);
  });

  it('is false across a month boundary', () => {
    expect(isSameMonth('2026-10-31', '2026-11-01')).toBe(false);
  });

  it('is false for the same month in a different year', () => {
    expect(isSameMonth('2026-10-15', '2027-10-15')).toBe(false);
  });
});
