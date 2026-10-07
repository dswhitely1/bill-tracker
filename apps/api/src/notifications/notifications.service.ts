import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import type {
  MarkAllReadResponse,
  NotificationItem,
  NotificationKind,
  NotificationListResponse,
} from '@bill-tracker/shared-types';
import { Notification } from './notification.entity';

/**
 * A deliberate departure from "nothing is paginated". The instance list is
 * bounded by a 400-day range; this table grows for as long as the account
 * exists — roughly two rows per bill per month, forever. The cap bounds
 * every response without introducing pagination UI, and the response says
 * when it bit.
 */
export const LIST_CAP = 200;

/**
 * Every label is joined, never stored: a notification is a pointer (spec
 * §3.2). Rename a bill and its old reminders say the new name, which is
 * what keeps the bell from contradicting the dashboard.
 *
 * `due_date` is cast to text because a raw query skips TypeORM's entity
 * hydration, and node-postgres would otherwise parse the `date` into a JS
 * `Date` in the host's zone. `created_at` is deliberately left as a native
 * `timestamptz` — do not add `::text` to it — because `toItem()` below
 * calls `.toISOString()` on it, which only exists on a `Date`.
 *
 * The `LIMIT` takes one more row than the cap, so the service can tell
 * "exactly at the cap" from "truncated" without a second COUNT.
 */
const LIST_SQL = `
  SELECT
    n."id"                           AS id,
    n."kind"                         AS kind,
    (n."read_at" IS NOT NULL)        AS is_read,
    n."created_at"                   AS created_at,
    bi."id"                          AS bill_instance_id,
    b."id"                           AS bill_id,
    b."name"                         AS bill_name,
    bi."due_date"::text              AS due_date,
    (bi."amount" - bi."amount_paid") AS amount_due,
    (bi."status" = 'PAID')           AS is_resolved
  FROM "notifications" n
  INNER JOIN "bill_instances" bi ON bi."id" = n."bill_instance_id"
  INNER JOIN "bills" b           ON b."id"  = bi."bill_id"
  WHERE n."user_id" = $1
  ORDER BY n."created_at" DESC, n."id" DESC
  LIMIT $2
`;

/**
 * Unread *and* unresolved. A badge that counts a bill the user has already
 * paid is a number that means nothing, and the reminder's whole purpose is
 * discharged by the payment.
 *
 * COUNT(*) over zero rows is 0, not NULL — only bare aggregates like SUM
 * return NULL there — so no COALESCE is needed.
 */
const UNREAD_SQL = `
  SELECT COUNT(*) AS unread
  FROM "notifications" n
  INNER JOIN "bill_instances" bi ON bi."id" = n."bill_instance_id"
  WHERE n."user_id" = $1 AND n."read_at" IS NULL AND bi."status" <> 'PAID'
`;

interface ListRow {
  id: string;
  kind: NotificationKind;
  is_read: boolean;
  created_at: Date;
  bill_instance_id: string;
  bill_id: string;
  bill_name: string;
  due_date: string;
  amount_due: string;
  is_resolved: boolean;
}

function toItem(row: ListRow): NotificationItem {
  return {
    id: row.id,
    kind: row.kind,
    isRead: row.is_read,
    createdAt: row.created_at.toISOString(),
    billInstanceId: row.bill_instance_id,
    billId: row.bill_id,
    billName: row.bill_name,
    dueDate: row.due_date,
    // `numeric` arrives as a string on a raw query. Unconverted, the
    // client's arithmetic becomes string concatenation.
    amountDue: Number(row.amount_due),
    isResolved: row.is_resolved,
  };
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  async list(userId: string): Promise<NotificationListResponse> {
    const rows = await this.notifications.query<ListRow[]>(LIST_SQL, [userId, LIST_CAP + 1]);
    const [{ unread }] = await this.notifications.query<[{ unread: string }]>(UNREAD_SQL, [
      userId,
    ]);

    return {
      items: rows.slice(0, LIST_CAP).map(toItem),
      // `COUNT(*)` is a bigint, which node-postgres returns as a string.
      unreadCount: Number(unread),
      truncated: rows.length > LIST_CAP,
    };
  }

  async markRead(userId: string, id: string): Promise<void> {
    // `read_at IS NULL` in the predicate rather than an unconditional SET:
    // a second call must not move the instant the user first dismissed it.
    // The scoping predicate on `user_id` is what makes another user's id a
    // 404 rather than a silent cross-tenant write.
    //
    // IsNull() rather than a bare `null`: a bare `null` in a
    // FindOptionsWhere is not reliably translated to `IS NULL`, and the
    // failure mode is silent — `update` would match zero rows, the
    // `exists` fallback below would then find the row and return success,
    // and markRead would appear to work while never writing `read_at`.
    const result = await this.notifications.update(
      { id, userId, readAt: IsNull() },
      { readAt: new Date() },
    );

    if (result.affected === 0) {
      // Zero rows means either "not yours / does not exist" or "already
      // read". Distinguish them, because the second is a success.
      const exists = await this.notifications.exists({ where: { id, userId } });
      if (!exists) {
        // The same 404 for someone else's row as for one that does not
        // exist: a different status would disclose that it exists.
        throw new NotFoundException('Notification not found');
      }
    }
  }

  async markAllRead(userId: string): Promise<MarkAllReadResponse> {
    const result = await this.notifications.update(
      { userId, readAt: IsNull() },
      { readAt: new Date() },
    );
    return { updated: result.affected ?? 0 };
  }
}
