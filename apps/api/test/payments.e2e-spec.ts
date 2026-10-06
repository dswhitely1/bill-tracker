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

/**
 * `setup`, `auth`, and `firstInstance` are deliberately NOT imported from
 * `bill-instances.e2e-spec.ts`, even though that file declares them at
 * module scope for exactly this reuse. Importing a `*.e2e-spec.ts` module
 * re-runs every top-level `describe()` it contains as a side effect of the
 * import — confirmed by trying it: the file's own "GET /api/bill-instances"
 * and "PATCH /api/bill-instances/:id" suites re-registered themselves
 * under this file, running a second, redundant full Nest bootstrap and
 * inflating the e2e count from 112+10 (expected) to 132 (observed). The
 * duplicated copies below avoid that at the cost of staying in sync with
 * the originals by hand — the lesser of the two problems.
 */
let app: INestApplication;
let ds: DataSource;
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

const WINDOW_FROM = () => addDays(today, -60);
const WINDOW_TO = () => addDays(today, 300);
const mainWindowQs = () => `from=${WINDOW_FROM()}&to=${WINDOW_TO()}`;

/** The earliest instance of the caller's bills. */
async function firstInstance(token: string): Promise<{ id: string; amount: number }> {
  const res = await request(app.getHttpServer())
    .get(`/api/bill-instances?${mainWindowQs()}`).set(auth(token)).expect(200);
  return res.body[0] as { id: string; amount: number };
}

describe('POST /api/bill-instances/:id/payments', () => {
  it('pays in full with an empty body', async () => {
    // The one-click "mark paid" path — spec §6.2.
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);

    const res = await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token))
      .send({}).expect(201);

    expect(res.body.instance).toMatchObject({
      status: 'PAID', amountPaid: 1800, amount: 1800,
    });
    expect(res.body.instance.paidAt).not.toBeNull();
    expect(res.body.payment).toMatchObject({ amountPaid: 1800, reversesPaymentId: null });
    expect(typeof res.body.payment.amountPaid).toBe('number');
  });

  it('records a partial payment and then the remainder', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    const pay = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token)).send(body);

    const partial = await pay({ amount: 800 }).expect(201);
    expect(partial.body.instance).toMatchObject({
      status: 'PARTIALLY_PAID', amountPaid: 800, paidAt: null,
    });

    const rest = await pay({}).expect(201); // empty body = remaining balance
    expect(rest.body.payment.amountPaid).toBe(1000);
    expect(rest.body.instance).toMatchObject({ status: 'PAID', amountPaid: 1800 });

    const log = await request(app.getHttpServer())
      .get(`/api/bill-instances/${instance.id}/payments`).set(auth(token)).expect(200);
    expect(log.body).toHaveLength(2);
    expect(log.body.map((p: { amountPaid: number }) => p.amountPaid)).toEqual([800, 1000]);
  });

  it('accepts a note and a backdated paidAt', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    const res = await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token))
      .send({ amount: 100, paidAt: '2026-09-01T12:00:00.000Z', note: 'cheque' }).expect(201);
    expect(res.body.payment.paidAt).toBe('2026-09-01T12:00:00.000Z');
    expect(res.body.payment.note).toBe('cheque');
  });

  it('rejects an ISO 8601 basic-format paidAt instead of 500ing', async () => {
    // validator.js's isISO8601 accepts basic format (no separators) in
    // every option mode, but `new Date('20261005')` is Invalid Date, which
    // used to reach pg as "0NaN-NaN-NaNT..." and 500.
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token))
      .send({ amount: 10, paidAt: '20261005' }).expect(400);
  });

  it('rejects a calendar date that does not exist', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token))
      .send({ amount: 10, paidAt: '2026-02-31' }).expect(400);
  });

  it('rejects a paidAt in the future', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token))
      .send({ amount: 10, paidAt: '2099-01-01T00:00:00.000Z' }).expect(400);
  });

  it('rejects overpayment, naming the balance', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    const res = await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token))
      .send({ amount: 1800.01 }).expect(400);
    expect(JSON.stringify(res.body)).toContain('1800.00');
  });

  it('rejects a payment against an already-paid instance', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    const pay = (body: Record<string, unknown>) =>
      request(app.getHttpServer())
        .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token)).send(body);
    await pay({}).expect(201);
    await pay({ amount: 1 }).expect(400);
    const zeroBalance = await pay({}).expect(400); // balance is zero
    // oxlint's vitest/expect-expect only recognises assertions chained
    // directly off an identifier literally named `request`, not off the
    // local `pay` wrapper above — this makes the check visible to it
    // without weakening what the test already verified via `.expect()`.
    expect(zeroBalance.status).toBe(400);
  });

  it('rejects a non-positive or over-precise amount', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    for (const amount of [0, -5, 1.005, '100']) {
      await request(app.getHttpServer())
        .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token))
        .send({ amount }).expect(400);
    }
  });

  it("returns 404 for another user's instance and records nothing", async () => {
    const { token: mine } = await setup('a@example.com');
    const { token: theirs } = await setup('b@example.com');
    const target = await firstInstance(theirs);

    await request(app.getHttpServer())
      .post(`/api/bill-instances/${target.id}/payments`).set(auth(mine))
      .send({ amount: 10 }).expect(404);

    const log = await request(app.getHttpServer())
      .get(`/api/bill-instances/${target.id}/payments`).set(auth(theirs)).expect(200);
    expect(log.body).toHaveLength(0);
  });
});

describe('GET /api/bill-instances/:id/payments', () => {
  it("returns 404 for another user's instance", async () => {
    const { token: mine } = await setup('a@example.com');
    const { token: theirs } = await setup('b@example.com');
    const target = await firstInstance(theirs);
    await request(app.getHttpServer())
      .get(`/api/bill-instances/${target.id}/payments`).set(auth(mine)).expect(404);
  });
});

describe('PATCH /api/bill-instances/:id amount-vs-amount_paid guard', () => {
  // Task 8 added the guard in BillInstancesService.update rejecting
  // `amount < amount_paid`, so editing an instance's amount cannot strand
  // it above its own payments. It shipped with no automated test, because
  // nothing could produce a non-zero amount_paid before this endpoint
  // existed. Confirm the guard is real, not merely assumed.
  it('rejects lowering the amount below what has already been paid', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);

    await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token))
      .send({ amount: 800 }).expect(201);

    const res = await request(app.getHttpServer())
      .patch(`/api/bill-instances/${instance.id}`).set(auth(token))
      .send({ amount: 500 }).expect(400);
    expect(JSON.stringify(res.body)).toContain('800.00');
  });
});

describe('POST .../payments/:paymentId/reverse', () => {
  it('appends a negation and walks the status back', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    const paid = await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token))
      .send({ amount: 800 }).expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments/${paid.body.payment.id}/reverse`)
      .set(auth(token)).expect(201);

    expect(res.body.payment).toMatchObject({
      amountPaid: -800, reversesPaymentId: paid.body.payment.id,
    });
    expect(res.body.instance).toMatchObject({
      status: 'UNPAID', amountPaid: 0, paidAt: null,
    });

    // Nothing was deleted: the log keeps both rows.
    const log = await request(app.getHttpServer())
      .get(`/api/bill-instances/${instance.id}/payments`).set(auth(token)).expect(200);
    expect(log.body).toHaveLength(2);
    expect(log.body.map((p: { amountPaid: number }) => p.amountPaid)).toEqual([800, -800]);
  });

  it('walks a fully paid bill back to PARTIALLY_PAID', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    const first = await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token))
      .send({ amount: 800 }).expect(201);
    await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token))
      .send({}).expect(201);

    const res = await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments/${first.body.payment.id}/reverse`)
      .set(auth(token)).expect(201);
    expect(res.body.instance).toMatchObject({
      status: 'PARTIALLY_PAID', amountPaid: 1000, paidAt: null,
    });
  });

  it('refuses to reverse the same payment twice', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    const paid = await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token))
      .send({ amount: 100 }).expect(201);
    const reverse = () =>
      request(app.getHttpServer())
        .post(`/api/bill-instances/${instance.id}/payments/${paid.body.payment.id}/reverse`)
        .set(auth(token));

    await reverse().expect(201);
    await reverse().expect(409);
  });

  it('refuses to reverse a reversal', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    const paid = await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token))
      .send({ amount: 100 }).expect(201);
    const reversal = await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments/${paid.body.payment.id}/reverse`)
      .set(auth(token)).expect(201);

    await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments/${reversal.body.payment.id}/reverse`)
      .set(auth(token)).expect(409);
  });

  it('404s on a payment belonging to a different instance', async () => {
    const { token } = await setup('a@example.com');
    // A literal 2026-01-01..2027-12-31 range is 729 days — over this
    // API's 400-day cap, so it would 400 before this test could even run.
    // The anchored window helpers used elsewhere in this file stay inside
    // the cap while still covering more than one instance.
    const list = await request(app.getHttpServer())
      .get(`/api/bill-instances?${mainWindowQs()}`).set(auth(token)).expect(200);
    const [one, two] = list.body as Array<{ id: string }>;
    const paid = await request(app.getHttpServer())
      .post(`/api/bill-instances/${one.id}/payments`).set(auth(token))
      .send({ amount: 10 }).expect(201);

    await request(app.getHttpServer())
      .post(`/api/bill-instances/${two.id}/payments/${paid.body.payment.id}/reverse`)
      .set(auth(token)).expect(404);
  });

  it("404s on another user's payment", async () => {
    const { token: mine } = await setup('a@example.com');
    const { token: theirs } = await setup('b@example.com');
    const target = await firstInstance(theirs);
    const paid = await request(app.getHttpServer())
      .post(`/api/bill-instances/${target.id}/payments`).set(auth(theirs))
      .send({ amount: 10 }).expect(201);

    await request(app.getHttpServer())
      .post(`/api/bill-instances/${target.id}/payments/${paid.body.payment.id}/reverse`)
      .set(auth(mine)).expect(404);
  });
});

describe('POST /api/bill-instances/:id/unpay', () => {
  it('reverses every unreversed payment in one call', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    for (const amount of [500, 500, 800]) {
      await request(app.getHttpServer())
        .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token))
        .send({ amount }).expect(201);
    }

    const res = await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/unpay`).set(auth(token)).expect(200);

    expect(res.body).toMatchObject({ status: 'UNPAID', amountPaid: 0, paidAt: null });
    const log = await request(app.getHttpServer())
      .get(`/api/bill-instances/${instance.id}/payments`).set(auth(token)).expect(200);
    expect(log.body).toHaveLength(6); // three payments, three reversals
    expect(log.body.filter((p: { amountPaid: number }) => p.amountPaid < 0)).toHaveLength(3);
  });

  it('409s when there is nothing to reverse', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/unpay`).set(auth(token)).expect(409);
  });

  it('409s when every payment is already reversed', async () => {
    const { token } = await setup('a@example.com');
    const instance = await firstInstance(token);
    await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/payments`).set(auth(token))
      .send({ amount: 100 }).expect(201);
    await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/unpay`).set(auth(token)).expect(200);
    await request(app.getHttpServer())
      .post(`/api/bill-instances/${instance.id}/unpay`).set(auth(token)).expect(409);
  });

  it("404s for another user's instance", async () => {
    const { token: mine } = await setup('a@example.com');
    const { token: theirs } = await setup('b@example.com');
    const target = await firstInstance(theirs);
    await request(app.getHttpServer())
      .post(`/api/bill-instances/${target.id}/unpay`).set(auth(mine)).expect(404);
  });
});
