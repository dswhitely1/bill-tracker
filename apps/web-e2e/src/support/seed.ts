import { DataSource } from 'typeorm';
import { E2E_DATABASE_URL } from './database-url.ts';

/**
 * Inserts one notification row directly.
 *
 * Everything else in this journey goes through the UI — the account is
 * registered and the bill created like a user would. The one thing a
 * journey cannot do is wait until 08:00 for the reminder cron, so that
 * single row is written here.
 *
 * Deliberately NOT a copy of the reminder run's own statement. It selects
 * one already-known instance by bill name and due date and inserts one
 * row, so it cannot quietly become a second implementation of the
 * selection logic that then agrees with a broken original.
 */
export async function seedNotification(
  email: string,
  kind: 'DUE_IN_3_DAYS' | 'DUE_TOMORROW',
  billName: string,
): Promise<void> {
  const ds = new DataSource({ type: 'postgres', url: E2E_DATABASE_URL });
  await ds.initialize();
  try {
    const rows = await ds.query(
      `SELECT bi."id" AS instance_id, bi."user_id" AS user_id
       FROM "bill_instances" bi
       INNER JOIN "bills" b ON b."id" = bi."bill_id"
       INNER JOIN "users" u ON u."id" = bi."user_id"
       WHERE u."email" = $1 AND b."name" = $2
       ORDER BY bi."due_date" ASC
       LIMIT 1`,
      [email.toLowerCase(), billName],
    );
    if (rows.length === 0) {
      throw new Error(
        `seedNotification found no instance of "${billName}" for ${email}. ` +
          'The bill must be created through the UI before this is called.',
      );
    }
    await ds.query(
      `INSERT INTO "notifications" ("user_id","bill_instance_id","kind")
       VALUES ($1,$2,$3)
       ON CONFLICT ("bill_instance_id","kind") DO NOTHING`,
      [rows[0].user_id, rows[0].instance_id, kind],
    );
  } finally {
    await ds.destroy();
  }
}
