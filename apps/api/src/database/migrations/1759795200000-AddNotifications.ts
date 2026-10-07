import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `UQ_notifications_instance_kind` is the load-bearing constraint of the
 * whole sub-project, not an incidental tidiness. Spec §4.3 makes the
 * reminder run idempotent by writing with `ON CONFLICT DO NOTHING` against
 * exactly this constraint, which is what makes the run safe to call twice,
 * from two processes, and at every application boot (§4.5). An
 * application-level "have I already sent this?" check would race between
 * processes and would be wrong across a restart mid-run; this one cannot be.
 *
 * `CHK_notifications_kind` guards the same two values the TypeScript union
 * carries, for the reason `CHK_payment_logs_sign` gives in the previous
 * migration: a write path that skips the service — an admin script, a
 * data fix, a bulk import — must not be able to invent a third kind that
 * every client then fails to render.
 *
 * `user_id` is denormalized from `bill_instances`, matching what
 * `bill_instances` itself does. Every scoping query then filters on a
 * column of the row it is returning rather than on something two joins
 * away, and the authorization predicate cannot be lost in a join rewrite.
 */
export class AddNotifications1759795200000 implements MigrationInterface {
  name = 'AddNotifications1759795200000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "notifications" (
        "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"          uuid        NOT NULL,
        "bill_instance_id" uuid        NOT NULL,
        "kind"             varchar(20) NOT NULL,
        "read_at"          timestamptz,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_notifications_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_notifications_instance"
          FOREIGN KEY ("bill_instance_id") REFERENCES "bill_instances"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_notifications_instance_kind"
          UNIQUE ("bill_instance_id", "kind"),
        CONSTRAINT "CHK_notifications_kind"
          CHECK ("kind" IN ('DUE_IN_3_DAYS', 'DUE_TOMORROW'))
      )`);

    // The bell's unread count, and the page's ordering. Separate indexes
    // rather than one composite: the count never orders and the list never
    // filters on read_at.
    await q.query(
      `CREATE INDEX "IDX_notifications_user_unread" ON "notifications" ("user_id", "read_at")`,
    );
    await q.query(
      `CREATE INDEX "IDX_notifications_user_created"
         ON "notifications" ("user_id", "created_at" DESC)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    // Nothing references this table, so the whole thing goes at once; the
    // indexes and constraints fall with it.
    await q.query(`DROP TABLE "notifications"`);
  }
}
