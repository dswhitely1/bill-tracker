import type { ParamMap, Params } from '@angular/router';
import { BILL_STATUSES } from '@bill-tracker/shared-types';
import type { BillStatus } from '@bill-tracker/shared-types';
import { MAX_RANGE_DAYS } from '../core/state/instances.store';
import {
  CalendarDate,
  addDays,
  compare,
  endOfMonth,
  isCalendarDate,
  startOfMonth,
  today,
} from '../core/date/calendar-date';

export const SORT_KEYS = ['dueDate', 'amount', 'name', 'status'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDir = (typeof SORT_DIRECTIONS)[number];

/**
 * "Bills with no category", which is a real filter and distinct from "any
 * category". An empty parameter value cannot express it.
 */
export const NO_CATEGORY = 'none';

export interface UpcomingParams {
  from: CalendarDate;
  to: CalendarDate;
  status: BillStatus | null;
  overdue: boolean | null;
  billId: string | null;
  categoryId: string | null;
  q: string;
  sort: SortKey;
  dir: SortDir;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function defaultParams(now: CalendarDate = today()): UpcomingParams {
  return {
    from: startOfMonth(now),
    to: endOfMonth(now),
    status: null,
    overdue: null,
    billId: null,
    categoryId: null,
    q: '',
    sort: 'dueDate',
    dir: 'asc',
  };
}

/**
 * A range is kept only when it is one the API would accept: both ends real
 * calendar days, forwards, and no wider than the cap. Anything else falls
 * back to the current month.
 *
 * This is the point of the whole module. A URL is user input — it arrives
 * from bookmarks, shared links, and hand-editing — so a malformed one must
 * render the default view rather than a 400 or a blank screen.
 */
function readRange(map: ParamMap, now: CalendarDate): { from: CalendarDate; to: CalendarDate } {
  const fallback = { from: startOfMonth(now), to: endOfMonth(now) };
  const from = map.get('from');
  const to = map.get('to');

  if (!isCalendarDate(from) || !isCalendarDate(to)) return fallback;
  if (compare(to, from) < 0) return fallback;
  // A difference, not an inclusive count — the API accepts a span of
  // exactly MAX_RANGE_DAYS.
  if (compare(to, addDays(from, MAX_RANGE_DAYS)) > 0) return fallback;

  return { from, to };
}

function readStatus(value: string | null): BillStatus | null {
  return BILL_STATUSES.includes(value as BillStatus) ? (value as BillStatus) : null;
}

function readOverdue(value: string | null): boolean | null {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return null;
}

function readUuid(value: string | null): string | null {
  return value !== null && UUID.test(value) ? value : null;
}

function readCategoryId(value: string | null): string | null {
  if (value === NO_CATEGORY) return NO_CATEGORY;
  return readUuid(value);
}

function readSort(value: string | null): SortKey {
  return SORT_KEYS.includes(value as SortKey) ? (value as SortKey) : 'dueDate';
}

function readDir(value: string | null): SortDir {
  return SORT_DIRECTIONS.includes(value as SortDir) ? (value as SortDir) : 'asc';
}

export function parseUpcomingParams(map: ParamMap, now: CalendarDate = today()): UpcomingParams {
  return {
    ...readRange(map, now),
    status: readStatus(map.get('status')),
    overdue: readOverdue(map.get('overdue')),
    billId: readUuid(map.get('billId')),
    categoryId: readCategoryId(map.get('categoryId')),
    q: (map.get('q') ?? '').trim(),
    sort: readSort(map.get('sort')),
    dir: readDir(map.get('dir')),
  };
}

/**
 * The range is always emitted, so a copied URL carries the window it was
 * read in. Everything else appears only when it differs from the default,
 * which keeps an ordinary URL short enough to read.
 */
export function toQueryParams(params: UpcomingParams): Params {
  const query: Params = { from: params.from, to: params.to };

  if (params.status !== null) query['status'] = params.status;
  if (params.overdue !== null) query['overdue'] = String(params.overdue);
  if (params.billId !== null) query['billId'] = params.billId;
  if (params.categoryId !== null) query['categoryId'] = params.categoryId;
  if (params.q !== '') query['q'] = params.q;
  if (params.sort !== 'dueDate') query['sort'] = params.sort;
  if (params.dir !== 'asc') query['dir'] = params.dir;

  return query;
}
