import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app/app.module';
import { configureApp } from '../src/app/configure-app';
import type { Env } from '../src/config/env.schema';
import { getTestDataSource, truncateAll } from './db';

let app: INestApplication;
let ds: DataSource;

beforeAll(async () => {
  process.env.ENV_FILE = '.env.test';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app, app.get(ConfigService<Env, true>));
  await app.init();
  ds = await getTestDataSource();
});

beforeEach(async () => {
  await truncateAll(ds);
});

afterAll(async () => {
  await app?.close();
  if (ds?.isInitialized) await ds.destroy();
});

async function registerAs(email: string): Promise<{ token: string; userId: string }> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, name: 'Test User', password: 'hunter22' })
    .expect(201);
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

interface SeedOptions {
  kind?: 'DUE_IN_3_DAYS' | 'DUE_TOMORROW';
  dueDate?: string;
  amount?: number;
  amountPaid?: number;
  status?: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  billName?: string;
  readAt?: string | null;
}

/**
 * Inserts one notification and the bill it points at. Deliberately not a
 * call to RemindersService: this suite is about the read endpoints, and
 * driving them through the scan would couple it to today's date.
 */
async function seedNotification(
  userId: string,
  options: SeedOptions = {},
): Promise<{ id: string; billId: string; instanceId: string }> {
  const [bill] = await ds.query(
    `INSERT INTO "bills" ("user_id","name","default_amount","frequency","start_date")
     VALUES ($1,$2,$3,'MONTHLY','2026-01-01') RETURNING "id"`,
    [userId, options.billName ?? 'Rent', options.amount ?? 1200],
  );
  const [instance] = await ds.query(
    `INSERT INTO "bill_instances"
       ("bill_id","user_id","due_date","amount","amount_paid","status")
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING "id"`,
    [
      bill.id,
      userId,
      options.dueDate ?? '2026-11-01',
      options.amount ?? 1200,
      options.amountPaid ?? 0,
      options.status ?? 'UNPAID',
    ],
  );
  const [notification] = await ds.query(
    `INSERT INTO "notifications" ("user_id","bill_instance_id","kind","read_at")
     VALUES ($1,$2,$3,$4) RETURNING "id"`,
    [userId, instance.id, options.kind ?? 'DUE_IN_3_DAYS', options.readAt ?? null],
  );
  return { id: notification.id as string, billId: bill.id as string, instanceId: instance.id as string };
}

const list = (token: string) =>
  request(app.getHttpServer()).get('/api/notifications').set('Authorization', `Bearer ${token}`);

describe('GET /api/notifications', () => {
  it('refuses an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/api/notifications').expect(401);
  });

  it('returns an empty list and a zero count for a new account', async () => {
    const { token } = await registerAs('a@example.com');

    const res = await list(token).expect(200);

    // Never null items and never a null count: COUNT over zero rows
    // returns NULL from a bare aggregate, and the client does arithmetic
    // on this number.
    expect(res.body).toEqual({ items: [], unreadCount: 0, truncated: false });
  });

  it('joins the bill name, due date, and outstanding balance', async () => {
    const { token, userId } = await registerAs('a@example.com');
    await seedNotification(userId, {
      billName: 'Electric',
      dueDate: '2026-11-05',
      amount: 120,
      amountPaid: 20,
      status: 'PARTIALLY_PAID',
      kind: 'DUE_TOMORROW',
    });

    const res = await list(token).expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      kind: 'DUE_TOMORROW',
      isRead: false,
      billName: 'Electric',
      dueDate: '2026-11-05',
      amountDue: 100,
      isResolved: false,
    });
    // A number, not the string node-postgres returns for `numeric`.
    expect(typeof res.body.items[0].amountDue).toBe('number');
    expect(res.body.unreadCount).toBe(1);
  });

  it('keeps a due date a calendar day rather than an instant', async () => {
    const { token, userId } = await registerAs('a@example.com');
    await seedNotification(userId, { dueDate: '2026-11-05' });

    const res = await list(token).expect(200);

    expect(res.body.items[0].dueDate).toBe('2026-11-05');
  });

  it('returns only the caller\'s notifications', async () => {
    const mine = await registerAs('mine@example.com');
    const theirs = await registerAs('theirs@example.com');
    await seedNotification(mine.userId, { billName: 'Mine' });
    await seedNotification(theirs.userId, { billName: 'Theirs' });
    await seedNotification(theirs.userId, { billName: 'Theirs Two' });

    const res = await list(mine.token).expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].billName).toBe('Mine');
    expect(res.body.unreadCount).toBe(1);
  });

  it('counts unread over the whole table, not the returned page', async () => {
    const { token, userId } = await registerAs('a@example.com');
    for (let i = 0; i < 205; i += 1) {
      await seedNotification(userId, { billName: `Bill ${i}` });
    }

    const res = await list(token).expect(200);

    expect(res.body.items).toHaveLength(200);
    expect(res.body.unreadCount).toBe(205);
    expect(res.body.truncated).toBe(true);
  });

  it('does not claim truncation at exactly the cap', async () => {
    const { token, userId } = await registerAs('a@example.com');
    for (let i = 0; i < 200; i += 1) {
      await seedNotification(userId, { billName: `Bill ${i}` });
    }

    const res = await list(token).expect(200);

    expect(res.body.items).toHaveLength(200);
    expect(res.body.truncated).toBe(false);
  });

  it('excludes a resolved notification from the unread count', async () => {
    const { token, userId } = await registerAs('a@example.com');
    await seedNotification(userId, { billName: 'Paid Rent', status: 'PAID', amountPaid: 1200 });
    await seedNotification(userId, { billName: 'Unpaid Power' });

    const res = await list(token).expect(200);

    // The paid reminder stays in the list as history, but a badge that
    // counts a bill you have already paid is a number that means nothing.
    expect(res.body.items).toHaveLength(2);
    expect(res.body.unreadCount).toBe(1);
    const resolved = res.body.items.find(
      (i: { billName: string }) => i.billName === 'Paid Rent',
    );
    expect(resolved.isResolved).toBe(true);
    expect(resolved.amountDue).toBe(0);
  });

  it('orders newest first', async () => {
    const { token, userId } = await registerAs('a@example.com');
    const first = await seedNotification(userId, { billName: 'Older' });
    await ds.query(
      `UPDATE "notifications" SET "created_at" = now() - interval '1 day' WHERE "id" = $1`,
      [first.id],
    );
    await seedNotification(userId, { billName: 'Newer' });

    const res = await list(token).expect(200);

    expect(res.body.items.map((i: { billName: string }) => i.billName)).toEqual([
      'Newer',
      'Older',
    ]);
  });
});

describe('POST /api/notifications/:id/read', () => {
  const markRead = (token: string, id: string) =>
    request(app.getHttpServer())
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${token}`);

  it('refuses an unauthenticated request', async () => {
    const { userId } = await registerAs('a@example.com');
    const { id } = await seedNotification(userId);
    await request(app.getHttpServer()).post(`/api/notifications/${id}/read`).expect(401);
  });

  it('marks one read and drops the unread count', async () => {
    const { token, userId } = await registerAs('a@example.com');
    const { id } = await seedNotification(userId);

    await markRead(token, id).expect(200);

    const res = await list(token).expect(200);
    expect(res.body.items[0].isRead).toBe(true);
    expect(res.body.unreadCount).toBe(0);
  });

  it('is idempotent and keeps the first read instant', async () => {
    const { token, userId } = await registerAs('a@example.com');
    const { id } = await seedNotification(userId);

    await markRead(token, id).expect(200);
    const [before] = await ds.query(`SELECT "read_at" FROM "notifications" WHERE "id" = $1`, [id]);
    await markRead(token, id).expect(200);
    const [after] = await ds.query(`SELECT "read_at" FROM "notifications" WHERE "id" = $1`, [id]);

    expect(after.read_at).toEqual(before.read_at);
  });

  it('does not touch the other kind for the same bill', async () => {
    const { token, userId } = await registerAs('a@example.com');
    const seeded = await seedNotification(userId, { kind: 'DUE_IN_3_DAYS' });
    const [other] = await ds.query(
      `INSERT INTO "notifications" ("user_id","bill_instance_id","kind")
       VALUES ($1,$2,'DUE_TOMORROW') RETURNING "id"`,
      [userId, seeded.instanceId],
    );

    await markRead(token, seeded.id).expect(200);

    const res = await list(token).expect(200);
    const stillUnread = res.body.items.find((i: { id: string }) => i.id === other.id);
    expect(stillUnread.isRead).toBe(false);
    expect(res.body.unreadCount).toBe(1);
  });

  it('is a 404 for another user\'s notification, and leaves it unread', async () => {
    const mine = await registerAs('mine@example.com');
    const theirs = await registerAs('theirs@example.com');
    const { id } = await seedNotification(theirs.userId);

    await markRead(mine.token, id).expect(404);

    const [row] = await ds.query(`SELECT "read_at" FROM "notifications" WHERE "id" = $1`, [id]);
    expect(row.read_at).toBeNull();
  });

  it('is a 404 for an id that does not exist', async () => {
    const { token } = await registerAs('a@example.com');
    // oxlint's vitest/expect-expect only recognises assertions chained
    // directly off an identifier literally named `request`, not off the
    // local `markRead` wrapper above — this makes the check visible to
    // it without weakening what the test already verified via `.expect()`.
    const res = await markRead(token, '00000000-0000-4000-8000-000000000000').expect(404);
    expect(res.status).toBe(404);
  });

  it('is a 400 for an id that is not a UUID', async () => {
    const { token } = await registerAs('a@example.com');
    // ParseUUIDPipe, not Postgres rejecting the cast with a 500.
    const res = await markRead(token, 'not-a-uuid').expect(400);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/notifications/read-all', () => {
  const readAll = (token: string) =>
    request(app.getHttpServer())
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token}`);

  it('refuses an unauthenticated request', async () => {
    await request(app.getHttpServer()).post('/api/notifications/read-all').expect(401);
  });

  it('clears every unread notification and reports how many', async () => {
    const { token, userId } = await registerAs('a@example.com');
    await seedNotification(userId, { billName: 'One' });
    await seedNotification(userId, { billName: 'Two' });
    const read = await seedNotification(userId, { billName: 'Three' });
    await ds.query(`UPDATE "notifications" SET "read_at" = now() WHERE "id" = $1`, [read.id]);

    const res = await readAll(token).expect(200);

    // Two, not three: the already-read one is not updated again.
    expect(res.body).toEqual({ updated: 2 });
    expect((await list(token).expect(200)).body.unreadCount).toBe(0);
  });

  it('affects no other user', async () => {
    const mine = await registerAs('mine@example.com');
    const theirs = await registerAs('theirs@example.com');
    await seedNotification(mine.userId);
    await seedNotification(theirs.userId);

    await readAll(mine.token).expect(200);

    expect((await list(theirs.token).expect(200)).body.unreadCount).toBe(1);
  });

  it('reports zero for an account with nothing unread', async () => {
    const { token } = await registerAs('a@example.com');
    const res = await readAll(token).expect(200);
    expect(res.body).toEqual({ updated: 0 });
  });
});
