import { describe, expect, it, vi } from 'vitest';
import { validate } from 'class-validator';
import { IsIsoTimestamp } from './is-iso-timestamp.validator';

class Subject {
  @IsIsoTimestamp()
  when!: unknown;
}

const check = async (value: unknown) => {
  const subject = new Subject();
  subject.when = value;
  return validate(subject);
};

describe('IsIsoTimestamp', () => {
  it('accepts a real, past ISO 8601 timestamp', async () => {
    expect(await check('2026-09-01T12:00:00.000Z')).toHaveLength(0);
  });

  it('rejects basic-format ISO 8601, which @IsISO8601 alone would accept', async () => {
    // The whole reason this validator exists: validator.js's isISO8601
    // accepts basic format in every option mode, but `new Date('20261005')`
    // is Invalid Date, which would reach pg and 500 instead of 400.
    const errors = await check('20261005');
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isIsoTimestamp).toMatch(/ISO 8601/);
  });

  it('rejects a calendar date the strict ISO 8601 check alone would miss', async () => {
    // @IsISO8601({ strict: true }) does reject this on its own too, but it
    // is the companion case to the basic-format gap above, so it is pinned
    // here explicitly.
    expect(await check('2026-02-31')).toHaveLength(1);
  });

  it('rejects prose, empty strings, and non-strings', async () => {
    for (const bad of ['lastweek', '', 42, null, undefined]) {
      const errors = await check(bad);
      expect(errors).toHaveLength(1);
    }
  });

  it('rejects a future timestamp', async () => {
    const future = new Date(Date.now() + 10 * 365 * 86_400_000).toISOString();
    const errors = await check(future);
    expect(errors).toHaveLength(1);
    expect(errors[0].constraints?.isIsoTimestamp).toMatch(/not in the future/);
  });

  it('tolerates a minute of client clock skew', async () => {
    vi.useFakeTimers();
    try {
      const now = new Date('2026-10-05T12:00:00.000Z');
      vi.setSystemTime(now);
      const slightlyAhead = new Date(now.getTime() + 30_000).toISOString();
      expect(await check(slightlyAhead)).toHaveLength(0);

      const tooFarAhead = new Date(now.getTime() + 90_000).toISOString();
      expect(await check(tooFarAhead)).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
