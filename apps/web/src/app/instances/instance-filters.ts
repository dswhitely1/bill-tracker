import { BILL_STATUSES } from '@bill-tracker/shared-types';
import type { BillInstanceResponse } from '@bill-tracker/shared-types';
import { compare } from '../core/date/calendar-date';
import { NO_CATEGORY, SortDir, SortKey } from './upcoming-params';

export const SORT_LABELS: Record<SortKey, string> = {
  dueDate: 'Due date',
  amount: 'Amount',
  name: 'Bill name',
  status: 'Status',
};

export interface ClientFilters {
  q: string;
  categoryId: string | null;
}

/**
 * The filters that never reach the API.
 *
 * Nothing is paginated — the range is capped at 400 days and the list
 * endpoint returns the whole matching set in one response — so every row a
 * person could search is already in memory. A round trip would buy nothing.
 */
export function filterInstances(
  rows: readonly BillInstanceResponse[],
  { q, categoryId }: ClientFilters,
): BillInstanceResponse[] {
  const term = q.trim().toLowerCase();

  return rows.filter((row) => {
    if (term !== '' && !row.billName.toLowerCase().includes(term)) return false;
    if (categoryId === null) return true;
    if (categoryId === NO_CATEGORY) return row.categoryId === null;
    return row.categoryId === categoryId;
  });
}

/**
 * Sorting by the bill's face amount, not its remaining balance. The column
 * is labelled "Amount" and that is the figure a person means by it; the
 * balance is derived and moves every time a payment lands.
 */
const COMPARATORS: Record<SortKey, (a: BillInstanceResponse, b: BillInstanceResponse) => number> = {
  dueDate: (a, b) => compare(a.dueDate, b.dueDate),
  amount: (a, b) => a.amount - b.amount,
  name: (a, b) => a.billName.localeCompare(b.billName),
  // Enum order, not alphabetical: alphabetical puts PAID first, which is
  // the opposite of what someone sorting by status wants to see.
  status: (a, b) => BILL_STATUSES.indexOf(a.status) - BILL_STATUSES.indexOf(b.status),
};

/** Mirrors the server's `dueDate ASC, id ASC`, so equal keys never reorder. */
function tiebreak(a: BillInstanceResponse, b: BillInstanceResponse): number {
  return compare(a.dueDate, b.dueDate) || a.id.localeCompare(b.id);
}

export function sortInstances(
  rows: readonly BillInstanceResponse[],
  sort: SortKey,
  dir: SortDir,
): BillInstanceResponse[] {
  const sign = dir === 'desc' ? -1 : 1;
  // A copy: `Array.prototype.sort` is in-place, and the argument is a
  // store's own array.
  return [...rows].sort((a, b) => sign * COMPARATORS[sort](a, b) || tiebreak(a, b));
}
