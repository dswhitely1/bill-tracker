import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { getTestDataSource, truncateAll } from './db';

let app: INestApplication;
let ds: DataSource;

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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const refreshCookie = (res: request.Response) =>
  ((res.headers['set-cookie'] as unknown as string[]) ?? [])
    .find((c) => c.startsWith('refresh_token='))!
    .split(';')[0];

describe('full token lifecycle', () => {
  it('registers, expires, refreshes, detects replay, and logs out', async () => {
    const server = app.getHttpServer();

    // 1. Register.
    const registered = await request(server)
      .post('/api/auth/register')
      .send({ email: 'journey@example.com', name: 'Journey', password: 'hunter22' })
      .expect(201);

    const firstCookie = refreshCookie(registered);
    const firstAccess = registered.body.accessToken as string;

    // 2. The access token works immediately.
    await request(server).get('/api/users/me')
      .set('Authorization', `Bearer ${firstAccess}`).expect(200);

    // 3. JWT_ACCESS_TTL is 1s in .env.test, so this is a real expiry, not a mock.
    await sleep(1500);
    await request(server).get('/api/users/me')
      .set('Authorization', `Bearer ${firstAccess}`).expect(401);

    // 4. Silent refresh issues a working access token and a rotated cookie.
    const refreshed = await request(server)
      .post('/api/auth/refresh').set('Cookie', firstCookie).expect(200);

    const secondCookie = refreshCookie(refreshed);
    expect(secondCookie).not.toBe(firstCookie);

    await request(server).get('/api/users/me')
      .set('Authorization', `Bearer ${refreshed.body.accessToken}`).expect(200);

    // 5. Replaying the first cookie inside the grace window is tolerated.
    await request(server).post('/api/auth/refresh').set('Cookie', firstCookie).expect(200);

    // 6. Outside the window it is treated as theft and kills every session.
    await ds.query(`UPDATE refresh_tokens SET revoked_at = now() - interval '5 minutes'
                    WHERE revoked_at IS NOT NULL`);
    await request(server).post('/api/auth/refresh').set('Cookie', firstCookie).expect(401);

    const live = await ds.query(`SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL`);
    expect(live).toHaveLength(0);

    // 7. Even the most recent cookie no longer works.
    await request(server).post('/api/auth/refresh').set('Cookie', secondCookie).expect(401);
  });

  it('logs out cleanly and invalidates the cookie', async () => {
    const server = app.getHttpServer();
    const registered = await request(server)
      .post('/api/auth/register')
      .send({ email: 'logout@example.com', name: 'Out', password: 'hunter22' })
      .expect(201);

    const cookie = refreshCookie(registered);

    await request(server).post('/api/auth/logout')
      .set('Authorization', `Bearer ${registered.body.accessToken}`)
      .set('Cookie', cookie).expect(204);

    await request(server).post('/api/auth/refresh').set('Cookie', cookie).expect(401);
  });
});
