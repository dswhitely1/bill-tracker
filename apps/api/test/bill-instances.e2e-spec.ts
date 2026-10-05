import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app/app.module';
import { configureApp } from '../src/app/configure-app';
import type { Env } from '../src/config/env.schema';
import { BillGeneratorService } from '../src/bills/bill-generator.service';
import { addDays } from '../src/bills/dates';
import { getTestDataSource, truncateAll } from './db';

let app: INestApplication;
let ds: DataSource;

/**
 * The generator materializes from the floor occurrence at-or-before real
 * wall-clock "today", forward ~12 months — never from a bill's startDate.
 * A fixed calendar window (e.g. `2026-01-01..2026-12-31`) therefore only
 * contains rows while "today" happens to sit inside it, and silently runs
 * dry once "today" rolls past it. Every window below is anchored to this
 * value instead of a literal, and re-derived fresh in `beforeAll` so it
 * tracks the real clock on every run.
 */
let today: string;

beforeAll(async () => {
  process.env.ENV_FILE = '.env.test';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  configureApp(app, app.get(ConfigService<Env, true>));
  await app.init();
  ds = await getTestDataSource();
  today = app.get(BillGeneratorService).today();
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
 * A window guaranteed to straddle the generator's materialized set no
 * matter when the suite runs: 60 days back covers the floor occurrence
 * for every supported frequency, 300 days forward stays comfortably
 * inside the 400-day cap while covering most of the 12-month horizon.
 */
const WINDOW_FROM = () => addDays(today, -60);
const WINDOW_TO = () => addDays(today, 300);
const mainWindowQs = () => `from=${WINDOW_FROM()}&to=${WINDOW_TO()}`;

/**
 * The earliest instance of the caller's bills. Declared at module scope,
 * not inside a describe: Tasks 9 and 10 import this helper.
 */
async function firstInstance(token: string): Promise<{ id: string; amount: number }> {
  const res = await request(app.getHttpServer())
    .get(`/api/bill-instances?${mainWindowQs()}`).set(auth(token)).expect(200);
  return res.body[0] as { id: string; amount: number };
}

describe('GET /api/bill-instances', () => {
  it('returns instances in the range, ascending, with derived fields', async () => {
    const { token, billId } = await setup('a@example.com');
    const res = await request(app.getHttpServer())
      .get(`/api/bill-instances?${mainWindowQs()}`)
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
    // A 90-day window strictly inside the forward horizon: wider than one
    // MONTHLY period, so it always catches at least one due date, and
    // anchored to "today" rather than a literal so it never runs dry.
    const from = addDays(today, 30);
    const to = addDays(today, 120);
    const res = await request(app.getHttpServer())
      .get(`/api/bill-instances?from=${from}&to=${to}`).set(auth(token)).expect(200);
    // An empty result would make the bounds check below pass vacuously —
    // assert there is something real to check the bounds against.
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((i: { dueDate: string }) => i.dueDate >= from && i.dueDate <= to))
      .toBe(true);
  });

  it('filters by status, billId, and overdue', async () => {
    const { token, billId } = await setup('a@example.com');
    const total = await request(app.getHttpServer())
      .get(`/api/bill-instances?${mainWindowQs()}`).set(auth(token)).expect(200);
    // Guards every .every() below from passing vacuously on an empty window.
    expect(total.body.length).toBeGreaterThan(0);

    const byStatus = await request(app.getHttpServer())
      .get(`/api/bill-instances?${mainWindowQs()}&status=UNPAID`)
      .set(auth(token)).expect(200);
    expect(byStatus.body.length).toBeGreaterThan(0);
    expect(byStatus.body.every((i: { status: string }) => i.status === 'UNPAID')).toBe(true);

    const byBill = await request(app.getHttpServer())
      .get(`/api/bill-instances?${mainWindowQs()}&billId=${billId}`)
      .set(auth(token)).expect(200);
    expect(byBill.body.length).toBeGreaterThan(0);
    expect(byBill.body.every((i: { billId: string }) => i.billId === billId)).toBe(true);

    const overdue = await request(app.getHttpServer())
      .get(`/api/bill-instances?${mainWindowQs()}&overdue=true`)
      .set(auth(token)).expect(200);
    expect(overdue.body.every((i: { isOverdue: boolean }) => i.isOverdue === true)).toBe(true);

    const notOverdue = await request(app.getHttpServer())
      .get(`/api/bill-instances?${mainWindowQs()}&overdue=false`)
      .set(auth(token)).expect(200);
    expect(notOverdue.body.every((i: { isOverdue: boolean }) => i.isOverdue === false))
      .toBe(true);
    // The two overdue partitions must together account for every row in
    // the (already confirmed non-empty) unfiltered window — not just sum
    // to each other, which `0 + 0 === 0` would satisfy vacuously too.
    expect(overdue.body.length + notOverdue.body.length).toBe(total.body.length);
  });

  it('rejects a missing, malformed, or impossible range with a 400', async () => {
    // Review Focus 1: none of these may reach PostgreSQL's date parser.
    // These exercise pure input validation — reversed, malformed, or
    // oversized ranges are rejected before any row is ever looked up — so
    // they stay on fixed literals rather than the data-bearing window.
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
      .get(`/api/bill-instances?${mainWindowQs()}`).set(auth(mine)).expect(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every((i: { billName: string }) => i.billName === 'Mine')).toBe(true);
  });
});

describe('GET /api/bill-instances/:id', () => {
  it("returns 404 for another user's instance", async () => {
    const { token: mine } = await setup('a@example.com');
    const { token: theirs } = await setup('b@example.com');
    const theirs1 = await request(app.getHttpServer())
      .get(`/api/bill-instances?${mainWindowQs()}`).set(auth(theirs)).expect(200);
    expect(theirs1.body.length).toBeGreaterThan(0);

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
