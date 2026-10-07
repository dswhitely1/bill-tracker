import { convertToParamMap } from '@angular/router';
import { describe, expect, it } from 'vitest';
import {
  NO_CATEGORY,
  defaultParams,
  parseUpcomingParams,
  toQueryParams,
} from './upcoming-params';

const NOW = '2026-10-15';
const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

function parse(params: Record<string, string>) {
  return parseUpcomingParams(convertToParamMap(params), NOW);
}

describe('parseUpcomingParams defaults', () => {
  it('defaults to the current calendar month with no filters and due-date ascending', () => {
    expect(parse({})).toEqual({
      from: '2026-10-01',
      to: '2026-10-31',
      status: null,
      overdue: null,
      billId: null,
      categoryId: null,
      q: '',
      sort: 'dueDate',
      dir: 'asc',
    });
  });

  it('matches defaultParams for an empty map', () => {
    expect(parse({})).toEqual(defaultParams(NOW));
  });
});

describe('parseUpcomingParams valid input', () => {
  it('reads a full set of parameters', () => {
    expect(
      parse({
        from: '2026-01-01',
        to: '2026-03-31',
        status: 'PARTIALLY_PAID',
        overdue: 'true',
        billId: UUID_A,
        categoryId: UUID_B,
        q: 'rent',
        sort: 'amount',
        dir: 'desc',
      }),
    ).toEqual({
      from: '2026-01-01',
      to: '2026-03-31',
      status: 'PARTIALLY_PAID',
      overdue: true,
      billId: UUID_A,
      categoryId: UUID_B,
      q: 'rent',
      sort: 'amount',
      dir: 'desc',
    });
  });

  it('reads overdue=false as the negation, not as absent', () => {
    expect(parse({ overdue: 'false' }).overdue).toBe(false);
  });

  it('accepts the no-category sentinel', () => {
    expect(parse({ categoryId: NO_CATEGORY }).categoryId).toBe(NO_CATEGORY);
  });

  it('trims surrounding whitespace from the search term', () => {
    expect(parse({ q: '  rent  ' }).q).toBe('rent');
  });
});

describe('parseUpcomingParams rejects malformed input', () => {
  it('falls back on an unknown status', () => {
    expect(parse({ status: 'BANANA' }).status).toBeNull();
  });

  it('falls back on a non-boolean overdue', () => {
    expect(parse({ overdue: 'maybe' }).overdue).toBeNull();
  });

  it('falls back on a non-UUID bill id', () => {
    expect(parse({ billId: 'not-a-uuid' }).billId).toBeNull();
  });

  it('falls back on a non-UUID category id that is not the sentinel', () => {
    expect(parse({ categoryId: 'nope' }).categoryId).toBeNull();
  });

  it('falls back on an unknown sort key and direction', () => {
    const result = parse({ sort: 'nonsense', dir: 'sideways' });
    expect(result.sort).toBe('dueDate');
    expect(result.dir).toBe('asc');
  });

  it('falls back to the current month on an impossible date', () => {
    const result = parse({ from: '2026-13-45', to: 'garbage' });
    expect(result.from).toBe('2026-10-01');
    expect(result.to).toBe('2026-10-31');
  });

  it('falls back to the current month when the range runs backwards', () => {
    // Sending this to the API earns a 400. The URL is user input; a
    // bookmark from a half-typed address bar must not produce an error page.
    const result = parse({ from: '2026-06-01', to: '2026-05-01' });
    expect(result.from).toBe('2026-10-01');
    expect(result.to).toBe('2026-10-31');
  });

  it('falls back to the current month when the range exceeds the API cap', () => {
    const result = parse({ from: '2024-01-01', to: '2026-10-15' });
    expect(result.from).toBe('2026-10-01');
    expect(result.to).toBe('2026-10-31');
  });

  it('keeps a range of exactly the cap, which the API accepts', () => {
    // MAX_RANGE_DAYS is a difference, not an inclusive count.
    const result = parse({ from: '2025-09-10', to: '2026-10-15' });
    expect(result.from).toBe('2025-09-10');
    expect(result.to).toBe('2026-10-15');
  });

  it('falls back when only one end of the range is given', () => {
    expect(parse({ from: '2026-01-01' }).from).toBe('2026-10-01');
    expect(parse({ to: '2026-12-31' }).to).toBe('2026-10-31');
  });
});

describe('toQueryParams', () => {
  it('emits only the range when everything else is default', () => {
    expect(toQueryParams(defaultParams(NOW))).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });

  it('emits overdue=false, which is a filter rather than an absence', () => {
    expect(toQueryParams({ ...defaultParams(NOW), overdue: false })['overdue']).toBe('false');
  });

  it('omits an empty search term', () => {
    expect(toQueryParams({ ...defaultParams(NOW), q: '' })).not.toHaveProperty('q');
  });

  it('round-trips every parameter it emits', () => {
    const original = {
      from: '2026-01-01',
      to: '2026-03-31',
      status: 'PAID' as const,
      overdue: false,
      billId: UUID_A,
      categoryId: NO_CATEGORY,
      q: 'electric',
      sort: 'name' as const,
      dir: 'desc' as const,
    };
    expect(parseUpcomingParams(convertToParamMap(toQueryParams(original)), NOW)).toEqual(original);
  });
});
