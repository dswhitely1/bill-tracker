import { FormBuilder } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { endDateAfterStart } from './date-range.validator';

const fb = new FormBuilder();

function group(startDate: string | null, endDate: string | null) {
  return fb.group({ startDate: [startDate], endDate: [endDate] }, { validators: [endDateAfterStart] });
}

describe('endDateAfterStart', () => {
  it('accepts an end date after the start', () => {
    expect(group('2026-01-01', '2026-12-31').errors).toBeNull();
  });

  it('accepts an end date equal to the start, since a one-day window is legal', () => {
    expect(group('2026-01-01', '2026-01-01').errors).toBeNull();
  });

  it('rejects an end date before the start', () => {
    expect(group('2026-12-31', '2026-01-01').errors).toEqual({ endBeforeStart: true });
  });

  it('accepts a missing end date, which means the bill never ends', () => {
    expect(group('2026-01-01', null).errors).toBeNull();
    expect(group('2026-01-01', '').errors).toBeNull();
  });

  it('says nothing when the start date is missing, leaving that to required', () => {
    expect(group(null, '2026-01-01').errors).toBeNull();
  });

  it('compares across a year boundary rather than by day of month', () => {
    // A naive comparison on the day number alone calls this valid.
    expect(group('2026-12-01', '2025-12-31').errors).toEqual({ endBeforeStart: true });
  });
});
