import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './notification.entity';
import { BillGeneratorService } from '../bills/bill-generator.service';
import { addDays } from '../bills/dates';
import { MailTransport } from './mail/mail-transport';
import { DigestItem, DigestRecipient, renderDigest } from './digest';

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

/**
 * A projection of an already-fixed set, not a second selection. The ids
 * come from `scan()`'s `RETURNING`, so this cannot disagree with it about
 * what is new — it only looks up the labels for rows already decided.
 *
 * `notify_email` is filtered here rather than in `scan()`: the row is
 * written for anyone with either channel on, and the email channel
 * consults its own toggle at delivery time.
 *
 * `due_date` is cast to text because a `date` read through a raw query is
 * parsed into a JS `Date` by node-postgres — TypeORM's entity hydration is
 * what normally keeps these as strings, and a raw query bypasses it.
 */
const DIGEST_SQL = `
  SELECT
    n."user_id"                      AS user_id,
    u."email"                        AS email,
    u."name"                         AS name,
    n."kind"                         AS kind,
    b."name"                         AS bill_name,
    bi."due_date"::text              AS due_date,
    (bi."amount" - bi."amount_paid") AS amount_due
  FROM "notifications" n
  INNER JOIN "users" u          ON u."id"  = n."user_id"
  INNER JOIN "bill_instances" bi ON bi."id" = n."bill_instance_id"
  INNER JOIN "bills" b           ON b."id"  = bi."bill_id"
  WHERE n."id" = ANY($1::uuid[]) AND u."notify_email"
`;

interface DigestRow {
  user_id: string;
  email: string;
  name: string;
  kind: 'DUE_IN_3_DAYS' | 'DUE_TOMORROW';
  bill_name: string;
  due_date: string;
  amount_due: string;
}

export interface RunResult {
  created: number;
  usersNotified: number;
  mailSent: number;
  mailFailed: number;
}

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly generator: BillGeneratorService,
    private readonly mail: MailTransport,
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

  /**
   * Scans, then sends one digest email per user whose rows are new and
   * who has email enabled. Phase one writes the rows and commits; phase
   * two sends mail. The order is what makes a mail failure cost the
   * email and nothing else.
   */
  async run(): Promise<RunResult> {
    const created = await this.scan();
    if (created.length === 0) {
      return { created: 0, usersNotified: 0, mailSent: 0, mailFailed: 0 };
    }

    const rows = await this.notifications.query<DigestRow[]>(DIGEST_SQL, [
      created.map((c) => c.id),
    ]);

    const byUser = new Map<string, { recipient: DigestRecipient; items: DigestItem[] }>();
    for (const row of rows) {
      const entry = byUser.get(row.user_id) ?? {
        recipient: { email: row.email, name: row.name },
        items: [],
      };
      entry.items.push({
        kind: row.kind,
        billName: row.bill_name,
        dueDate: row.due_date,
        // `numeric` arrives as a string on a raw query. Unconverted, the
        // currency formatter would be handed "200.00" and the digest would
        // read "$NaN".
        amountDue: Number(row.amount_due),
      });
      byUser.set(row.user_id, entry);
    }

    let mailSent = 0;
    let mailFailed = 0;

    for (const [userId, { recipient, items }] of byUser) {
      const message = renderDigest(recipient, items);
      if (message === null) continue;
      try {
        await this.mail.send(message);
        mailSent += 1;
      } catch (error: unknown) {
        // Per user, so one dead address cannot silence everyone else's
        // digest. Never retried and never rolled back (spec §4.4).
        mailFailed += 1;
        this.logger.error(`Reminder digest to user ${userId} failed`, error as Error);
      }
    }

    const result = {
      created: created.length,
      // From scan()'s own output, not byUser.size: DIGEST_SQL filters on
      // notify_email, so a user who only has notify_in_app on would never
      // enter byUser even though scan() wrote their row and their bell
      // lit up. usersNotified must count every user notified by any
      // channel, not just the ones who got mail.
      usersNotified: new Set(created.map((c) => c.userId)).size,
      mailSent,
      mailFailed,
    };
    this.logger.log(
      `Reminder run created ${result.created} notification(s); ` +
        `mail sent ${mailSent}, failed ${mailFailed}`,
    );
    return result;
  }
}
