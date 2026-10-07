/** Dates are `YYYY-MM-DD`. Money is a `number`. */
export interface SummaryBucket {
  count: number;
  amount: number;
}

export interface OverdueSummary extends SummaryBucket {
  /**
   * The due date of the oldest unpaid overdue instance, or null when there
   * are none. Exists so the dashboard's link into /upcoming can target a
   * range that actually contains every row the figure counted — the list
   * caps a range at 400 days, and this figure has no lower bound.
   */
  earliestDueDate: string | null;
}

export interface CategorySummary {
  /** null means the bill has no category; the client renders "Uncategorized". */
  categoryId: string | null;
  categoryName: string | null;
  color: string | null;
  total: number;
  paid: number;
}

export interface SummaryResponse {
  /** The server's calendar day under APP_TIMEZONE. Everything else is relative to it. */
  asOf: string;
  overdue: OverdueSummary;
  thisMonth: { count: number; total: number; paid: number };
  next7Days: SummaryBucket;
  byCategory: CategorySummary[];
}
