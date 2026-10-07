import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './notification.entity';
import { BillGeneratorService } from '../bills/bill-generator.service';
import { addDays } from '../bills/dates';

/**
 * Selection and deduplication in one statement.
 *
 * `ON CONFLICT DO NOTHING` against `UQ_notifications_instance_kind` is the
 * entire idempotency story — not an application-level "have I sent this?"
 * check, which would race between two processes and would be wrong across
 * a restart mid-run. The database holds the guarantee.
 *
 * `RETURNING` therefore yields exactly the rows that are new in this run,
 * which is precisely the set to email. The decision about what is new is
 * made once, by this statement, rather than by a second selection that
 * could disagree with it.
 *
 * The `VALUES` join rather than `due_date IN (...)`: the kind has to come
 * from whichever date matched, and a bare `IN` loses that association.
 *
 * `status <> 'PAID'` rather than `= 'UNPAID'`: a partly paid bill still
 * has a balance due.
 *
 * The `users` join with `(notify_in_app OR notify_email)` means a user who
 * wants nothing generates nothing at all — no rows, no mail, no growth.
 */
const SCAN_SQL = `
  INSERT INTO "notifications" ("user_id", "bill_instance_id", "kind")
  SELECT bi."user_id", bi."id", k.kind
  FROM "bill_instances" bi
  INNER JOIN "users" u ON u."id" = bi."user_id"
  INNER JOIN (VALUES ($1::date, 'DUE_IN_3_DAYS'), ($2::date, 'DUE_TOMORROW'))
    AS k(due, kind) ON k.due = bi."due_date"
  WHERE bi."status" <> 'PAID'
    AND (u."notify_in_app" OR u."notify_email")
  ON CONFLICT ("bill_instance_id", "kind") DO NOTHING
  RETURNING "id", "user_id"
`;

interface NewNotificationRow {
  id: string;
  user_id: string;
}

export interface NewNotification {
  id: string;
  userId: string;
}

@Injectable()
export class RemindersService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly generator: BillGeneratorService,
  ) {}

  /**
   * Writes every reminder that newly qualifies today and returns only
   * those it created. Safe to call repeatedly.
   */
  async scan(): Promise<NewNotification[]> {
    // Not CURRENT_DATE: that answers in the database session's zone, which
    // APP_TIMEZONE does not control. The same call the summary endpoint and
    // the overdue badge use, so no two parts of the application can
    // disagree about what day it is.
    const asOf = this.generator.today();

    const rows = await this.notifications.query<NewNotificationRow[]>(SCAN_SQL, [
      addDays(asOf, 3),
      addDays(asOf, 1),
    ]);

    return rows.map((row) => ({ id: row.id, userId: row.user_id }));
  }
}
