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

async function registerAs(email: string): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, name: 'Test User', password: 'hunter22' })
    .expect(201);
  return res.body.accessToken as string;
}

describe('validation error bodies', () => {
  it('keys each failing field of a bill payload', async () => {
    const token = await registerAs('a@example.com');

    // defaultAmount's positivity rule lives in BillsService.validate() — a
    // cross-field, service-level check — not in a decorator, so it never
    // fires once the pipe has already rejected the other three fields.
    // 100.555 instead exercises the pipe's own maxDecimalPlaces:2 rule, so
    // all four fields genuinely fail at the pipe and land in the map.
    const res = await request(app.getHttpServer())
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '', defaultAmount: 100.555, frequency: 'FORTNIGHTLY', startDate: 'not-a-date' })
      .expect(400);

    expect(Object.keys(res.body.errors).sort()).toEqual([
      'defaultAmount',
      'frequency',
      'name',
      'startDate',
    ]);
    expect(res.body.errors.startDate.join(' ')).toContain('startDate');
  });

  it('keeps the flat message array alongside the map', async () => {
    const token = await registerAs('a@example.com');

    const res = await request(app.getHttpServer())
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '', defaultAmount: -5, frequency: 'MONTHLY', startDate: '2026-01-01' })
      .expect(400);

    expect(Array.isArray(res.body.message)).toBe(true);
    expect(res.body.message.length).toBeGreaterThan(0);
    // Every message in the flat array is reachable through the map, and
    // vice versa: the two views never disagree about what failed.
    expect([...res.body.message].sort()).toEqual(
      Object.values(res.body.errors as Record<string, string[]>)
        .flat()
        .sort(),
    );
  });

  it('carries the standard envelope unchanged', async () => {
    const token = await registerAs('a@example.com');

    const res = await request(app.getHttpServer())
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '' })
      .expect(400);

    expect(res.body.statusCode).toBe(400);
    expect(res.body.error).toBe('Bad Request');
    expect(res.body.path).toBe('/api/bills');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('omits the errors key on a 400 raised by a service rather than the pipe', async () => {
    const token = await registerAs('a@example.com');

    // A syntactically valid payload naming a category the user does not
    // own. The pipe passes it; BillsService rejects it. There is no field
    // map, and the client must branch on the key's presence rather than
    // on the status code.
    const res = await request(app.getHttpServer())
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Rent',
        defaultAmount: 100,
        frequency: 'MONTHLY',
        startDate: '2026-01-01',
        categoryId: '00000000-0000-4000-8000-000000000000',
      })
      .expect(400);

    expect(res.body).not.toHaveProperty('errors');
  });
});
