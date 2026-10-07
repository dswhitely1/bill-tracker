import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { CategorySummary, SummaryResponse } from '@bill-tracker/shared-types';
import { BillInstance } from '../bills/bill-instance.entity';
import { BillGeneratorService } from '../bills/bill-generator.service';
import { addDays, daysInMonth, format, parse } from '../bills/dates';

/**
 * One pass over the user's instances producing all three scalar buckets.
 *
 * `FILTER` rather than three separate statements: the table is scanned
 * once, and the `['userId', 'status', 'dueDate']` index serves the whole
 * predicate. `bill_instances.user_id` is denormalized, so no join to
 * `bills` is needed here at all.
 *
 * Every `SUM` is wrapped in `COALESCE`: Postgres returns NULL, not 0, for
 * a sum over zero rows, and an account with no bills would otherwise put
 * `null` where the dashboard expects a money figure.
 *
 * `MIN(due_date)` is cast to text. A `date` column read through a raw
 * query is parsed by node-postgres into a JS `Date` — TypeORM's entity
 * hydration is what normally keeps these as strings, and a raw query
 * bypasses it. The cast is what keeps a calendar day a calendar day.
 */
const SCALAR_SQL = `
  SELECT
    COUNT(*) FILTER (WHERE status <> 'PAID' AND due_date < $2::date)
      AS overdue_count,
    COALESCE(SUM(amount - amount_paid)
      FILTER (WHERE status <> 'PAID' AND due_date < $2::date), 0)
      AS overdue_amount,
    MIN(due_date) FILTER (WHERE status <> 'PAID' AND due_date < $2::date)::text
      AS overdue_earliest,
    COUNT(*) FILTER (WHERE status <> 'PAID' AND due_date >= $2::date AND due_date <= $3::date)
      AS next7_count,
    COALESCE(SUM(amount - amount_paid)
      FILTER (WHERE status <> 'PAID' AND due_date >= $2::date AND due_date <= $3::date), 0)
      AS next7_amount,
    COUNT(*) FILTER (WHERE due_date >= $4::date AND due_date <= $5::date)
      AS month_count,
    COALESCE(SUM(amount) FILTER (WHERE due_date >= $4::date AND due_date <= $5::date), 0)
      AS month_total,
    COALESCE(SUM(amount_paid) FILTER (WHERE due_date >= $4::date AND due_date <= $5::date), 0)
      AS month_paid
  FROM bill_instances
  WHERE user_id = $1
`;

/**
 * No COALESCE here: GROUP BY only emits a row when that group has at
 * least one instance, so these sums are never over an empty set.
 *
 * `category_id` is cast to text for the same reason `due_date` is above —
 * raw rows skip the entity layer. Ordering by total then name keeps the
 * output stable between identical requests.
 */
const CATEGORY_SQL = `
  SELECT
    b.category_id::text AS category_id,
    c.name              AS category_name,
    c.color             AS color,
    SUM(i.amount)       AS total,
    SUM(i.amount_paid)  AS paid
  FROM bill_instances i
  INNER JOIN bills b ON b.id = i.bill_id
  LEFT JOIN categories c ON c.id = b.category_id
  WHERE i.user_id = $1 AND i.due_date >= $2::date AND i.due_date <= $3::date
  GROUP BY b.category_id, c.name, c.color
  ORDER BY SUM(i.amount) DESC, c.name ASC
`;

interface ScalarRow {
  overdue_count: string;
  overdue_amount: string;
  overdue_earliest: string | null;
  next7_count: string;
  next7_amount: string;
  month_count: string;
  month_total: string;
  month_paid: string;
}

interface CategoryRow {
  category_id: string | null;
  category_name: string | null;
  color: string | null;
  total: string;
  paid: string;
}

/**
 * `numeric` arrives as a string because an arbitrary-precision decimal
 * does not fit a JS number in general, and `COUNT(*)` arrives as a string
 * because it is a `bigint`. Both bypass the entity's `numericTransformer`
 * on a raw query. Unconverted, `total` serializes as `"300.00"` and the
 * client's arithmetic becomes string concatenation.
 */
function toCategorySummary(row: CategoryRow): CategorySummary {
  return {
    categoryId: row.category_id,
    categoryName: row.category_name,
    color: row.color,
    total: Number(row.total),
    paid: Number(row.paid),
  };
}

@Injectable()
export class SummaryService {
  constructor(
    @InjectRepository(BillInstance)
    private readonly instances: Repository<BillInstance>,
    private readonly generator: BillGeneratorService,
  ) {}

  async get(userId: string): Promise<SummaryResponse> {
    // Not CURRENT_DATE: that answers in the database session's time zone,
    // which APP_TIMEZONE does not control. This is the same call
    // BillInstancesService uses to stamp `isOverdue`, so the dashboard and
    // the list can never disagree about what day it is.
    const asOf = this.generator.today();
    const next7End = addDays(asOf, 6);
    const { y, m } = parse(asOf);
    const monthStart = format({ y, m, d: 1 });
    const monthEnd = format({ y, m, d: daysInMonth(y, m) });

    const scalarRows = await this.instances.query<ScalarRow[]>(SCALAR_SQL, [
      userId,
      asOf,
      next7End,
      monthStart,
      monthEnd,
    ]);
    const categoryRows = await this.instances.query<CategoryRow[]>(CATEGORY_SQL, [
      userId,
      monthStart,
      monthEnd,
    ]);

    const scalar = scalarRows[0];

    return {
      asOf,
      overdue: {
        count: Number(scalar.overdue_count),
        amount: Number(scalar.overdue_amount),
        earliestDueDate: scalar.overdue_earliest,
      },
      thisMonth: {
        count: Number(scalar.month_count),
        total: Number(scalar.month_total),
        paid: Number(scalar.month_paid),
      },
      next7Days: {
        count: Number(scalar.next7_count),
        amount: Number(scalar.next7_amount),
      },
      byCategory: categoryRows.map(toCategorySummary),
    };
  }
}
