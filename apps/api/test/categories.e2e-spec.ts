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
});
