import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { getTestDataSource, truncateAll } from './db';

let app: INestApplication;
let ds: DataSource;
let previousTtl: string | undefined;

beforeAll(async () => {
  // This spec is the one place that needs a genuine, unmocked access-token
  // expiry. .env.test now sets JWT_ACCESS_TTL=15m for the other 56 specs
  // (a 1s TTL applied suite-wide was flaky under load — see the Task 11 fix
  // report), so override it here for this file only.
  //
  // A plain `process.env.JWT_ACCESS_TTL = '1s'` here is NOT enough: Vitest's
  // collection phase statically imports every spec file up front (so it can
  // enumerate test names before running any of them), and that import graph
  // reaches `app.module.ts` -> `config.module.ts`, whose `@Module()`
  // decorator calls `NestConfigModule.forRoot(...)` -- and THAT call runs
  // synchronously, once, at that import, reading process.env at that moment.
  // Every later `Test.createTestingModule({ imports: [AppModule] })` across
  // every file reuses that one frozen snapshot, so a static top-level
  // `import { AppModule }` plus a later env mutation in `beforeAll` changes
  // process.env too late to matter (confirmed by instrumentation: the TTL
  // actually used stayed at 15m even though process.env read back '1s').
  // `vi.resetModules()` plus a dynamic re-import forces `app.module.ts` (and
  // `config.module.ts` beneath it) to re-evaluate from scratch, with the env
  // var we just set, giving this file its own correctly-read short TTL
  // without touching any other spec file's already-bound imports.
  //
  // The TTL itself is 5s, not 1s. This spec needs a token that both EXPIRES
  // (step 3, after sleeping past the TTL) and a token that is still VALID
  // immediately after being minted (steps 2 and 4 — step 4 in particular
  // uses an access token the instant `POST /api/auth/refresh` returns it,
  // with no sleep in between). At 1s, that immediate-use margin is thin
  // enough for ordinary scheduling jitter under load to eat it, and step 4
  // intermittently failed with a 401 that read like a broken guard rather
  // than what it was: a bad TTL choice, not a flaky test or a broken guard.
  // 5s leaves single-request latency nowhere near the boundary while still
  // making the deliberate 5.5s sleep in step 3 a trivial, one-time cost.
  previousTtl = process.env.JWT_ACCESS_TTL;
  process.env.JWT_ACCESS_TTL = '5s'; // must be set BEFORE the re-import below
  process.env.ENV_FILE = '.env.test';
  vi.resetModules();
  const { AppModule } = await import('../src/app/app.module');
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
  if (previousTtl === undefined) delete process.env.JWT_ACCESS_TTL;
  else process.env.JWT_ACCESS_TTL = previousTtl;
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

    // 3. This file's beforeAll rebuilt the app with JWT_ACCESS_TTL=5s, so this is a real expiry, not a mock.
    await sleep(5500);
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
