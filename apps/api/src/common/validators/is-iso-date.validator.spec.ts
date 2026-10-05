import { describe, expect, it } from 'vitest';
import { validate } from 'class-validator';
import { IsIsoDate } from './is-iso-date.validator';

class Subject {
  @IsIsoDate()
  when!: unknown;
}

const check = async (value: unknown) => {
  const subject = new Subject();
  subject.when = value;
  return validate(subject);
};

describe('IsIsoDate', () => {
  it('accepts a real calendar date', async () => {
    expect(await check('2026-10-05')).toHaveLength(0);
    expect(await check('2028-02-29')).toHaveLength(0);
  });

  it('rejects prose, partial dates, and timestamps', async () => {
    for (const bad of ['lastweek', '2026-10', '2026-10-05T00:00:00Z', '', 42, null]) {
      const errors = await check(bad);
      expect(errors).toHaveLength(1);
      expect(errors[0].constraints?.isIsoDate).toMatch(/YYYY-MM-DD/);
    }
  });

  it('rejects a date the calendar does not have', async () => {
    // The whole reason a bare @Matches regex is not enough: this would reach
    // PostgreSQL and come back a 500.
    expect(await check('2026-02-31')).toHaveLength(1);
    expect(await check('2026-02-29')).toHaveLength(1);
  });
});
