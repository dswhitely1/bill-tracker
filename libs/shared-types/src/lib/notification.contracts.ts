export const NOTIFICATION_KINDS = ['DUE_IN_3_DAYS', 'DUE_TOMORROW'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Dates are `YYYY-MM-DD`. Money is a `number`. */
export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  isRead: boolean;
  /** ISO 8601 instant, not a calendar day. */
  createdAt: string;
  billInstanceId: string;
  billId: string;
  billName: string;
  dueDate: string;
  /** The outstanding balance now — `amount - amount_paid`, not the face amount. */
  amountDue: number;
  /**
   * The bill has since been paid in full, so the reminder no longer asks
   * for anything. Resolved notifications stay in the list as history but
   * are excluded from `unreadCount`: a badge that counts a bill you have
   * already paid is a number that means nothing.
   */
  isResolved: boolean;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  /** Unread AND unresolved, counted over the whole table, not the capped page. */
  unreadCount: number;
  /**
   * True when `items` was truncated by the server's cap, so the page can
   * say so rather than implying this is everything.
   */
  truncated: boolean;
}

export interface MarkAllReadResponse {
  updated: number;
}
