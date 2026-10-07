import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app/app.module';
import { BillGeneratorService } from '../src/bills/bill-generator.service';
import { RemindersService } from '../src/notifications/reminders.service';
import { addDays } from '../src/bills/dates';
import { getTestDataSource, truncateAll } from './db';

let moduleRef: TestingModule;
let reminders: RemindersService;
let generator: BillGeneratorService;
let ds: DataSource;

beforeAll(async () => {
  process.env.ENV_FILE = '.env.test';
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  reminders = moduleRef.get(RemindersService);
  generator = moduleRef.get(BillGeneratorService);
  ds = await getTestDataSource();
});

beforeEach(async () => {
  await truncateAll(ds);
});

afterAll(async () => {
  await moduleRef?.close();
  if (ds?.isInitialized) await ds.destroy();
});

interface SeedUserOptions {
  notifyEmail?: boolean;
  notifyInApp?: boolean;
  email?: string;
}

async function seedUser(options: SeedUserOptions = {}): Promise<string> {
  const [row] = await ds.query(
    `INSERT INTO "users" ("email","password_hash","name","notify_email","notify_in_app")
     VALUES ($1,$2,'Don',$3,$4) RETURNING "id"`,
    [
      options.email ?? `u${Math.random()}@example.com`,
      'x'.repeat(60),
      options.notifyEmail ?? true,
      options.notifyInApp ?? true,
    ],
  );
  return row.id as string;
}

interface SeedInstanceOptions {
  dueDate: string;
  status?: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  amount?: number;
  amountPaid?: number;
  name?: string;
}

async function seedInstance(userId: string, options: SeedInstanceOptions): Promise<string> {
  const [bill] = await ds.query(
    `INSERT INTO "bills" ("user_id","name","default_amount","frequency","start_date")
     VALUES ($1,$2,$3,'MONTHLY','2026-01-01') RETURNING "id"`,
    [userId, options.name ?? 'Rent', options.amount ?? 1200],
  );
  const [instance] = await ds.query(
    `INSERT INTO "bill_instances"
       ("bill_id","user_id","due_date","amount","amount_paid","status")
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING "id"`,
    [
      bill.id,
      userId,
      options.dueDate,
      options.amount ?? 1200,
      options.amountPaid ?? 0,
      options.status ?? 'UNPAID',
    ],
  );
  return instance.id as string;
}

const kindsFor = async (userId: string): Promise<string[]> => {
  const rows = await ds.query(
    `SELECT "kind" FROM "notifications" WHERE "user_id" = $1 ORDER BY "kind"`,
    [userId],
  );
  return rows.map((r: { kind: string }) => r.kind);
};

describe('RemindersService.scan', () => {
  it('records a reminder three days out and one day out', async () => {
    const userId = await seedUser();
    const asOf = generator.today();
    await seedInstance(userId, { dueDate: addDays(asOf, 3), name: 'Rent' });
    await seedInstance(userId, { dueDate: addDays(asOf, 1), name: 'Electric' });

    const created = await reminders.scan();

    expect(created).toHaveLength(2);
    expect(await kindsFor(userId)).toEqual(['DUE_IN_3_DAYS', 'DUE_TOMORROW']);
  });

  it('ignores every other horizon', async () => {
    const userId = await seedUser();
    const asOf = generator.today();
    // The two offsets are exact. A bill two days out is between the two
    // reminders and gets neither; four days out has not reached the first.
    for (const offset of [-1, 0, 2, 4, 7]) {
      await seedInstance(userId, { dueDate: addDays(asOf, offset) });
    }

    expect(await reminders.scan()).toHaveLength(0);
    expect(await kindsFor(userId)).toEqual([]);
  });

  it('runs twice without producing a second reminder', async () => {
    const userId = await seedUser();
    await seedInstance(userId, { dueDate: addDays(generator.today(), 3) });

    const first = await reminders.scan();
    const before = await ds.query(
      `SELECT "id","created_at","read_at" FROM "notifications" WHERE "user_id" = $1`,
      [userId],
    );

    const second = await reminders.scan();
    const after = await ds.query(
      `SELECT "id","created_at","read_at" FROM "notifications" WHERE "user_id" = $1`,
      [userId],
    );

    expect(first).toHaveLength(1);
    // The second run must report nothing new — this is what makes the
    // bootstrap run of spec §4.5 safe to perform on every restart.
    expect(second).toHaveLength(0);
    expect(after).toHaveLength(1);
    // And must not disturb the existing row: a reset created_at would
    // reorder the list, a reset read_at would resurrect a dismissed one.
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].created_at).toEqual(before[0].created_at);
    expect(after[0].read_at).toBeNull();
  });

  it('skips a bill that is already paid in full', async () => {
    const userId = await seedUser();
    await seedInstance(userId, {
      dueDate: addDays(generator.today(), 1),
      status: 'PAID',
      amountPaid: 1200,
    });

    expect(await reminders.scan()).toHaveLength(0);
  });

  it('still reminds about a bill that is only partly paid', async () => {
    const userId = await seedUser();
    await seedInstance(userId, {
      dueDate: addDays(generator.today(), 1),
      status: 'PARTIALLY_PAID',
      amountPaid: 200,
    });

    // `status <> 'PAID'`, not `status = 'UNPAID'`: a partly paid bill
    // still has a balance and still earns the reminder.
    expect(await reminders.scan()).toHaveLength(1);
  });

  it('records nothing for a user who has turned both channels off', async () => {
    const quiet = await seedUser({ notifyEmail: false, notifyInApp: false });
    await seedInstance(quiet, { dueDate: addDays(generator.today(), 1) });

    expect(await reminders.scan()).toHaveLength(0);
    expect(await kindsFor(quiet)).toEqual([]);
  });

  it('records for a user with only one channel on', async () => {
    const emailOnly = await seedUser({ notifyEmail: true, notifyInApp: false });
    const inAppOnly = await seedUser({ notifyEmail: false, notifyInApp: true });
    const asOf = addDays(generator.today(), 1);
    await seedInstance(emailOnly, { dueDate: asOf });
    await seedInstance(inAppOnly, { dueDate: asOf });

    // Within a user who wants *something*, rows are always written; each
    // channel consults its own toggle at delivery time (spec §4.3). That
    // is what keeps the dedupe ledger free of holes.
    expect(await reminders.scan()).toHaveLength(2);
    expect(await kindsFor(emailOnly)).toEqual(['DUE_TOMORROW']);
    expect(await kindsFor(inAppOnly)).toEqual(['DUE_TOMORROW']);
  });

  it('never attributes one user a reminder for another user\'s bill', async () => {
    const mine = await seedUser();
    const theirs = await seedUser();
    const due = addDays(generator.today(), 3);
    await seedInstance(mine, { dueDate: due, name: 'Mine' });
    await seedInstance(theirs, { dueDate: due, name: 'Theirs' });

    const created = await reminders.scan();

    expect(created).toHaveLength(2);
    const owners = new Set(created.map((c) => c.userId));
    expect(owners).toEqual(new Set([mine, theirs]));
    expect(await kindsFor(mine)).toEqual(['DUE_IN_3_DAYS']);
    expect(await kindsFor(theirs)).toEqual(['DUE_IN_3_DAYS']);
  });

  it('records both kinds for one instance when it crosses both horizons', async () => {
    // Not reachable in a single run — one date cannot be both +3 and +1 —
    // but reachable across two days, and the list and the mark-read
    // endpoints must treat them as two independent reminders.
    const userId = await seedUser();
    const instanceId = await seedInstance(userId, { dueDate: addDays(generator.today(), 3) });
    await reminders.scan();
    await ds.query(`UPDATE "bill_instances" SET "due_date" = $1 WHERE "id" = $2`, [
      addDays(generator.today(), 1),
      instanceId,
    ]);

    await reminders.scan();

    expect(await kindsFor(userId)).toEqual(['DUE_IN_3_DAYS', 'DUE_TOMORROW']);
  });
});
