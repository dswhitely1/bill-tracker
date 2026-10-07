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

async function registerAs(email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, name: 'Test User', password: 'hunter22' })
    .expect(201);
  return res.body.accessToken as string;
}

async function createBill(token: string, name: string, amount: number): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);
  const res = await request(app.getHttpServer())
    .post('/api/bills')
    .set('Authorization', `Bearer ${token}`)
    .send({ name, defaultAmount: amount, frequency: 'MONTHLY', startDate: today })
    .expect(201);
  return res.body.id as string;
}

function getSummary(token: string) {
  return request(app.getHttpServer())
    .get('/api/summary')
    .set('Authorization', `Bearer ${token}`);
}

describe('GET /api/summary', () => {
  it('refuses an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/api/summary').expect(401);
  });

  it('returns all-zero figures for an account with no bills', async () => {
    const token = await registerAs('a@example.com');

    const res = await getSummary(token).expect(200);

    expect(res.body.overdue).toEqual({ count: 0, amount: 0, earliestDueDate: null });
    expect(res.body.next7Days).toEqual({ count: 0, amount: 0 });
    expect(res.body.thisMonth).toEqual({ count: 0, total: 0, paid: 0 });
    expect(res.body.byCategory).toEqual([]);
    expect(res.body.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('serializes every figure as a number, never a numeric string', async () => {
    const token = await registerAs('a@example.com');
    await createBill(token, 'Rent', 1200);

    const res = await getSummary(token).expect(200);

    // `numeric` and `bigint` both arrive from node-postgres as strings and
    // bypass the entity transformer on a raw query. Without the explicit
    // Number() in the mapper these assertions fail on `"1200.00"`.
    for (const value of [
      res.body.overdue.count, res.body.overdue.amount,
      res.body.next7Days.count, res.body.next7Days.amount,
      res.body.thisMonth.count, res.body.thisMonth.total, res.body.thisMonth.paid,
    ]) {
      expect(typeof value).toBe('number');
    }
    for (const row of res.body.byCategory) {
      expect(typeof row.total).toBe('number');
      expect(typeof row.paid).toBe('number');
    }
  });

  it('never counts another user’s bills', async () => {
    const mine = await registerAs('mine@example.com');
    const theirs = await registerAs('theirs@example.com');
    await createBill(theirs, 'Their Mortgage', 5000);

    const res = await getSummary(mine).expect(200);

    expect(res.body.thisMonth.count).toBe(0);
    expect(res.body.thisMonth.total).toBe(0);
    expect(res.body.byCategory).toEqual([]);
  });

  it('counts this month’s obligation and moves it to paid once settled', async () => {
    const token = await registerAs('a@example.com');
    await createBill(token, 'Rent', 1200);

    const before = await getSummary(token).expect(200);
    expect(before.body.thisMonth.total).toBe(1200);
    expect(before.body.thisMonth.paid).toBe(0);

    const today = new Date().toISOString().slice(0, 10);
    const list = await request(app.getHttpServer())
      .get('/api/bill-instances')
      .query({ from: today.slice(0, 8) + '01', to: today })
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const instanceId = list.body[0].id as string;

    await request(app.getHttpServer())
      .post(`/api/bill-instances/${instanceId}/payments`)
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);

    const after = await getSummary(token).expect(200);
    expect(after.body.thisMonth.paid).toBe(1200);
    expect(after.body.overdue.amount).toBe(0);
    expect(after.body.next7Days.amount).toBe(0);
  });
});
