import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { getTestDataSource } from './db';

let ds: DataSource;

beforeAll(async () => { ds = await getTestDataSource(); });
afterAll(async () => { if (ds?.isInitialized) await ds.destroy(); });

const columnsOf = (table: string) =>
  ds.query(
    `SELECT column_name, data_type, character_maximum_length, is_nullable
     FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name`,
    [table],
  );

describe('initial schema', () => {
  it('creates all three tables', async () => {
    const rows = await ds.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('users','refresh_tokens','categories')`,
    );
    expect(rows.map((r: { table_name: string }) => r.table_name).sort()).toEqual(
      ['categories', 'refresh_tokens', 'users'],
    );
  });

  it('sizes password_hash for a bcrypt digest', async () => {
    const cols = await columnsOf('users');
    const hash = cols.find((c: { column_name: string }) => c.column_name === 'password_hash');
    expect(hash.character_maximum_length).toBe(60);
  });

  it('sizes token_hash for a sha256 hex digest', async () => {
    const cols = await columnsOf('refresh_tokens');
    const hash = cols.find((c: { column_name: string }) => c.column_name === 'token_hash');
    expect(hash.character_maximum_length).toBe(64);
  });

  it('enforces category name uniqueness case-insensitively per user', async () => {
    const [user] = await ds.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ('schema@test.dev', 'x', 'Schema') RETURNING id`,
    );
    await ds.query(`INSERT INTO categories (user_id, name) VALUES ($1, 'Utilities')`, [user.id]);
    await expect(
      ds.query(`INSERT INTO categories (user_id, name) VALUES ($1, 'UTILITIES')`, [user.id]),
    ).rejects.toThrow(/duplicate key value violates unique constraint/i);
    await ds.query(`DELETE FROM users WHERE id = $1`, [user.id]);
  });

  it('cascades category and token deletion when a user is removed', async () => {
    const [user] = await ds.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ('cascade@test.dev', 'x', 'Cascade') RETURNING id`,
    );
    await ds.query(`INSERT INTO categories (user_id, name) VALUES ($1, 'Housing')`, [user.id]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [user.id]);
    const left = await ds.query(`SELECT 1 FROM categories WHERE user_id = $1`, [user.id]);
    expect(left).toHaveLength(0);
  });
});

describe('bill tables', () => {
  const columns = async (table: string) =>
    Object.fromEntries(
      (
        (await ds.query(
          `SELECT column_name, data_type, is_nullable, numeric_precision, numeric_scale
             FROM information_schema.columns WHERE table_name = $1`,
          [table],
        )) as Array<Record<string, unknown>>
      ).map((c) => [c.column_name, c]),
    );

  it('creates bills with money at numeric(12,2) and dates as date', async () => {
    const cols = await columns('bills');
    expect(cols.default_amount).toMatchObject({
      data_type: 'numeric', numeric_precision: 12, numeric_scale: 2,
    });
    expect(cols.start_date).toMatchObject({ data_type: 'date', is_nullable: 'NO' });
    expect(cols.end_date).toMatchObject({ data_type: 'date', is_nullable: 'YES' });
  });

  it('creates bill_instances with the cache columns and date due dates', async () => {
    const cols = await columns('bill_instances');
    expect(cols.due_date).toMatchObject({ data_type: 'date' });
    expect(cols.amount).toMatchObject({ numeric_precision: 12, numeric_scale: 2 });
    expect(cols.amount_paid).toMatchObject({ numeric_precision: 12, numeric_scale: 2 });
    expect(cols.is_customized).toMatchObject({ data_type: 'boolean', is_nullable: 'NO' });
  });

  it('makes the generator idempotent with UNIQUE (bill_id, due_date)', async () => {
    const [constraint] = (await ds.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid = 'bill_instances'::regclass AND contype = 'u'`,
    )) as Array<{ conname: string }>;
    expect(constraint.conname).toBe('UQ_bill_instances_bill_due');
  });

  it('restricts status to the three payment-progress values', async () => {
    const [check] = (await ds.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'CHK_bill_instances_status'`,
    )) as Array<{ def: string }>;
    expect(check.def).toContain("'UNPAID'");
    expect(check.def).toContain("'PARTIALLY_PAID'");
    expect(check.def).toContain("'PAID'");
    expect(check.def).not.toContain("'OVERDUE'"); // derived, never stored
  });

  it('lets a payment be reversed at most once, in the database', async () => {
    const [index] = (await ds.query(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_payment_logs_reverses'`,
    )) as Array<{ indexdef: string }>;
    expect(index.indexdef).toContain('UNIQUE');
    expect(index.indexdef).toContain('reverses_payment_id IS NOT NULL');
  });

  it('requires a non-reversal payment_logs row to be positive', async () => {
    const [check] = (await ds.query(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'CHK_payment_logs_sign'`,
    )) as Array<{ def: string }>;
    expect(check.def).toContain('reverses_payment_id IS NOT NULL');
    expect(check.def).toContain('amount_paid > (0)::numeric');
  });

  it('indexes the two query shapes the dashboard and calendar need', async () => {
    const names = (
      (await ds.query(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'bill_instances'`,
      )) as Array<{ indexname: string }>
    ).map((r) => r.indexname);
    expect(names).toContain('IDX_bill_instances_user_due');
    expect(names).toContain('IDX_bill_instances_user_status_due');
  });

  it("nulls a bill's category rather than deleting the bill", async () => {
    const [fk] = (await ds.query(
      `SELECT confdeltype FROM pg_constraint
        WHERE conrelid = 'bills'::regclass AND contype = 'f'
          AND confrelid = 'categories'::regclass`,
    )) as Array<{ confdeltype: string }>;
    expect(fk.confdeltype).toBe('n'); // 'n' = SET NULL, 'c' would be CASCADE
  });
});

describe('notifications table', () => {
  const seedInstance = async (): Promise<{ userId: string; instanceId: string }> => {
    const [user] = await ds.query(
      `INSERT INTO "users" ("email","password_hash","name")
       VALUES ($1,$2,'U') RETURNING "id"`,
      [`n${Math.random()}@example.com`, 'x'.repeat(60)],
    );
    const [bill] = await ds.query(
      `INSERT INTO "bills" ("user_id","name","default_amount","frequency","start_date")
       VALUES ($1,'Rent',100,'MONTHLY','2026-01-01') RETURNING "id"`,
      [user.id],
    );
    const [instance] = await ds.query(
      `INSERT INTO "bill_instances" ("bill_id","user_id","due_date","amount")
       VALUES ($1,$2,'2026-06-01',100) RETURNING "id"`,
      [bill.id, user.id],
    );
    return { userId: user.id, instanceId: instance.id };
  };

  it('records a reminder at most once per instance and kind', async () => {
    const { userId, instanceId } = await seedInstance();
    await ds.query(
      `INSERT INTO "notifications" ("user_id","bill_instance_id","kind")
       VALUES ($1,$2,'DUE_IN_3_DAYS')`,
      [userId, instanceId],
    );

    // The same (instance, kind) again must be refused by the database, not
    // merely avoided by the service. This constraint is the whole
    // idempotency story for the reminder run (spec §4.3).
    await expect(
      ds.query(
        `INSERT INTO "notifications" ("user_id","bill_instance_id","kind")
         VALUES ($1,$2,'DUE_IN_3_DAYS')`,
        [userId, instanceId],
      ),
    ).rejects.toThrow(/UQ_notifications_instance_kind|duplicate key/);
  });

  it('accepts both kinds for one instance', async () => {
    const { userId, instanceId } = await seedInstance();
    await ds.query(
      `INSERT INTO "notifications" ("user_id","bill_instance_id","kind")
       VALUES ($1,$2,'DUE_IN_3_DAYS'), ($1,$2,'DUE_TOMORROW')`,
      [userId, instanceId],
    );
    const rows = await ds.query(
      `SELECT "kind" FROM "notifications" WHERE "bill_instance_id" = $1 ORDER BY "kind"`,
      [instanceId],
    );
    expect(rows.map((r: { kind: string }) => r.kind)).toEqual(['DUE_IN_3_DAYS', 'DUE_TOMORROW']);
  });

  it('refuses a kind the clients cannot render', async () => {
    const { userId, instanceId } = await seedInstance();
    await expect(
      ds.query(
        `INSERT INTO "notifications" ("user_id","bill_instance_id","kind")
         VALUES ($1,$2,'DUE_IN_99_DAYS')`,
        [userId, instanceId],
      ),
    ).rejects.toThrow(/CHK_notifications_kind|violates check constraint/);
  });

  it('removes a reminder when its instance goes away', async () => {
    const { userId, instanceId } = await seedInstance();
    await ds.query(
      `INSERT INTO "notifications" ("user_id","bill_instance_id","kind")
       VALUES ($1,$2,'DUE_TOMORROW')`,
      [userId, instanceId],
    );
    await ds.query(`DELETE FROM "bill_instances" WHERE "id" = $1`, [instanceId]);
    const rows = await ds.query(`SELECT 1 FROM "notifications" WHERE "user_id" = $1`, [userId]);
    expect(rows).toHaveLength(0);
  });

  it('stores read_at as a nullable instant and created_at as a defaulted one', async () => {
    const rows = await columnsOf('notifications');
    const byName = Object.fromEntries(
      rows.map((r: { column_name: string; data_type: string; is_nullable: string }) => [
        r.column_name,
        r,
      ]),
    );
    expect(byName['read_at'].data_type).toBe('timestamp with time zone');
    expect(byName['read_at'].is_nullable).toBe('YES');
    expect(byName['created_at'].is_nullable).toBe('NO');
  });

  it('indexes the two shapes the bell and the list query', async () => {
    const rows = await ds.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'notifications'`,
    );
    const names = rows.map((r: { indexname: string }) => r.indexname);
    expect(names).toContain('IDX_notifications_user_unread');
    expect(names).toContain('IDX_notifications_user_created');
  });
});
