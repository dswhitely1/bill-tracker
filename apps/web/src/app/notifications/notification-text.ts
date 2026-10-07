import type { Params } from '@angular/router';
import type { NotificationItem, NotificationKind } from '@bill-tracker/shared-types';
import { defaultParams, toQueryParams } from '../instances/upcoming-params';

const LABELS: Record<NotificationKind, string> = {
  DUE_TOMORROW: 'Due tomorrow',
  DUE_IN_3_DAYS: 'Due in 3 days',
};

export function kindLabel(kind: NotificationKind): string {
  return LABELS[kind];
}

/**
 * The query parameters that land the user on exactly the row the
 * notification is about, rather than on a list they then have to search.
 *
 * Built from `defaultParams()` so every filter this does not set is at
 * its default and therefore omitted by `toQueryParams` — in particular
 * `status`, which if carried over would filter out a paid bill's row from
 * the very list its notification linked to.
 *
 * `CalendarDate` (see `core/date/calendar-date.ts`) is a plain `string`,
 * not a branded type, so `item.dueDate` is assignable to `from`/`to`
 * without a cast or a guard.
 */
export function notificationLink(item: NotificationItem): Params {
  return toQueryParams({
    ...defaultParams(),
    from: item.dueDate,
    to: item.dueDate,
    billId: item.billId,
  });
}

/**
 * The server's cap, stated in the one place the page mentions it. Kept as
 * a label rather than a number so the copy reads naturally and there is
 * one string to change if the cap moves.
 */
export const LIST_CAP_LABEL = 'most recent 200';
