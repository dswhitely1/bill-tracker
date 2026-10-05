import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => {
  vi.restoreAllMocks();
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

describe('categories', () => {
  it('lists the four seeded defaults for a new user', async () => {
    const { token } = await registerAs('a@example.com');
    const res = await request(app.getHttpServer())
      .get('/api/categories').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body).toHaveLength(4);
    expect(new Set(res.body.map((c: { name: string }) => c.name))).toEqual(
      new Set(['Utilities', 'Subscriptions', 'Housing', 'Credit Cards']),
    );
  });

  it('creates a category with a colour', async () => {
    const { token } = await registerAs('a@example.com');
    const res = await request(app.getHttpServer())
      .post('/api/categories').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Insurance', color: '#2f80ed' }).expect(201);
    expect(res.body.name).toBe('Insurance');
    expect(res.body.color).toBe('#2f80ed');
  });

  it('returns 409 for a duplicate name differing only in case', async () => {
    const { token } = await registerAs('a@example.com');
    await request(app.getHttpServer())
      .post('/api/categories').set('Authorization', `Bearer ${token}`)
      .send({ name: 'utilities' }).expect(409);
  });

  it('rejects a malformed colour', async () => {
    const { token } = await registerAs('a@example.com');
    await request(app.getHttpServer())
      .post('/api/categories').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Pets', color: 'red' }).expect(400);
  });

  it('returns 400 for a name longer than its column', async () => {
    const { token } = await registerAs('a@example.com');
    await request(app.getHttpServer())
      .post('/api/categories').set('Authorization', `Bearer ${token}`)
      .send({ name: 'x'.repeat(200) }).expect(400);
  });

  it('never exposes another user’s category', async () => {
    const alice = await registerAs('alice@example.com');
    const bob = await registerAs('bob@example.com');

    const created = await request(app.getHttpServer())
      .post('/api/categories').set('Authorization', `Bearer ${alice.token}`)
      .send({ name: 'Alice Only' }).expect(201);

    await request(app.getHttpServer())
      .get('/api/categories').set('Authorization', `Bearer ${bob.token}`)
      .expect(200)
      .then((res) => {
        expect(res.body.map((c: { name: string }) => c.name)).not.toContain('Alice Only');
      });

    await request(app.getHttpServer())
      .patch(`/api/categories/${created.body.id}`)
      .set('Authorization', `Bearer ${bob.token}`).send({ name: 'Stolen' }).expect(404);

    await request(app.getHttpServer())
      .delete(`/api/categories/${created.body.id}`)
      .set('Authorization', `Bearer ${bob.token}`).expect(404);

    const rows = await ds.query('SELECT name, user_id FROM categories WHERE id = $1', [
      created.body.id,
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe('Alice Only');
    expect(rows[0].user_id).toBe(alice.userId);
  });

  it('rejects a non-uuid id with 400 rather than a database error', async () => {
    const { token } = await registerAs('a@example.com');
    await request(app.getHttpServer())
      .delete('/api/categories/not-a-uuid').set('Authorization', `Bearer ${token}`).expect(400);
  });

  it('updates the caller’s own category', async () => {
    const { token } = await registerAs('a@example.com');
    const created = await request(app.getHttpServer())
      .post('/api/categories').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Groceries', color: '#2f80ed' }).expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/api/categories/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Food', color: '#ff0000' })
      .expect(200);

    expect(res.body.id).toBe(created.body.id);
    expect(res.body.name).toBe('Food');
    expect(res.body.color).toBe('#ff0000');

    // The change actually persisted — a service that returned 404 for every
    // PATCH would never reach this test, but one that accepted any body
    // without writing it would still pass an assertion on the response
    // alone.
    const rows = await ds.query('SELECT name, color FROM categories WHERE id = $1', [
      created.body.id,
    ]);
    expect(rows[0].name).toBe('Food');
    expect(rows[0].color).toBe('#ff0000');
  });

  it('deletes the caller’s own category', async () => {
    const { token } = await registerAs('a@example.com');
    const created = await request(app.getHttpServer())
      .post('/api/categories').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Temporary' }).expect(201);

    await request(app.getHttpServer())
      .delete(`/api/categories/${created.body.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(204);

    const res = await request(app.getHttpServer())
      .get('/api/categories').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body.map((c: { id: string }) => c.id)).not.toContain(created.body.id);

    const rows = await ds.query('SELECT 1 FROM categories WHERE id = $1', [created.body.id]);
    expect(rows).toHaveLength(0);
  });
});

describe('DELETE /api/categories/:id with bills attached', () => {
  const makeBill = (categoryId: string) => ({
    name: 'Rent', defaultAmount: 1800, frequency: 'MONTHLY',
    startDate: '2026-01-01', categoryId,
  });

  it('409s and names how many bills reference it', async () => {
    const { token } = await registerAs('a@example.com');
    const cats = await request(app.getHttpServer())
      .get('/api/categories').set('Authorization', `Bearer ${token}`).expect(200);
    const categoryId = cats.body[0].id as string;

    await request(app.getHttpServer()).post('/api/bills')
      .set('Authorization', `Bearer ${token}`).send(makeBill(categoryId)).expect(201);

    const res = await request(app.getHttpServer())
      .delete(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${token}`).expect(409);
    expect(JSON.stringify(res.body)).toContain('1');

    // Still there.
    const after = await request(app.getHttpServer())
      .get('/api/categories').set('Authorization', `Bearer ${token}`).expect(200);
    expect(after.body.map((c: { id: string }) => c.id)).toContain(categoryId);
  });

  it('deletes once the last bill referencing it is gone', async () => {
    const { token } = await registerAs('a@example.com');
    const cats = await request(app.getHttpServer())
      .get('/api/categories').set('Authorization', `Bearer ${token}`).expect(200);
    const categoryId = cats.body[0].id as string;
    const bill = await request(app.getHttpServer()).post('/api/bills')
      .set('Authorization', `Bearer ${token}`).send(makeBill(categoryId)).expect(201);

    await request(app.getHttpServer())
      .delete(`/api/bills/${bill.body.id}`)
      .set('Authorization', `Bearer ${token}`).expect(204);
    await request(app.getHttpServer())
      .delete(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${token}`).expect(204);
  });

  it("ignores another user's bills when counting", async () => {
    // The count must be scoped to the owner, or user B's bill would make
    // user A's category undeletable — leaking that B's data exists at all.
    //
    // No API path can set this up: Task 6 validates categoryId against the
    // caller's own categories on both create and update, so a bill owned
    // by B can never legitimately reference a category owned by A. The
    // row is inserted directly via raw SQL, bypassing the service, because
    // the count predicate must stay correct regardless of how such a row
    // came to exist — the same deliberately-unreachable-state pattern used
    // for Task 7's paidZeroBalance/unpaidWithBalance fixtures and Task 10's
    // database-constraint tests. Without the `userId` filter in the
    // service's count, this bill would make A's category undeletable.
    const a = await registerAs('a@example.com');
    const b = await registerAs('b@example.com');
    const cats = await request(app.getHttpServer())
      .get('/api/categories').set('Authorization', `Bearer ${a.token}`).expect(200);
    const categoryId = cats.body[0].id as string;

    await ds.query(
      `INSERT INTO bills
         (user_id, category_id, name, default_amount, frequency, start_date)
       VALUES ($1, $2, 'Cross-user Rent', 1800, 'MONTHLY', '2026-01-01')`,
      [b.userId, categoryId],
    );

    await request(app.getHttpServer())
      .delete(`/api/categories/${categoryId}`)
      .set('Authorization', `Bearer ${a.token}`).expect(204);
  });
});
