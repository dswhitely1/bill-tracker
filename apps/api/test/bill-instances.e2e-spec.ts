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
  name: 'Rent', defaultAmount: 1800, frequency: 'MONTHLY', startDate: '2026-01-01',
  ...overrides,
});

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

/** Returns the token plus the created bill's id. */
async function setup(email: string, overrides: Record<string, unknown> = {}) {
  const { token } = await registerAs(email);
  const bill = await request(app.getHttpServer())
    .post('/api/bills').set(auth(token)).send(makeBill(overrides)).expect(201);
  return { token, billId: bill.body.id as string };
}

/**
 * The earliest instance of the caller's bills. Declared at module scope,
 * not inside a describe: Tasks 9 and 10 import this helper.
 */
async function firstInstance(token: string): Promise<{ id: string; amount: number }> {
  const res = await request(app.getHttpServer())
    .get('/api/bill-instances?from=2026-01-01&to=2026-12-31').set(auth(token)).expect(200);
  return res.body[0] as { id: string; amount: number };
}

describe('GET /api/bill-instances', () => {
  it('returns instances in the range, ascending, with derived fields', async () => {
    const { token, billId } = await setup('a@example.com');
    const res = await request(app.getHttpServer())
      .get('/api/bill-instances?from=2026-01-01&to=2026-12-31')
      .set(auth(token)).expect(200);

    expect(res.body.length).toBeGreaterThan(0);
    const dates = res.body.map((i: { dueDate: string }) => i.dueDate);
    expect([...dates].sort()).toEqual(dates);
    expect(res.body[0]).toMatchObject({
      billId, billName: 'Rent', amount: 1800, amountPaid: 0,
      status: 'UNPAID', isCustomized: false, paidAt: null, note: null,
    });
    // Review Focus 2: money must not arrive as a string.
    expect(typeof res.body[0].amount).toBe('number');
    expect(typeof res.body[0].amountPaid).toBe('number');
    expect(typeof res.body[0].isOverdue).toBe('boolean');
  });

  it('honours the range bounds inclusively', async () => {
    const { token } = await setup('a@example.com');
    const res = await request(app.getHttpServer())
      .get('/api/bill-instances?from=2027-01-01&to=2027-03-31').set(auth(token)).expect(200);
    expect(res.body.every((i: { dueDate: string }) =>
      i.dueDate >= '2027-01-01' && i.dueDate <= '2027-03-31')).toBe(true);
  });

  it('filters by status, billId, and overdue', async () => {
    const { token, billId } = await setup('a@example.com');
    const byStatus = await request(app.getHttpServer())
      .get('/api/bill-instances?from=2026-01-01&to=2026-12-31&status=UNPAID')
      .set(auth(token)).expect(200);
    expect(byStatus.body.every((i: { status: string }) => i.status === 'UNPAID')).toBe(true);

    const byBill = await request(app.getHttpServer())
      .get(`/api/bill-instances?from=2026-01-01&to=2026-12-31&billId=${billId}`)
      .set(auth(token)).expect(200);
    expect(byBill.body.every((i: { billId: string }) => i.billId === billId)).toBe(true);

    const overdue = await request(app.getHttpServer())
      .get('/api/bill-instances?from=2026-01-01&to=2026-12-31&overdue=true')
      .set(auth(token)).expect(200);
    expect(overdue.body.every((i: { isOverdue: boolean }) => i.isOverdue === true)).toBe(true);

    const notOverdue = await request(app.getHttpServer())
      .get('/api/bill-instances?from=2026-01-01&to=2026-12-31&overdue=false')
      .set(auth(token)).expect(200);
    expect(notOverdue.body.every((i: { isOverdue: boolean }) => i.isOverdue === false))
      .toBe(true);
    expect(overdue.body.length + notOverdue.body.length).toBe(
      (await request(app.getHttpServer())
        .get('/api/bill-instances?from=2026-01-01&to=2026-12-31').set(auth(token))).body.length,
    );
  });

  it('rejects a missing, malformed, or impossible range with a 400', async () => {
    // Review Focus 1: none of these may reach PostgreSQL's date parser.
    const { token } = await setup('a@example.com');
    const bad = (qs: string) =>
      request(app.getHttpServer()).get(`/api/bill-instances${qs}`).set(auth(token)).expect(400);

    await bad('');
    await bad('?from=2026-01-01');
    await bad('?to=2026-12-31');
    await bad('?from=lastweek&to=2026-12-31');
    await bad('?from=2026-02-31&to=2026-12-31');
    await bad('?from=2026-12-31&to=2026-01-01');          // reversed
    await bad('?from=2026-01-01&to=2030-01-01');          // span over 400 days
    await bad('?from=2026-01-01&to=2026-12-31&status=OVERDUE'); // not a stored status
  });

  it("never returns another user's instances", async () => {
    const { token: mine } = await setup('a@example.com', { name: 'Mine' });
    await setup('b@example.com', { name: 'Theirs' });
    const res = await request(app.getHttpServer())
      .get('/api/bill-instances?from=2026-01-01&to=2026-12-31').set(auth(mine)).expect(200);
    expect(res.body.every((i: { billName: string }) => i.billName === 'Mine')).toBe(true);
  });
});

describe('GET /api/bill-instances/:id', () => {
  it("returns 404 for another user's instance", async () => {
    const { token: mine } = await setup('a@example.com');
    const { token: theirs } = await setup('b@example.com');
    const theirs1 = await request(app.getHttpServer())
      .get('/api/bill-instances?from=2026-01-01&to=2026-12-31').set(auth(theirs)).expect(200);

    await request(app.getHttpServer())
      .get(`/api/bill-instances/${theirs1.body[0].id}`).set(auth(mine)).expect(404);
  });
});

describe('PATCH /api/bill-instances/:id', () => {
  it('edits the amount and note, and marks the instance customized', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    const res = await request(app.getHttpServer())
      .patch(`/api/bill-instances/${instance.id}`).set(auth(token))
      .send({ amount: 142.55, note: 'High usage month' }).expect(200);

    expect(res.body).toMatchObject({
      amount: 142.55, note: 'High usage month', isCustomized: true,
    });
    expect(typeof res.body.amount).toBe('number');
  });

  it('refuses to change the due date', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    const res = await request(app.getHttpServer())
      .patch(`/api/bill-instances/${instance.id}`).set(auth(token))
      .send({ dueDate: '2026-06-06' }).expect(200);
    // whitelist: true strips the unknown property rather than applying it.
    expect(res.body.dueDate).not.toBe('2026-06-06');
  });

  it('rejects a non-positive amount', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    for (const amount of [0, -1, 142.005, '142.00']) {
      await request(app.getHttpServer())
        .patch(`/api/bill-instances/${instance.id}`).set(auth(token))
        .send({ amount }).expect(400);
    }
  });

  it("returns 404 for another user's instance and leaves it unchanged", async () => {
    const { token: mine } = await setup('a@example.com');
    const { token: theirs } = await setup('b@example.com');
    const target = await firstInstance(theirs);

    await request(app.getHttpServer())
      .patch(`/api/bill-instances/${target.id}`).set(auth(mine))
      .send({ amount: 1 }).expect(404);

    const after = await request(app.getHttpServer())
      .get(`/api/bill-instances/${target.id}`).set(auth(theirs)).expect(200);
    expect(after.body.amount).toBe(target.amount);
  });
});
