import { describe, expect, it } from 'vitest';
import { occurrenceDates } from './occurrences';

const TODAY = '2026-10-05';

const monthly = (startDate: string, endDate: string | null = null) =>
  occurrenceDates({ frequency: 'MONTHLY', startDate, endDate }, TODAY);

describe('occurrenceDates — horizon', () => {
  it('runs twelve months forward and no further', () => {
    const dates = monthly('2026-10-01');
    expect(dates[0]).toBe('2026-10-01');
    expect(dates.at(-1)).toBe('2027-10-01');
    expect(dates).toHaveLength(13);
  });

  it('stops at end_date when that comes first', () => {
    expect(monthly('2026-10-01', '2026-12-31')).toEqual([
      '2026-10-01', '2026-11-01', '2026-12-01',
    ]);
  });
});

describe('occurrenceDates — the floor rule', () => {
  it('starts at the current period, not at start_date, for a long-running bill', () => {
    // Started in 2024. We want this month's occurrence and no backlog.
    const dates = monthly('2024-01-15');
    expect(dates[0]).toBe('2026-09-15');
    expect(dates).not.toContain('2024-01-15');
    expect(dates.filter((d) => d < TODAY)).toEqual(['2026-09-15']);
  });

  it('includes an occurrence already due this period, which reads as overdue', () => {
    // Due on the 1st; today is the 5th. The 1st is still generated.
    const dates = monthly('2024-01-01');
    expect(dates[0]).toBe('2026-10-01');
  });

  it('starts at the first occurrence for a future-dated bill', () => {
    expect(monthly('2026-12-20')[0]).toBe('2026-12-20');
  });

  it('generates nothing when the bill starts beyond the horizon', () => {
    expect(monthly('2030-01-01')).toEqual([]);
  });

  it('generates only the final occurrence when the bill has already ended', () => {
    expect(monthly('2024-01-10', '2024-06-10')).toEqual(['2024-06-10']);
  });
});

describe('occurrenceDates — frequencies', () => {
  it('ONE_TIME yields exactly its start date, even in the past', () => {
    expect(occurrenceDates(
      { frequency: 'ONE_TIME', startDate: '2024-03-09', endDate: null }, TODAY,
    )).toEqual(['2024-03-09']);
  });

  it('ONE_TIME yields nothing beyond the horizon', () => {
    expect(occurrenceDates(
      { frequency: 'ONE_TIME', startDate: '2030-03-09', endDate: null }, TODAY,
    )).toEqual([]);
  });

  it('WEEKLY steps by seven days from the current period', () => {
    // 2024-01-01 and 2026-10-05 are both Mondays, so the floor occurrence
    // falls exactly on TODAY. Verified against the calendar, not inferred.
    const dates = occurrenceDates(
      { frequency: 'WEEKLY', startDate: '2024-01-01', endDate: null }, TODAY,
    );
    expect(dates[0]).toBe('2026-10-05');
    expect(dates[1]).toBe('2026-10-12');
    expect(dates.at(-1)).toBe('2027-10-04'); // the last Monday inside the horizon
    expect(dates).toHaveLength(53);
    expect(dates.every((d, i) => i === 0 || d > dates[i - 1])).toBe(true);
  });

  it('WEEKLY includes an occurrence earlier in the current week', () => {
    // Anchored on Thursday; today is Monday. The floor is the previous
    // Thursday, three days behind — generated, and overdue if unpaid.
    const dates = occurrenceDates(
      { frequency: 'WEEKLY', startDate: '2024-01-04', endDate: null }, TODAY,
    );
    expect(dates[0]).toBe('2026-10-01');
    expect(dates[1]).toBe('2026-10-08');
  });

  it('ANNUALLY steps by one year', () => {
    expect(occurrenceDates(
      { frequency: 'ANNUALLY', startDate: '2020-04-15', endDate: null }, TODAY,
    )).toEqual(['2026-04-15', '2027-04-15']);
  });

  it('MONTHLY keeps a 31st anchor on the 31st rather than drifting', () => {
    const dates = occurrenceDates(
      { frequency: 'MONTHLY', startDate: '2026-12-31', endDate: null }, TODAY,
    );
    expect(dates.slice(0, 4)).toEqual([
      '2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31',
    ]);
  });
});

describe('occurrenceDates — output shape', () => {
  it('is ascending with no duplicates', () => {
    const dates = monthly('2024-01-15');
    expect([...dates].sort()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
  });
});
