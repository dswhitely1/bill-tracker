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

async function registerAndLogin() {
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email: 'don@example.com', name: 'Don', password: 'hunter22' })
    .expect(201);
  const cookie = (res.headers['set-cookie'] as unknown as string[])
    .find((c) => c.startsWith('refresh_token='))!;
  return { token: res.body.accessToken as string, cookie };
}

describe('GET /api/users/me', () => {
  it('returns the caller’s profile and never the password hash', async () => {
    const { token } = await registerAndLogin();
    const res = await request(app.getHttpServer())
      .get('/api/users/me').set('Authorization', `Bearer ${token}`).expect(200);

    expect(res.body.email).toBe('don@example.com');
    expect(res.body).not.toHaveProperty('passwordHash');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  it('rejects an anonymous caller', async () => {
    await request(app.getHttpServer()).get('/api/users/me').expect(401);
  });

  it('rejects a syntactically valid token signed with the wrong secret', async () => {
    const forged = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'x', email: 'a@b.co' })).toString('base64url'),
      'not-a-real-signature',
    ].join('.');
    await request(app.getHttpServer())
      .get('/api/users/me').set('Authorization', `Bearer ${forged}`).expect(401);
  });
});

describe('PATCH /api/users/me', () => {
  it('updates name and notification preferences', async () => {
    const { token } = await registerAndLogin();
    const res = await request(app.getHttpServer())
      .patch('/api/users/me').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Donald', notifyEmail: false }).expect(200);

    expect(res.body.name).toBe('Donald');
    expect(res.body.notifyEmail).toBe(false);
  });

  it('strips properties the DTO does not declare', async () => {
    const { token } = await registerAndLogin();
    await request(app.getHttpServer())
      .patch('/api/users/me').set('Authorization', `Bearer ${token}`)
      .send({ name: 'Donald', email: 'attacker@evil.test', id: 'nope' }).expect(200);

    const rows = await ds.query(`SELECT email FROM users`);
    expect(rows[0].email).toBe('don@example.com');
  });

  it('returns 400 for a name longer than its column', async () => {
    const { token } = await registerAndLogin();
    await request(app.getHttpServer())
      .patch('/api/users/me').set('Authorization', `Bearer ${token}`)
      .send({ name: 'x'.repeat(500) }).expect(400);
  });
});

describe('PATCH /api/users/me/password', () => {
  it('rejects a wrong current password', async () => {
    const { token } = await registerAndLogin();
    await request(app.getHttpServer())
      .patch('/api/users/me/password').set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrong-one', newPassword: 'newpass123' }).expect(400);
  });

  it('changes the password and invalidates every existing refresh token', async () => {
    const { token, cookie } = await registerAndLogin();

    await request(app.getHttpServer())
      .patch('/api/users/me/password').set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'hunter22', newPassword: 'newpass123' }).expect(204);

    await request(app.getHttpServer())
      .post('/api/auth/refresh').set('Cookie', cookie).expect(401);

    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'don@example.com', password: 'newpass123' }).expect(200);
  });
});
