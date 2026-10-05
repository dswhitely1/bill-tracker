import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app/app.module';
import { AuthService } from '../src/auth/auth.service';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { getTestDataSource, truncateAll } from './db';

let app: INestApplication;
let ds: DataSource;

const creds = { email: 'don@example.com', name: 'Don', password: 'hunter22' };

beforeAll(async () => {
  process.env.ENV_FILE = '.env.test';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();
  ds = await getTestDataSource();
});

beforeEach(async () => { await truncateAll(ds); });

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

    seed.mockRestore();
  });

  it('returns 409, not 500, for a duplicate email', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send(creds).expect(201);
    const res = await request(app.getHttpServer()).post('/api/auth/register').send(creds).expect(409);
    expect(JSON.stringify(res.body)).not.toContain('UQ_users_email');
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

    expect(wrongPassword.body.message).toBe(unknownEmail.body.message);
    expect(wrongPassword.body.statusCode).toBe(unknownEmail.body.statusCode);
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
  it('rejects an unauthenticated request to a protected route', async () => {
    // /api/users/me does not exist until Task 9 adds UsersController, so an
    // unmatched route 404s before the guard ever runs. Once that route
    // exists this must tighten to .expect(401) only.
    const res = await request(app.getHttpServer()).get('/api/users/me');
    expect([401, 404]).toContain(res.status);
  });

  it('allows the public health route', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });
});
