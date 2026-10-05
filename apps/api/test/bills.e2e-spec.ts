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

const makeBill = (overrides: Record<string, unknown> = {}) => ({
  name: 'Rent',
  defaultAmount: 1800,
  frequency: 'MONTHLY',
  startDate: '2026-01-01',
  ...overrides,
});

describe('POST /api/bills', () => {
  it('creates a template and materializes its instances immediately', async () => {
    const { token } = await registerAs('a@example.com');
    const res = await request(app.getHttpServer())
      .post('/api/bills').set('Authorization', `Bearer ${token}`)
      .send(makeBill()).expect(201);

    expect(res.body).toMatchObject({
      name: 'Rent', defaultAmount: 1800, frequency: 'MONTHLY',
      startDate: '2026-01-01', endDate: null, isActive: true, categoryId: null,
    });
    expect(typeof res.body.defaultAmount).toBe('number'); // not "1800.00"
    expect(res.body.id).toMatch(/^[0-9a-f-]{36}$/);

    const count = await ds.query(
      'SELECT count(*)::int AS n FROM bill_instances WHERE bill_id = $1', [res.body.id],
    );
    expect(count[0].n).toBeGreaterThan(0);
  });

  it('accepts a bill starting beyond the horizon, with no instances yet', async () => {
    const { token } = await registerAs('a@example.com');
    const res = await request(app.getHttpServer())
      .post('/api/bills').set('Authorization', `Bearer ${token}`)
      .send(makeBill({ startDate: '2099-01-01' })).expect(201);
    const count = await ds.query(
      'SELECT count(*)::int AS n FROM bill_instances WHERE bill_id = $1', [res.body.id],
    );
    expect(count[0].n).toBe(0);
  });

  it('attaches a category the user owns', async () => {
    const { token } = await registerAs('a@example.com');
    const cats = await request(app.getHttpServer())
      .get('/api/categories').set('Authorization', `Bearer ${token}`).expect(200);
    const res = await request(app.getHttpServer())
      .post('/api/bills').set('Authorization', `Bearer ${token}`)
      .send(makeBill({ categoryId: cats.body[0].id })).expect(201);
    expect(res.body.categoryId).toBe(cats.body[0].id);
  });

  it('rejects a category belonging to another user and does not attach it', async () => {
    // Review Focus 3: an ownership leak wearing the costume of plain validation.
    const { token: mine } = await registerAs('a@example.com');
    const { token: theirs } = await registerAs('b@example.com');
    const theirCats = await request(app.getHttpServer())
      .get('/api/categories').set('Authorization', `Bearer ${theirs}`).expect(200);

    await request(app.getHttpServer())
      .post('/api/bills').set('Authorization', `Bearer ${mine}`)
      .send(makeBill({ categoryId: theirCats.body[0].id })).expect(400);

    const mineList = await request(app.getHttpServer())
      .get('/api/bills').set('Authorization', `Bearer ${mine}`).expect(200);
    expect(mineList.body).toHaveLength(0);
  });

  it('rejects malformed input with a 400', async () => {
    const { token } = await registerAs('a@example.com');
    const post = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post('/api/bills').set('Authorization', `Bearer ${token}`).send(body).expect(400);

    await post(makeBill({ defaultAmount: 0 }));
    await post(makeBill({ defaultAmount: -5 }));
    await post(makeBill({ defaultAmount: '1800.00' }));   // Review Focus 5
    await post(makeBill({ defaultAmount: 142.005 }));     // Review Focus 5
    await post(makeBill({ frequency: 'FORTNIGHTLY' }));
    await post(makeBill({ startDate: '2026-02-31' }));    // Review Focus 1
    await post(makeBill({ startDate: 'lastweek' }));
    await post(makeBill({ name: '' }));
    await post(makeBill({ name: 'x'.repeat(101) }));
    await post(makeBill({ endDate: '2025-12-31' }));      // before startDate
  });

  it('requires a token', async () => {
    await request(app.getHttpServer()).post('/api/bills').send(makeBill()).expect(401);
  });

  it('ignores a client-supplied isActive and always creates an active, materialized bill', async () => {
    // Regression for Finding 1: isActive is not on CreateBillRequest. If the
    // DTO ever re-admits it, `whitelist: true` would keep it and a client
    // could create a bill with zero materialized instances.
    const { token } = await registerAs('a@example.com');
    const res = await request(app.getHttpServer())
      .post('/api/bills').set('Authorization', `Bearer ${token}`)
      .send(makeBill({ isActive: false })).expect(201);
    expect(res.body.isActive).toBe(true);

    const count = await ds.query(
      'SELECT count(*)::int AS n FROM bill_instances WHERE bill_id = $1', [res.body.id],
    );
    expect(count[0].n).toBeGreaterThan(0);
  });
});

describe('GET /api/bills', () => {
  it("lists only the caller's own bills", async () => {
    const { token: mine } = await registerAs('a@example.com');
    const { token: theirs } = await registerAs('b@example.com');
    await request(app.getHttpServer()).post('/api/bills')
      .set('Authorization', `Bearer ${mine}`).send(makeBill({ name: 'Mine' })).expect(201);
    await request(app.getHttpServer()).post('/api/bills')
      .set('Authorization', `Bearer ${theirs}`).send(makeBill({ name: 'Theirs' })).expect(201);

    const res = await request(app.getHttpServer())
      .get('/api/bills').set('Authorization', `Bearer ${mine}`).expect(200);
    expect(res.body.map((b: { name: string }) => b.name)).toEqual(['Mine']);
  });

  it('filters by isActive', async () => {
    // POST can no longer create an inactive bill (Finding 1), so the
    // inactive fixture is inserted directly.
    const { token, userId } = await registerAs('a@example.com');
    await request(app.getHttpServer()).post('/api/bills')
      .set('Authorization', `Bearer ${token}`).send(makeBill({ name: 'Active' })).expect(201);
    await ds.query(
      `INSERT INTO bills (user_id, name, default_amount, frequency, start_date, is_active)
       VALUES ($1, $2, $3, $4, $5, false)`,
      [userId, 'Inactive', 50, 'MONTHLY', '2026-01-01'],
    );

    const onlyActive = await request(app.getHttpServer())
      .get('/api/bills?isActive=true').set('Authorization', `Bearer ${token}`).expect(200);
    expect(onlyActive.body.map((b: { name: string }) => b.name)).toEqual(['Active']);

    const onlyInactive = await request(app.getHttpServer())
      .get('/api/bills?isActive=false').set('Authorization', `Bearer ${token}`).expect(200);
    expect(onlyInactive.body.map((b: { name: string }) => b.name)).toEqual(['Inactive']);
  });
});

describe('GET /api/bills/:id', () => {
  it("returns 404 for another user's bill rather than 403", async () => {
    const { token: mine } = await registerAs('a@example.com');
    const { token: theirs } = await registerAs('b@example.com');
    const theirBill = await request(app.getHttpServer()).post('/api/bills')
      .set('Authorization', `Bearer ${theirs}`).send(makeBill()).expect(201);

    const res = await request(app.getHttpServer())
      .get(`/api/bills/${theirBill.body.id}`)
      .set('Authorization', `Bearer ${mine}`).expect(404);
    expect(JSON.stringify(res.body)).not.toContain('Rent');
  });

  it('returns 400 for an id that is not a uuid', async () => {
    const { token } = await registerAs('a@example.com');
    await request(app.getHttpServer())
      .get('/api/bills/not-a-uuid').set('Authorization', `Bearer ${token}`).expect(400);
  });
});

describe('DELETE /api/bills/:id', () => {
  it('cascades through instances and payment logs', async () => {
    const { token } = await registerAs('a@example.com');
    const bill = await request(app.getHttpServer()).post('/api/bills')
      .set('Authorization', `Bearer ${token}`).send(makeBill()).expect(201);

    await request(app.getHttpServer())
      .delete(`/api/bills/${bill.body.id}`)
      .set('Authorization', `Bearer ${token}`).expect(204);

    const left = await ds.query(
      'SELECT count(*)::int AS n FROM bill_instances WHERE bill_id = $1', [bill.body.id],
    );
    expect(left[0].n).toBe(0);
    await request(app.getHttpServer())
      .get(`/api/bills/${bill.body.id}`).set('Authorization', `Bearer ${token}`).expect(404);
  });

  it("returns 404 for another user's bill and leaves it intact", async () => {
    const { token: mine } = await registerAs('a@example.com');
    const { token: theirs } = await registerAs('b@example.com');
    const theirBill = await request(app.getHttpServer()).post('/api/bills')
      .set('Authorization', `Bearer ${theirs}`).send(makeBill()).expect(201);

    await request(app.getHttpServer())
      .delete(`/api/bills/${theirBill.body.id}`)
      .set('Authorization', `Bearer ${mine}`).expect(404);

    await request(app.getHttpServer())
      .get(`/api/bills/${theirBill.body.id}`)
      .set('Authorization', `Bearer ${theirs}`).expect(200);
  });
});

describe('PATCH /api/bills/:id', () => {
  it('updates the template and reports the new values', async () => {
    const { token } = await registerAs('a@example.com');
    const bill = await request(app.getHttpServer()).post('/api/bills')
      .set('Authorization', `Bearer ${token}`).send(makeBill()).expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/api/bills/${bill.body.id}`).set('Authorization', `Bearer ${token}`)
      .send({ defaultAmount: 1950, name: 'Rent (raised)' }).expect(200);

    expect(res.body).toMatchObject({ name: 'Rent (raised)', defaultAmount: 1950 });
    expect(typeof res.body.defaultAmount).toBe('number');
  });

  it("returns 404 for another user's bill", async () => {
    const { token: mine } = await registerAs('a@example.com');
    const { token: theirs } = await registerAs('b@example.com');
    const theirBill = await request(app.getHttpServer()).post('/api/bills')
      .set('Authorization', `Bearer ${theirs}`).send(makeBill()).expect(201);

    await request(app.getHttpServer())
      .patch(`/api/bills/${theirBill.body.id}`).set('Authorization', `Bearer ${mine}`)
      .send({ defaultAmount: 1 }).expect(404);

    const unchanged = await request(app.getHttpServer())
      .get(`/api/bills/${theirBill.body.id}`)
      .set('Authorization', `Bearer ${theirs}`).expect(200);
    expect(unchanged.body.defaultAmount).toBe(1800);
  });

  it('rejects an endDate earlier than the existing startDate', async () => {
    const { token } = await registerAs('a@example.com');
    const bill = await request(app.getHttpServer()).post('/api/bills')
      .set('Authorization', `Bearer ${token}`).send(makeBill()).expect(201);
    await request(app.getHttpServer())
      .patch(`/api/bills/${bill.body.id}`).set('Authorization', `Bearer ${token}`)
      .send({ endDate: '2025-01-01' }).expect(400);
  });
});
