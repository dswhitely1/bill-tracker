import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
 * wall-clock "today", forward — never from a bill's startDate. A fixed
 * calendar window (e.g. `2026-01-01..2026-12-31`) only contains rows while
 * "today" happens to sit inside it, and runs dry once "today" rolls past
 * it. The window below is anchored to this value instead of a literal, and
 * re-derived fresh in `beforeAll` so it tracks the real clock on every run.
 * 60 days back covers the floor occurrence for a MONTHLY bill (the only
 * frequency this test uses); widen it before introducing an ANNUALLY or
 * WEEKLY fixture into a relative window.
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

const WINDOW_FROM = () => addDays(today, -60);
const WINDOW_TO = () => addDays(today, 300);

describe('a full bills session', () => {
  it('registers, creates a bill, pays it in parts, reverses, and reconciles', async () => {
    const { token } = await registerAs('journey@example.com');
    const h = { Authorization: `Bearer ${token}` };

    // 1. A category exists from registration.
    const cats = await request(app.getHttpServer())
      .get('/api/categories').set(h).expect(200);
    const housing = (cats.body as Array<{ id: string; name: string }>)
      .find((c) => c.name === 'Housing');
    expect(housing).toBeDefined();

    // 2. Create a monthly bill and get a populated calendar immediately.
    const bill = await request(app.getHttpServer()).post('/api/bills').set(h).send({
      name: 'Rent', defaultAmount: 1800, frequency: 'MONTHLY',
      startDate: '2026-01-01', categoryId: housing!.id,
    }).expect(201);

    const list = await request(app.getHttpServer())
      .get(`/api/bill-instances?from=${WINDOW_FROM()}&to=${WINDOW_TO()}&billId=${bill.body.id}`)
      .set(h).expect(200);
    expect(list.body.length).toBeGreaterThan(0);
    expect(list.body[0].categoryId).toBe(housing!.id);
    const target = list.body[0] as { id: string };

    // 3. Pay part of it.
    const partial = await request(app.getHttpServer())
      .post(`/api/bill-instances/${target.id}/payments`).set(h)
      .send({ amount: 800, note: 'first half' }).expect(201);
    expect(partial.body.instance.status).toBe('PARTIALLY_PAID');

    // 4. Pay the remainder with an empty body.
    const full = await request(app.getHttpServer())
      .post(`/api/bill-instances/${target.id}/payments`).set(h).send({}).expect(201);
    expect(full.body.instance).toMatchObject({ status: 'PAID', amountPaid: 1800 });
    expect(full.body.payment.amountPaid).toBe(1000);

    // 5. Raise the rent. The paid instance must not move.
    await request(app.getHttpServer())
      .patch(`/api/bills/${bill.body.id}`).set(h).send({ defaultAmount: 1950 }).expect(200);
    const afterRaise = await request(app.getHttpServer())
      .get(`/api/bill-instances/${target.id}`).set(h).expect(200);
    expect(afterRaise.body).toMatchObject({ amount: 1800, status: 'PAID' });

    // 6. The misclick: reverse the first payment.
    const reversed = await request(app.getHttpServer())
      .post(`/api/bill-instances/${target.id}/payments/${partial.body.payment.id}/reverse`)
      .set(h).expect(201);
    expect(reversed.body.instance).toMatchObject({
      status: 'PARTIALLY_PAID', amountPaid: 1000, paidAt: null,
    });

    // 7. The instance and its log agree, and nothing was erased.
    const log = await request(app.getHttpServer())
      .get(`/api/bill-instances/${target.id}/payments`).set(h).expect(200);
    expect(log.body).toHaveLength(3);
    const sum = (log.body as Array<{ amountPaid: number }>)
      .reduce((total, p) => total + p.amountPaid, 0);
    expect(Math.round(sum * 100) / 100).toBe(1000); // 800 + 1000 - 800

    const instance = await request(app.getHttpServer())
      .get(`/api/bill-instances/${target.id}`).set(h).expect(200);
    expect(instance.body.amountPaid).toBe(1000); // the cache agrees with the log

    // 8. The category cannot be deleted while the bill exists.
    await request(app.getHttpServer())
      .delete(`/api/categories/${housing!.id}`).set(h).expect(409);

    // 9. Deleting the bill takes its instances and logs with it.
    await request(app.getHttpServer())
      .delete(`/api/bills/${bill.body.id}`).set(h).expect(204);
    await request(app.getHttpServer())
      .get(`/api/bill-instances/${target.id}`).set(h).expect(404);
    await request(app.getHttpServer())
      .delete(`/api/categories/${housing!.id}`).set(h).expect(204);
  });
});
