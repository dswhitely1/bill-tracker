import { describe, expect, it } from 'vitest';
import type { BillInstanceResponse } from '@bill-tracker/shared-types';
import { NO_CATEGORY } from './upcoming-params';
import { SORT_LABELS, filterInstances, sortInstances } from './instance-filters';

function instance(overrides: Partial<BillInstanceResponse>): BillInstanceResponse {
  return {
    id: 'inst-1',
    billId: 'bill-1',
    billName: 'Rent',
    categoryId: 'cat-1',
    dueDate: '2026-10-01',
    amount: 100,
    amountPaid: 0,
    status: 'UNPAID',
    isOverdue: false,
    isCustomized: false,
    paidAt: null,
    note: null,
    ...overrides,
  };
}

describe('filterInstances by search term', () => {
  const rows = [
    instance({ id: 'a', billName: 'Electric Bill' }),
    instance({ id: 'b', billName: 'Rent' }),
    instance({ id: 'c', billName: 'Water' }),
  ];

  it('returns everything for an empty term', () => {
    expect(filterInstances(rows, { q: '', categoryId: null })).toHaveLength(3);
  });

  it('matches a substring of the bill name', () => {
    const result = filterInstances(rows, { q: 'ectr', categoryId: null });
    expect(result.map((r) => r.id)).toEqual(['a']);
  });

  it('matches case-insensitively', () => {
    const result = filterInstances(rows, { q: 'RENT', categoryId: null });
    expect(result.map((r) => r.id)).toEqual(['b']);
  });

  it('returns nothing when the term matches no bill', () => {
    expect(filterInstances(rows, { q: 'mortgage', categoryId: null })).toEqual([]);
  });
});

describe('filterInstances by category', () => {
  const rows = [
    instance({ id: 'a', categoryId: 'cat-1' }),
    instance({ id: 'b', categoryId: 'cat-2' }),
    instance({ id: 'c', categoryId: null }),
  ];

  it('returns everything when no category is selected', () => {
    expect(filterInstances(rows, { q: '', categoryId: null })).toHaveLength(3);
  });

  it('keeps only the rows in the chosen category', () => {
    const result = filterInstances(rows, { q: '', categoryId: 'cat-2' });
    expect(result.map((r) => r.id)).toEqual(['b']);
  });

  it('keeps only uncategorized rows for the sentinel', () => {
    const result = filterInstances(rows, { q: '', categoryId: NO_CATEGORY });
    expect(result.map((r) => r.id)).toEqual(['c']);
  });
});

describe('filterInstances combines both filters', () => {
  it('requires a row to satisfy the term and the category together', () => {
    const rows = [
      instance({ id: 'a', billName: 'Rent', categoryId: 'cat-1' }),
      instance({ id: 'b', billName: 'Rent', categoryId: 'cat-2' }),
    ];
    const result = filterInstances(rows, { q: 'rent', categoryId: 'cat-2' });
    expect(result.map((r) => r.id)).toEqual(['b']);
  });
});

describe('sortInstances', () => {
  const rows = [
    instance({ id: 'b', billName: 'Beta', dueDate: '2026-10-02', amount: 50, status: 'PAID' }),
    instance({ id: 'a', billName: 'Alpha', dueDate: '2026-10-03', amount: 300, status: 'UNPAID' }),
    instance({
      id: 'c', billName: 'Gamma', dueDate: '2026-10-01', amount: 200,
      status: 'PARTIALLY_PAID',
    }),
  ];

  it('sorts by due date ascending by default', () => {
    expect(sortInstances(rows, 'dueDate', 'asc').map((r) => r.id)).toEqual(['c', 'b', 'a']);
  });

  it('sorts by due date descending', () => {
    expect(sortInstances(rows, 'dueDate', 'desc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by amount', () => {
    expect(sortInstances(rows, 'amount', 'asc').map((r) => r.id)).toEqual(['b', 'c', 'a']);
    expect(sortInstances(rows, 'amount', 'desc').map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('sorts by name', () => {
    expect(sortInstances(rows, 'name', 'asc').map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('sorts by status in the enum’s own order, not alphabetically', () => {
    // Alphabetical would put PAID first; the useful order is what is owed first.
    expect(sortInstances(rows, 'status', 'asc').map((r) => r.id)).toEqual(['a', 'c', 'b']);
  });

  it('does not mutate the array it is given', () => {
    const original = [...rows];
    sortInstances(rows, 'amount', 'desc');
    expect(rows).toEqual(original);
  });

  it('breaks ties stably by due date then id', () => {
    // 'm' is deliberately placed before 'a' in the input. Array.sort's own
    // stability would already produce ['m', 'a', 'z'] if the tiebreak's id
    // comparison were removed — putting 'a' first here, out of input order,
    // means the expected ['a', 'm', 'z'] is reachable only via that id
    // comparison. Do not "tidy" this back into input order.
    const tied = [
      instance({ id: 'z', billName: 'Same', dueDate: '2026-10-02', amount: 10 }),
      instance({ id: 'm', billName: 'Same', dueDate: '2026-10-01', amount: 10 }),
      instance({ id: 'a', billName: 'Same', dueDate: '2026-10-01', amount: 10 }),
    ];
    expect(sortInstances(tied, 'name', 'asc').map((r) => r.id)).toEqual(['a', 'm', 'z']);
  });
});

describe('SORT_LABELS', () => {
  it('names every sort key', () => {
    expect(SORT_LABELS).toEqual({
      dueDate: 'Due date',
      amount: 'Amount',
      name: 'Bill name',
      status: 'Status',
    });
  });
});
