import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app/app.module';
import { AuthService } from '../src/auth/auth.service';
import { configureApp } from '../src/app/configure-app';
import type { Env } from '../src/config/env.schema';
import { getTestDataSource, truncateAll } from './db';

let app: INestApplication;
let ds: DataSource;
let logError: ReturnType<typeof vi.spyOn>;

const creds = { email: 'don@example.com', name: 'Don', password: 'hunter22' };

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
  // The rollback test below deliberately drives a 500, which the exception
  // filter logs server-side via Logger.error. Silence it here (Task 5's
  // pattern) and assert it fired, rather than letting it spam stdout.
  logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await app?.close();
  if (ds?.isInitialized) await ds.destroy();
});

const cookiesFrom = (res: request.Response): string[] =>
  (res.headers['set-cookie'] as unknown as string[]) ?? [];

describe('POST /api/auth/register', () => {
  it('creates the user, returns an access token, and sets an httpOnly cookie', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/register').send(creds).expect(201);

    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.email).toBe('don@example.com');
    expect(res.body.user).not.toHaveProperty('passwordHash');

    const cookie = cookiesFrom(res).find((c) => c.startsWith('refresh_token='));
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    // Path scopes the cookie's CSRF surface; if it were '/' every route would
    // carry it and this test would still have passed.
    expect(cookie).toContain('Path=/api/auth');
    expect(cookie).not.toContain('Secure'); // production-only
  });

  it('seeds exactly the four default categories', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send(creds).expect(201);
    const rows = await ds.query(`SELECT name FROM categories ORDER BY name`);
    expect(rows.map((r: { name: string }) => r.name)).toEqual(
      ['Credit Cards', 'Housing', 'Subscriptions', 'Utilities'],
    );
  });

  it('rolls back the user when category seeding fails inside the transaction', async () => {
    const auth = app.get(AuthService);
    const seed = vi
      .spyOn(auth as unknown as { seedDefaultCategories: () => Promise<void> },
             'seedDefaultCategories')
      .mockRejectedValue(new Error('seeding exploded'));

    await request(app.getHttpServer()).post('/api/auth/register').send(creds).expect(500);

    const users = await ds.query(`SELECT 1 FROM users`);
    const cats = await ds.query(`SELECT 1 FROM categories`);
    expect(users).toHaveLength(0); // no half-created account survives
    expect(cats).toHaveLength(0);

    // The 500 must still be logged server-side, not silently swallowed.
    expect(logError).toHaveBeenCalledTimes(1);

    seed.mockRestore();
  });

  it('returns 409, not 500, for a duplicate email', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send(creds).expect(201);
    const res = await request(app.getHttpServer()).post('/api/auth/register').send(creds).expect(409);
    expect(JSON.stringify(res.body)).not.toContain('UQ_users_email');
    expect(JSON.stringify(res.body)).not.toContain(creds.email);
  });

  // --- Review Focus item 3 ---
  it('treats a differently-cased, padded email as the same account', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send(creds).expect(201);
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ ...creds, email: '  DON@Example.COM  ' })
      .expect(409);
  });

  it('rejects a password over 72 bytes even when short in characters', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ ...creds, password: '\u{1F512}'.repeat(25) })
      .expect(400);
  });

  // --- Review Focus item 4 ---
  it('returns 400, not 500, when a name exceeds its column width', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/auth/register')
      .send({ ...creds, name: 'x'.repeat(500) });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  beforeEach(async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send(creds).expect(201);
  });

  it('accepts a differently-cased email', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'DON@EXAMPLE.COM', password: creds.password })
      .expect(200);
  });

  it('returns an identical body for a wrong password and an unknown email', async () => {
    const wrongPassword = await request(app.getHttpServer())
      .post('/api/auth/login').send({ email: creds.email, password: 'nope-nope' }).expect(401);
    const unknownEmail = await request(app.getHttpServer())
      .post('/api/auth/login').send({ email: 'nobody@example.com', password: 'nope-nope' }).expect(401);

    // Compare the WHOLE body minus timestamp, not two hand-picked fields. The
    // filter emits { statusCode, error, message, path, timestamp }; checking
    // only message and statusCode would miss a future field that discriminates.
    const strip = ({ timestamp, ...rest }: Record<string, unknown>) => rest;
    expect(strip(wrongPassword.body)).toEqual(strip(unknownEmail.body));
  });
});

describe('POST /api/auth/refresh', () => {
  // --- Review Focus item 5 ---
  it('returns 401, not 500, when the cookie is absent', async () => {
    await request(app.getHttpServer()).post('/api/auth/refresh').expect(401);
  });

  it('returns 401 when the cookie is empty', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/refresh').set('Cookie', 'refresh_token=').expect(401);
  });

  it('returns 401 when the cookie is garbage', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/refresh').set('Cookie', 'refresh_token=%%%not-base64%%%').expect(401);
  });
});

describe('global guard', () => {
  // Assert against logout, not /api/users/me. That route does not exist until
  // Task 9, so a [401, 404] assertion against it passes with the guard DELETED
  // — and so does the health check. Logout is protected and exists now, so
  // these two are the only tests here that can actually fail.
  it('rejects an unauthenticated request to a protected route', async () => {
    await request(app.getHttpServer()).post('/api/auth/logout').expect(401);
  });

  it('accepts a bearer token on a protected route', async () => {
    const reg = await request(app.getHttpServer())
      .post('/api/auth/register').send(creds).expect(201);

    // The only place a bearer token is presented to a route. Without this,
    // JwtStrategy's secret lookup, extraction and validate() are never
    // exercised end to end and a wrong config key stays green.
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .expect(204);
  });

  it('rejects a bearer token signed with the wrong secret', async () => {
    const forged = [
      Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ sub: 'x', email: 'a@b.co' })).toString('base64url'),
      'not-a-real-signature',
    ].join('.');

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${forged}`)
      .expect(401);
  });

  it('allows the public health route', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });

  // configureApp() wires CORS from WEB_ORIGIN (http://localhost:4200 in
  // .env.test). This is the only test that actually exercises it — the
  // CORS allowlist is the only thing standing between a hostile origin and
  // a credentialed browser request, and it used to live only in main.ts,
  // which no test executed.
  it('grants the configured WEB_ORIGIN access with credentials', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'http://localhost:4200')
      .expect(200);

    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:4200');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('does not grant a different origin access', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .set('Origin', 'http://evil.example')
      .expect(200);

    expect(res.headers['access-control-allow-origin']).not.toBe('http://evil.example');
  });

  it('tolerates a malformed logout cookie without a 500', async () => {
    const reg = await request(app.getHttpServer())
      .post('/api/auth/register').send(creds).expect(201);

    // cookie-parser JSON-parses values prefixed "j:", so this arrives as an
    // object. Without the typeof guard in TokenService.revoke it reaches
    // createHash().update(object) and surfaces as a 500.
    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${reg.body.accessToken}`)
      .set('Cookie', 'refresh_token=j:{"a":1}')
      .expect(204);
  });
});
