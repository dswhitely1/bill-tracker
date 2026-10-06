import type { BillFrequency } from '@bill-tracker/shared-types';
import { addMonths, addWeeks, addYears, compare, parse } from './dates';

export interface OccurrenceSpec {
  frequency: BillFrequency;
  startDate: string;
  endDate: string | null;
}

/**
 * Unreachable in practice — the horizon is twelve months, so the densest
 * frequency (weekly) yields about 54 dates. A throw here means the floor
 * calculation is wrong, and failing loudly beats silently truncating a
 * user's calendar.
 */
const SANITY_LIMIT = 600;

const occurrenceAt = (spec: OccurrenceSpec, n: number): string => {
  switch (spec.frequency) {
    case 'ONE_TIME':
      return spec.startDate;
    case 'WEEKLY':
      return addWeeks(spec.startDate, n);
    case 'MONTHLY':
      return addMonths(spec.startDate, n);
    case 'ANNUALLY':
      return addYears(spec.startDate, n);
  }
};

const daysBetween = (from: string, to: string): number => {
  const a = parse(from);
  const b = parse(to);
  return (Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000;
};

/**
 * The index of the latest occurrence on or before `reference`, or 0 when
 * every occurrence is later. Computed arithmetically rather than by walking
 * the sequence: a bill that started decades ago would otherwise cost
 * thousands of iterations, or hit a loop bound and silently return the
 * wrong window.
 */
const floorIndex = (spec: OccurrenceSpec, reference: string): number => {
  if (compare(reference, spec.startDate) <= 0) return 0;
  switch (spec.frequency) {
    case 'ONE_TIME':
      return 0;
    case 'WEEKLY':
      return Math.floor(daysBetween(spec.startDate, reference) / 7);
    case 'MONTHLY':
    case 'ANNUALLY': {
      const start = parse(spec.startDate);
      const ref = parse(reference);
      const months = (ref.y * 12 + ref.m) - (start.y * 12 + start.m);
      const step = spec.frequency === 'MONTHLY' ? 1 : 12;
      const n = Math.floor(months / step);
      // `n` can overshoot by one when the reference day-of-month falls
      // before the anchor day — e.g. anchor the 15th, reference the 5th.
      return compare(occurrenceAt(spec, n), reference) <= 0 ? n : Math.max(0, n - 1);
    }
  }
};

/**
 * Every occurrence to materialize, ascending — spec §5.2.
 *
 * Starts at the latest occurrence on or before today (so entering a monthly
 * bill on the 20th still produces this month's occurrence on the 15th,
 * overdue, which is true) and never earlier, so entering one old bill does
 * not manufacture months of fictional backlog.
 */
export function occurrenceDates(spec: OccurrenceSpec, today: string): string[] {
  const horizon = addMonths(today, 12);
  const last =
    spec.endDate !== null && compare(spec.endDate, horizon) < 0 ? spec.endDate : horizon;

  // When the bill has already ended, the floor is measured from its end
  // rather than from today — otherwise the window would start past the
  // final occurrence and return nothing at all.
  const reference = compare(last, today) < 0 ? last : today;

  const dates: string[] = [];
  for (let n = floorIndex(spec, reference); ; n += 1) {
    const date = occurrenceAt(spec, n);
    if (compare(date, last) > 0) break;
    dates.push(date);
    if (spec.frequency === 'ONE_TIME') break;
    if (dates.length > SANITY_LIMIT) {
      throw new Error(
        `occurrenceDates produced more than ${SANITY_LIMIT} dates for a 12-month ` +
          'horizon, which means the floor calculation is wrong',
      );
    }
  }
  return dates;
}
