# Angular Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Angular 22 client for the bill tracker — shell, routing, silent token refresh, bill templates, instances, and payments — against the API merged in sub-projects 1 and 2.

**Architecture:** One zoneless standalone Angular application in `apps/web`, organised as `core/` (API clients, signal stores, session and interceptor, calendar-date module), `shared/` (presentational pieces), and one folder per feature. State lives in signal stores that patch a row when the API returns one and refetch a range when the server recomputed something the client cannot predict. Dates are `YYYY-MM-DD` strings end to end: a custom Material `DateAdapter<string>` means no `Date` object ever sits between the datepicker and the wire.

**Tech Stack:** Angular 22.2.1, Angular Material + CDK 22.2.1, `@nx/angular` 23.2.0, `@nx/playwright` 23.2.0, Vitest via `@angular/build:unit-test`, Playwright, oxlint, Prettier.

**Spec:** `docs/superpowers/specs/2026-10-06-angular-shell-design.md`

## Global Constraints

- Angular **22.2.1**; Angular Material and CDK **22.2.1**; `@nx/angular` and `@nx/playwright` **23.2.0** — matching every other `@nx/*` package already installed, not 23.2.1.
- The application is **zoneless** from its first commit. `provideZonelessChangeDetection()` is in the application config and is never removed.
- **No stored date string is ever passed to `new Date()`.** The single permitted `Date` use is `today()` in `core/date/calendar-date.ts`, which formats the current instant through `Intl.DateTimeFormat('en-CA')` and never parses.
- `BillInstanceResponse.isOverdue` is **read from the server, never recomputed**. It is derived against the server's `APP_TIMEZONE`, not the browser's.
- The access token is held **in memory only**. Never `localStorage`, never `sessionStorage`, never a cookie written by the client.
- `POST /api/bill-instances/:id/payments` with an **empty body** means "pay the remaining balance". The client never computes and submits that figure; the server computes it under a row lock.
- Money is a `number` on the wire. Amount inputs validate `> 0` and `<= 9999999999.99`.
- `GET /api/bill-instances` **requires `from` and `to`**, `to >= from`, span at most **400 days**. There is no cursor.
- A resource belonging to another user returns **404, never 403**. A 401 from a non-auth route can only mean a token problem.
- Every new file is covered by a test in the same task. Tests are written before the implementation.
- **The `web` project's test target rejects positional filters.** It is Angular's `@angular/build:unit-test` builder, so `nx test web -- <pattern>` fails outright; use `--include='**/<name>.spec.ts'`. The `api` project is different — its `@nx/vitest` target does accept positional filters.
- **`TZ` is not part of the Nx cache key.** Any timezone-sensitive run must pass `--skip-nx-cache`, or a second zone is served from the first zone's cache and proves nothing. When reporting a timezone run, state the offset it actually executed at (`TZ=<zone> date +%z`), not the one intended.
- Existing API behaviour does not change except as Task 1 specifies. Every existing test stays green.
- Never run `docker compose down -v`, never run `git clean` in any form, never drop or recreate a database, and never leave a server process running after a task.
- `.env` is gitignored and holds a generated secret. It is never committed and never printed.

## Review Focus

These are failure modes the spec implies that no task's happy path would exercise. Each has a test in the task named.

1. **A refresh that fails mid-session.** The user is on a screen, the refresh token is revoked or expired, and the retry fails. Expect: the session clears, the app navigates to `/login` with an explanation, every waiting request fails with its original error, and nothing throws into the void. — **Task 6.**
2. **A date range the user makes invalid or too wide.** `to` earlier than `from`, or a span over 400 days. Expect: a message on the control and no request sent — never a 400 from the server. — **Task 11.**
3. **Reversing a payment that is already reversed.** The API's partial unique index makes this a 409. Expect: the server's message shown and the row refreshed, not a silent no-op or a stale row. — **Task 12.**
4. **Empty result sets.** A date range with no instances; a new account with no bills and no categories. Expect: a named empty state, not a blank table a user reads as a loading failure. — **Tasks 9, 10, 11.**
5. **A browser timezone that disagrees with `APP_TIMEZONE`.** The browser's "today" is a different calendar day from the server's. Expect: `isOverdue` still comes from the server and the client never derives it, so the badge agrees with the API regardless of where the browser sits. — **Task 11.**

---

## File Structure

### API (Task 1 only)

| File | Responsibility |
|---|---|
| `apps/api/src/common/validation-error.factory.ts` | Turns `ValidationError[]` into a dotted-path field map and the flat message array Nest produced before. |
| `apps/api/src/common/filters/all-exceptions.filter.ts` | Modified: carries an `errors` map through instead of discarding it. |
| `apps/api/src/app/configure-app.ts` | Modified: `ValidationPipe` gets the new `exceptionFactory`. |
| `libs/shared-types/src/lib/error.contracts.ts` | `ErrorResponse`, `ValidationErrorResponse`. Declarative only — the type guard lives in the web app. |

### Web application

| File | Responsibility |
|---|---|
| `apps/web/src/app/core/date/calendar-date.ts` | Pure `YYYY-MM-DD` arithmetic. No `Date` except `today()`. |
| `apps/web/src/app/core/date/calendar-date.pipe.ts` | Renders a `CalendarDate` for display without parsing it. |
| `apps/web/src/app/core/date/calendar-date.adapter.ts` | `DateAdapter<CalendarDate>` plus `CALENDAR_DATE_FORMATS` and the provider factory. |
| `apps/web/src/app/core/api/*.api.ts` | One thin typed client per resource. No state. |
| `apps/web/src/app/core/api/api-error.ts` | Narrows an `HttpErrorResponse` to the API's error contract. |
| `apps/web/src/app/core/auth/auth.tokens.ts` | `SKIP_AUTH_RETRY` context token. |
| `apps/web/src/app/core/auth/session.service.ts` | The access token, the current user, single-flight refresh, boot restore, sign-out. |
| `apps/web/src/app/core/auth/auth.interceptor.ts` | Bearer header, credentials, and the 401 refresh-and-retry. |
| `apps/web/src/app/core/auth/auth.guard.ts` | `authGuard` and `guestGuard`. |
| `apps/web/src/app/core/state/*.store.ts` | One signal store per resource. Patch on mutation, invalidate when the server recomputed. |
| `apps/web/src/app/shared/server-errors.ts` | Maps the `errors` map onto form controls; returns what did not match. |
| `apps/web/src/app/shared/field-errors.component.ts` | Renders client and server messages in a `mat-error`. |
| `apps/web/src/app/shared/confirm-dialog.component.ts` | One confirmation dialog, parameterised. |
| `apps/web/src/app/shared/empty-state.component.ts` | The named empty state used by every list. |
| `apps/web/src/app/shared/notification.service.ts` | The single `MatSnackBar` entry point. |
| `apps/web/src/app/shared/money.ts` | `CURRENCY`, `MAX_AMOUNT`, and the amount validators. |
| `apps/web/src/app/<feature>/` | One folder per feature: `auth`, `bills`, `instances`, `categories`, `settings`. |
| `apps/web-e2e/src/*.spec.ts` | Playwright journeys. |

---

## Task 1: Structured validation errors from the API

Spec §2.1. The foundation spec promised per-field validation detail; the
implementation returns a flat `string[]`. This task delivers the promise.

**This is the only task that changes merged API code.** Nothing else in
this plan touches `apps/api`.

**Files:**
- Create: `apps/api/src/common/validation-error.factory.ts`
- Create: `apps/api/src/common/validation-error.factory.spec.ts`
- Create: `libs/shared-types/src/lib/error.contracts.ts`
- Modify: `libs/shared-types/src/index.ts`
- Modify: `apps/api/src/common/filters/all-exceptions.filter.ts`
- Modify: `apps/api/src/common/filters/all-exceptions.filter.spec.ts`
- Modify: `apps/api/src/app/configure-app.ts`
- Create: `apps/api/test/validation-errors.e2e-spec.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `flattenToFieldErrors(errors: ValidationError[], parentPath?: string): Record<string, string[]>`
  - `validationExceptionFactory(errors: ValidationError[]): BadRequestException`
  - `ErrorResponse` and `ValidationErrorResponse` from `@bill-tracker/shared-types`

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/common/validation-error.factory.spec.ts`:

```ts
import { BadRequestException, ValidationError } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { flattenToFieldErrors, validationExceptionFactory } from './validation-error.factory';

function error(property: string, constraints?: Record<string, string>, children: ValidationError[] = []): ValidationError {
  return { property, constraints, children } as ValidationError;
}

describe('flattenToFieldErrors', () => {
  it('keys a top-level failure on its property name', () => {
    const result = flattenToFieldErrors([
      error('name', { isLength: 'name must be longer than or equal to 1 characters' }),
    ]);

    expect(result).toEqual({
      name: ['name must be longer than or equal to 1 characters'],
    });
  });

  it('collects every constraint on one property', () => {
    const result = flattenToFieldErrors([
      error('defaultAmount', {
        isPositive: 'defaultAmount must be a positive number',
        max: 'defaultAmount must not be greater than 9999999999.99',
      }),
    ]);

    expect(result.defaultAmount).toHaveLength(2);
  });

  it('keys a nested failure on its dotted path', () => {
    const result = flattenToFieldErrors([
      error('profile', undefined, [
        error('email', { isEmail: 'email must be an email' }),
      ]),
    ]);

    expect(result).toEqual({ 'profile.email': ['email must be an email'] });
  });

  it('keys a doubly nested failure on its full dotted path', () => {
    const result = flattenToFieldErrors([
      error('a', undefined, [error('b', undefined, [error('c', { isInt: 'c must be an integer' })])]),
    ]);

    expect(result).toEqual({ 'a.b.c': ['c must be an integer'] });
  });

  it('omits a property that only carries children, with no constraints of its own', () => {
    const result = flattenToFieldErrors([
      error('profile', undefined, [error('email', { isEmail: 'email must be an email' })]),
    ]);

    expect(result).not.toHaveProperty('profile');
  });
});

describe('validationExceptionFactory', () => {
  it('produces a 400 carrying both the flat message array and the field map', () => {
    const exception = validationExceptionFactory([
      error('name', { isLength: 'name must be longer than or equal to 1 characters' }),
    ]);

    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.getStatus()).toBe(400);
    expect(exception.getResponse()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: ['name must be longer than or equal to 1 characters'],
      errors: { name: ['name must be longer than or equal to 1 characters'] },
    });
  });

  it('orders the message array parent-first, matching what Nest produced before', () => {
    const exception = validationExceptionFactory([
      error('a', { x: 'a failed' }, [error('b', { y: 'b failed' })]),
      error('c', { z: 'c failed' }),
    ]);

    const body = exception.getResponse() as { message: string[] };
    expect(body.message).toEqual(['a failed', 'b failed', 'c failed']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx nx test api -- validation-error.factory`
Expected: FAIL — cannot resolve `./validation-error.factory`.

- [ ] **Step 3: Write the factory**

Create `apps/api/src/common/validation-error.factory.ts`:

```ts
import { BadRequestException, HttpStatus, ValidationError } from '@nestjs/common';

/**
 * Turns class-validator's nested `ValidationError[]` into a flat map keyed on
 * the dotted property path.
 *
 * Nest's own `ValidationPipe` already flattens these, but only to a
 * `string[]` — the structure that says *which field* failed is computed and
 * then discarded. Recovering it in the client means matching each sentence
 * against a leading property name, which works only for as long as every
 * message happens to start with one. A single `{ message: '...' }` override
 * on any decorator breaks that silently: the message still renders in the
 * form-level banner, so nothing looks wrong.
 *
 * A property contributes a key only when it has constraints of its own. A
 * parent that merely holds failing children is a path segment, not a field,
 * and no form control is bound to it.
 */
export function flattenToFieldErrors(
  errors: ValidationError[],
  parentPath = '',
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    const messages = Object.values(error.constraints ?? {});

    if (messages.length > 0) {
      result[path] = [...(result[path] ?? []), ...messages];
    }

    for (const [childPath, childMessages] of Object.entries(
      flattenToFieldErrors(error.children ?? [], path),
    )) {
      result[childPath] = [...(result[childPath] ?? []), ...childMessages];
    }
  }

  return result;
}

/**
 * The `exceptionFactory` for the global `ValidationPipe`.
 *
 * `message` keeps the shape, content, and order Nest's default factory
 * produced — parent messages before their children's, in declaration order —
 * so every existing assertion against a 400 body continues to pass. `errors`
 * is additive.
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const fieldErrors = flattenToFieldErrors(errors);

  return new BadRequestException({
    statusCode: HttpStatus.BAD_REQUEST,
    error: 'Bad Request',
    message: Object.values(fieldErrors).flat(),
    errors: fieldErrors,
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx nx test api -- validation-error.factory`
Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing filter test**

The filter currently rebuilds every object-bodied `HttpException` into
exactly five keys, so an `errors` map would be dropped on the floor.

Append to `apps/api/src/common/filters/all-exceptions.filter.spec.ts`:

```ts
describe('AllExceptionsFilter and field errors', () => {
  it('carries a field-error map through instead of discarding it', () => {
    const { host, status, json } = hostFor('/api/bills');
    const exception = new HttpException(
      {
        statusCode: 400,
        error: 'Bad Request',
        message: ['name should not be empty'],
        errors: { name: ['name should not be empty'] },
      },
      HttpStatus.BAD_REQUEST,
    );

    new AllExceptionsFilter().catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const body = json.mock.calls[0][0] as ErrorResponseBody & {
      errors?: Record<string, string[]>;
    };
    expect(body.errors).toEqual({ name: ['name should not be empty'] });
    expect(body.message).toEqual(['name should not be empty']);
    expect(body.path).toBe('/api/bills');
  });

  it('omits the errors key entirely when the exception carries none', () => {
    const { host, json } = hostFor();
    new AllExceptionsFilter().catch(new HttpException('Nope', HttpStatus.BAD_REQUEST), host);

    expect(json.mock.calls[0][0]).not.toHaveProperty('errors');
  });

  it('ignores an errors value that is not a map of string arrays', () => {
    const { host, json } = hostFor();
    const exception = new HttpException(
      { statusCode: 400, error: 'Bad Request', message: 'nope', errors: 'not a map' },
      HttpStatus.BAD_REQUEST,
    );

    new AllExceptionsFilter().catch(exception, host);

    expect(json.mock.calls[0][0]).not.toHaveProperty('errors');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx nx test api -- all-exceptions.filter`
Expected: FAIL on the first of the three — `body.errors` is `undefined`,
because the filter rebuilds the body from five fixed keys.

- [ ] **Step 7: Modify the filter**

In `apps/api/src/common/filters/all-exceptions.filter.ts`, add this helper
above the class:

```ts
function isFieldErrorMap(value: unknown): value is Record<string, string[]> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(
      (messages) => Array.isArray(messages) && messages.every((m) => typeof m === 'string'),
    )
  );
}
```

Inside `catch`, declare alongside `passthroughBody`:

```ts
let fieldErrors: Record<string, string[]> | undefined;
```

In the `else` branch that already reads `record.message` and `record.error`,
add a third line after them:

```ts
if (isFieldErrorMap(record.errors)) fieldErrors = record.errors;
```

Replace the final `response.status(...).json(...)` call with:

```ts
response.status(status).json(
  passthroughBody ?? {
    statusCode: status,
    error,
    message,
    ...(fieldErrors ? { errors: fieldErrors } : {}),
    path: request.url,
    timestamp: new Date().toISOString(),
  },
);
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx nx test api -- all-exceptions.filter`
Expected: PASS, including the three new cases and every pre-existing one.

- [ ] **Step 9: Wire the factory into the global pipe**

In `apps/api/src/app/configure-app.ts`, add the import:

```ts
import { validationExceptionFactory } from '../common/validation-error.factory';
```

and change the `useGlobalPipes` call to:

```ts
app.useGlobalPipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: false,
    exceptionFactory: validationExceptionFactory,
  }),
);
```

Leave the surrounding doc comment and every other line of the function
alone.

- [ ] **Step 10: Write the failing end-to-end test**

Create `apps/api/test/validation-errors.e2e-spec.ts`:

```ts
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

    const res = await request(app.getHttpServer())
      .post('/api/bills')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '', defaultAmount: -5, frequency: 'FORTNIGHTLY', startDate: 'not-a-date' })
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
```

- [ ] **Step 11: Run the end-to-end test**

Run: `npx nx test-e2e api -- validation-errors`
Expected: PASS, 4 tests. The database must be up; do not start or stop it
destructively.

- [ ] **Step 12: Add the error contracts to shared-types**

Create `libs/shared-types/src/lib/error.contracts.ts`:

```ts
/** The envelope every API failure uses — foundation spec §10. */
export interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/**
 * A `ValidationPipe` failure. `errors` is keyed on the dotted property path
 * so a client can attach each message to the control that produced it.
 *
 * Only pipe failures carry `errors`. A 400 raised by a service — a
 * `categoryId` naming another user's category, for instance — is an
 * `ErrorResponse` with no field information at all.
 */
export interface ValidationErrorResponse extends ErrorResponse {
  message: string[];
  errors: Record<string, string[]>;
}
```

Add to `libs/shared-types/src/index.ts`, after the existing exports:

```ts
export * from './lib/error.contracts.js';
```

The `.js` suffix is required: this library compiles under
`moduleResolution: nodenext`.

- [ ] **Step 13: Verify nothing regressed**

Run: `npx nx run-many -t test lint typecheck build --skip-nx-cache`
Expected: all targets succeed.

Run: `npx nx test-e2e api --skip-nx-cache`
Expected: every pre-existing e2e test still passes. The `message` array
kept its shape, so no assertion against a 400 body should have moved.

- [ ] **Step 14: Prove the nested recursion is actually tested**

Temporarily delete the `for (const [childPath, childMessages] of ...)` loop
from `flattenToFieldErrors`.

Run: `npx nx test api -- validation-error.factory`
Expected: FAIL — the two nested-path tests and the ordering test.

Restore the loop and re-run. Expected: PASS. This step changes no
committed code; it proves the tests can fail.

- [ ] **Step 15: Commit**

```bash
git add apps/api/src/common/validation-error.factory.ts \
        apps/api/src/common/validation-error.factory.spec.ts \
        apps/api/src/common/filters/all-exceptions.filter.ts \
        apps/api/src/common/filters/all-exceptions.filter.spec.ts \
        apps/api/src/app/configure-app.ts \
        apps/api/test/validation-errors.e2e-spec.ts \
        libs/shared-types/src/lib/error.contracts.ts \
        libs/shared-types/src/index.ts
git commit -m "feat(api): key validation failures on the field that caused them"
```

---

## Task 2: Scaffold `apps/web`, and prove the three integration risks are dead

Spec §3.1, §4, §13. This task exists to make three risks fail now rather
than at task twelve: that Angular's bundler can resolve
`@bill-tracker/shared-types` through its `nodenext` exports map, that
Material renders under zoneless change detection, and that the generated
`test` target participates in the workspace's existing `nx run-many`.

The generator's exact output is not predictable from here. The steps below
run it and then assert the end state; where the generator's choice differs
from what is specified, the specified value wins.

**Files:**
- Modify: `package.json`, `package-lock.json` — the pinned plugin install
- Create: `apps/web/**` (generated), `apps/web-e2e/**` (generated)
- Create: `apps/web/src/app/core/README.md`
- Modify: `apps/web/src/app/app.config.ts`
- Modify: `apps/web/src/app/app.ts` and `apps/web/src/app/app.html`
- Modify: `apps/web/src/styles.scss`
- Modify: `apps/web/tsconfig.json`, `apps/web/tsconfig.app.json`, `apps/web/tsconfig.spec.json`
- Modify: `tsconfig.json` (root)
- Test: `apps/web/src/app/app.spec.ts`

**Interfaces:**
- Consumes: `BILL_FREQUENCIES` and `ValidationErrorResponse` from `@bill-tracker/shared-types` (Task 1).
- Produces: the `web` and `web-e2e` Nx projects; `apps/web/src/app/app.config.ts` exporting `appConfig: ApplicationConfig`; `apps/web/src/app/app.routes.ts` exporting `routes: Routes`.

- [ ] **Step 1: Install the Nx Angular plugin, pinned**

```bash
npm install -D @nx/angular@23.2.0 @nx/playwright@23.2.0
```

Install before generating, not during. `nx g` on a plugin that is not
present offers to fetch it, and what it fetches is the latest — 23.2.1 —
which breaks the Global Constraint that every `@nx/*` package sits at
23.2.0. Pinning here makes the version a decision rather than a default.

- [ ] **Step 2: Generate the application**

```bash
npx nx g @nx/angular:application web \
  --directory=apps/web \
  --style=scss \
  --bundler=esbuild \
  --zoneless \
  --standalone \
  --routing \
  --unitTestRunner=vitest-angular \
  --e2eTestRunner=playwright \
  --linter=oxlint \
  --formatter=prettier \
  --backendProject=api \
  --port=4200 \
  --prefix=app \
  --no-interactive
```

- [ ] **Step 3: Install Material and the CDK**

```bash
npm install @angular/material@22.2.1 @angular/cdk@22.2.1
```

Pin both to 22.2.1 exactly, matching `@angular/core`.

- [ ] **Step 4: Report what the generator produced**

Run and read the output; later steps correct whatever differs:

```bash
npx nx show project web --json
ls apps/web/src/app
cat apps/web/src/app/app.config.ts
cat apps/web/tsconfig.json apps/web/tsconfig.app.json
git status --porcelain
```

Record in the task report: the project's target names, whether `test`
exists, and whether `proxy.conf.json` was written.

- [ ] **Step 5: Fix the TypeScript wiring**

`tsconfig.base.json` sets `"lib": ["es2022"]` with no `dom`, because the
API has no business seeing DOM types. **Do not change the base file.**

In `apps/web/tsconfig.app.json` and `apps/web/tsconfig.spec.json`, ensure
`compilerOptions` contains:

```json
"lib": ["es2022", "dom", "dom.iterable"]
```

In `apps/web/tsconfig.json`, ensure a project reference to the shared
library exists:

```json
"references": [
  { "path": "./tsconfig.app.json" },
  { "path": "./tsconfig.spec.json" },
  { "path": "../../libs/shared-types" }
]
```

In the root `tsconfig.json`, add `apps/web` to `references`, after
`apps/api`:

```json
{ "path": "./apps/web" }
```

- [ ] **Step 6: Write the Material theme**

Replace `apps/web/src/styles.scss` with:

```scss
@use '@angular/material' as mat;

html {
  @include mat.theme(
    (
      color: (
        primary: mat.$azure-palette,
        tertiary: mat.$blue-palette,
      ),
      typography: Roboto,
      density: 0,
    )
  );

  color-scheme: light dark;
}

html,
body {
  height: 100%;
}

body {
  margin: 0;
  font-family: Roboto, 'Helvetica Neue', sans-serif;
  background: var(--mat-sys-surface);
  color: var(--mat-sys-on-surface);
}
```

- [ ] **Step 7: Write the application config**

Replace `apps/web/src/app/app.config.ts` with:

```ts
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withFetch, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withFetch(), withInterceptors([])),
  ],
};
```

The interceptor array is empty on purpose — Task 6 fills it. The date
adapter providers arrive in Task 4 and the app initializer in Task 6; this
file is edited three more times and each edit is additive.

- [ ] **Step 8: Write the failing smoke test**

This test is the whole point of the task. It renders a Material component
under zoneless change detection, driven by a runtime value imported from
`@bill-tracker/shared-types`. If the exports map does not resolve, it
fails at build. If zoneless and Material disagree, it fails at render.

Replace `apps/web/src/app/app.spec.ts` with:

```ts
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { describe, expect, it } from 'vitest';
import { BILL_FREQUENCIES } from '@bill-tracker/shared-types';
import { App } from './app';

describe('App', () => {
  it('renders one Material chip per bill frequency, proving the shared library resolves at runtime', async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();

    const chips = fixture.nativeElement.querySelectorAll('mat-chip');
    expect(chips).toHaveLength(BILL_FREQUENCIES.length);
    expect(chips[0].textContent?.trim()).toBe('ONE_TIME');
  });

  it('types a value against the error contract added in task 1', () => {
    // A compile-time assertion with a runtime witness: if the contract is
    // not exported, this file does not build.
    const body: import('@bill-tracker/shared-types').ValidationErrorResponse = {
      statusCode: 400,
      error: 'Bad Request',
      message: ['name should not be empty'],
      errors: { name: ['name should not be empty'] },
      path: '/api/bills',
      timestamp: '2026-10-06T00:00:00.000Z',
    };

    expect(body.errors['name']).toHaveLength(1);
  });
});
```

- [ ] **Step 9: Run the test to verify it fails**

Run: `npx nx test web`
Expected: FAIL — `App` renders the generator's placeholder markup, so no
`mat-chip` elements exist.

- [ ] **Step 10: Write the component**

Replace `apps/web/src/app/app.ts` with:

```ts
import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { MatChipsModule } from '@angular/material/chips';
import { BILL_FREQUENCIES } from '@bill-tracker/shared-types';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, MatChipsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  /**
   * Temporary scaffolding, replaced by the shell in task 7. It exists so
   * that one commit proves the three things most likely to go wrong later:
   * that the bundler resolves `@bill-tracker/shared-types` through its
   * `nodenext` exports map, that Material renders without zone.js, and
   * that `nx test web` runs at all.
   */
  protected readonly frequencies = signal([...BILL_FREQUENCIES]);
}
```

Replace `apps/web/src/app/app.html` with:

```html
<mat-chip-set aria-label="Bill frequencies">
  @for (frequency of frequencies(); track frequency) {
    <mat-chip>{{ frequency }}</mat-chip>
  }
</mat-chip-set>

<router-outlet />
```

- [ ] **Step 11: Run the test to verify it passes**

Run: `npx nx test web`
Expected: PASS, 2 tests.

- [ ] **Step 12: Verify the whole workspace still agrees**

```bash
npx nx run-many -t lint typecheck build test --skip-nx-cache
```

Expected: `Successfully ran targets lint, typecheck, build, test for 3
projects`. If `web` is missing from any target's project list, the
generator did not create it under a name the plugin infers — fix the
project's `package.json` `nx.targets` rather than disabling the check, and
record what was wrong in the task report.

- [ ] **Step 13: Verify the development proxy exists**

Run: `cat apps/web/proxy.conf.json`
Expected: a mapping for `/api` to `http://localhost:3000`. If the file is
absent, create it:

```json
{
  "/api": {
    "target": "http://localhost:3000",
    "secure": false
  }
}
```

and reference it from the `serve` target's options as
`"proxyConfig": "apps/web/proxy.conf.json"`.

This keeps the browser on one origin in development, which is what makes
the refresh cookie first-party and `SameSite=Lax` behave as foundation
spec §7 describes.

Do not start the dev server as part of this step. Nothing in this plan
leaves a server process running.

- [ ] **Step 14: Prove the smoke test can fail**

Temporarily change `BILL_FREQUENCIES` in the import to a locally declared
`const BILL_FREQUENCIES = ['ONE_TIME'] as const;` in `app.ts`.

Run: `npx nx test web`
Expected: FAIL on the chip count.

Restore the import and re-run. Expected: PASS. Without this step the test
would still pass if the shared library quietly resolved to nothing.

- [ ] **Step 15: Commit**

```bash
git add apps/web apps/web-e2e tsconfig.json package.json package-lock.json nx.json
git commit -m "feat(web): scaffold the zoneless Angular application

Renders a Material component from a runtime value imported through the
shared library's nodenext exports map, so the three integration risks —
module resolution, zoneless Material, and target inference — fail here
rather than at the end of the plan."
```

---

## Task 3: The calendar-date module

Spec §8.1. Pure arithmetic over `YYYY-MM-DD` strings, with exactly one
`Date` in the file and it formats rather than parses.

**Files:**
- Create: `apps/web/src/app/core/date/calendar-date.ts`
- Create: `apps/web/src/app/core/date/calendar-date.spec.ts`
- Create: `apps/web/src/app/core/date/calendar-date.pipe.ts`
- Create: `apps/web/src/app/core/date/calendar-date.pipe.spec.ts`

**Interfaces:**
- Consumes: nothing.
- Produces, all from `core/date/calendar-date.ts`:
  - `type CalendarDate = string`
  - `isCalendarDate(value: unknown): value is CalendarDate`
  - `today(): CalendarDate`
  - `parts(date: CalendarDate): { year: number; month: number; day: number }` — month is 1-12
  - `fromParts(year: number, month: number, day: number): CalendarDate` — month 1-12, day clamped into the month
  - `daysInMonth(year: number, month: number): number`
  - `addDays(date: CalendarDate, days: number): CalendarDate`
  - `addMonths(date: CalendarDate, months: number): CalendarDate`
  - `addYears(date: CalendarDate, years: number): CalendarDate`
  - `startOfMonth(date: CalendarDate): CalendarDate`
  - `endOfMonth(date: CalendarDate): CalendarDate`
  - `compare(a: CalendarDate, b: CalendarDate): number`
  - `daysBetween(from: CalendarDate, to: CalendarDate): number`
  - `dayOfWeek(date: CalendarDate): number` — 0 is Sunday
  - `MONTH_NAMES_LONG`, `MONTH_NAMES_SHORT`, `MONTH_NAMES_NARROW`, `DAY_NAMES_LONG`, `DAY_NAMES_SHORT`, `DAY_NAMES_NARROW`: `readonly string[]`
  - and from `core/date/calendar-date.pipe.ts`: `CalendarDatePipe`, standalone, name `calendarDate`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/core/date/calendar-date.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  addYears,
  compare,
  dayOfWeek,
  daysBetween,
  daysInMonth,
  endOfMonth,
  fromParts,
  isCalendarDate,
  parts,
  startOfMonth,
  today,
} from './calendar-date';

describe('isCalendarDate', () => {
  it.each(['2026-10-06', '2000-02-29', '1999-12-31'])('accepts %s', (value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  it.each([
    ['2026-02-31', 'a day that does not exist in that month'],
    ['2026-13-01', 'a month past December'],
    ['2026-00-01', 'a zero month'],
    ['2026-10-00', 'a zero day'],
    ['20261006', 'ISO 8601 basic format, which new Date() cannot parse'],
    ['2026-10-6', 'an unpadded day'],
    ['2026-10-06T00:00:00Z', 'a timestamp'],
    ['', 'the empty string'],
  ])('rejects %s — %s', (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });

  it.each([null, undefined, 20261006, new Date(), {}])('rejects the non-string %s', (value) => {
    expect(isCalendarDate(value)).toBe(false);
  });

  it('accepts 2024-02-29 and rejects 2026-02-29, so leap years are real', () => {
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('2026-02-29')).toBe(false);
  });
});

describe('parts and fromParts', () => {
  it('splits a date into one-based month and day', () => {
    expect(parts('2026-10-06')).toEqual({ year: 2026, month: 10, day: 6 });
  });

  it('pads single digits when building', () => {
    expect(fromParts(2026, 1, 6)).toBe('2026-01-06');
  });

  it('clamps a day past the end of its month', () => {
    expect(fromParts(2026, 2, 31)).toBe('2026-02-28');
  });

  it('round-trips every date it produces', () => {
    const date = fromParts(2026, 7, 4);
    expect(fromParts(parts(date).year, parts(date).month, parts(date).day)).toBe(date);
  });
});

describe('daysInMonth', () => {
  it.each([
    [2026, 1, 31],
    [2026, 2, 28],
    [2024, 2, 29],
    [2000, 2, 29],
    [1900, 2, 28],
    [2026, 4, 30],
    [2026, 12, 31],
  ])('%i-%i has %i days', (year, month, expected) => {
    expect(daysInMonth(year, month)).toBe(expected);
  });
});

describe('addDays', () => {
  it('crosses a month boundary', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('crosses a year boundary', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('crosses a leap day', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
    expect(addDays('2024-02-28', 2)).toBe('2024-03-01');
  });

  it('skips the leap day in a common year', () => {
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  });

  it('goes backwards', () => {
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('adds a full common year', () => {
    expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
  });
});

describe('addMonths', () => {
  it('clamps onto a shorter month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('clamps from the anchor rather than the previous result, so there is no drift', () => {
    // The whole point. Two single-month steps from January 31 would land
    // on March 28; one two-month step must land on March 31.
    expect(addMonths('2026-01-31', 2)).toBe('2026-03-31');
  });

  it('clamps to 29 in a leap February', () => {
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('crosses a year boundary', () => {
    expect(addMonths('2026-11-15', 3)).toBe('2027-02-15');
  });

  it('goes backwards across a year boundary', () => {
    expect(addMonths('2026-02-15', -3)).toBe('2025-11-15');
  });

  it('handles twelve months as exactly one year', () => {
    expect(addMonths('2026-06-15', 12)).toBe('2027-06-15');
  });
});

describe('addYears', () => {
  it('clamps February 29 onto a common year', () => {
    expect(addYears('2024-02-29', 1)).toBe('2025-02-28');
  });

  it('leaves an ordinary date alone', () => {
    expect(addYears('2026-06-15', 2)).toBe('2028-06-15');
  });
});

describe('startOfMonth and endOfMonth', () => {
  it('finds the first of the month', () => {
    expect(startOfMonth('2026-10-06')).toBe('2026-10-01');
  });

  it('finds the last of a 31-day month', () => {
    expect(endOfMonth('2026-10-06')).toBe('2026-10-31');
  });

  it('finds the last of a leap February', () => {
    expect(endOfMonth('2024-02-10')).toBe('2024-02-29');
  });
});

describe('compare', () => {
  it('orders earlier before later', () => {
    expect(compare('2026-01-01', '2026-01-02')).toBeLessThan(0);
    expect(compare('2026-01-02', '2026-01-01')).toBeGreaterThan(0);
    expect(compare('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('sorts a list correctly, including across years', () => {
    const sorted = ['2027-01-01', '2026-12-31', '2026-02-01'].sort(compare);
    expect(sorted).toEqual(['2026-02-01', '2026-12-31', '2027-01-01']);
  });
});

describe('daysBetween', () => {
  it('counts a single day', () => {
    expect(daysBetween('2026-10-06', '2026-10-07')).toBe(1);
  });

  it('counts zero for the same day', () => {
    expect(daysBetween('2026-10-06', '2026-10-06')).toBe(0);
  });

  it('returns a negative count when the range runs backwards', () => {
    expect(daysBetween('2026-10-07', '2026-10-06')).toBe(-1);
  });

  it('counts a leap year as 366 days', () => {
    expect(daysBetween('2024-01-01', '2025-01-01')).toBe(366);
  });
});

describe('dayOfWeek', () => {
  it.each([
    ['2026-10-04', 0, 'Sunday'],
    ['2026-10-05', 1, 'Monday'],
    ['2026-10-10', 6, 'Saturday'],
    ['1970-01-01', 4, 'Thursday — the epoch, which the arithmetic is anchored on'],
  ])('%s is %i (%s)', (date, expected) => {
    expect(dayOfWeek(date)).toBe(expected);
  });
});

describe('today', () => {
  it('returns a value its own validator accepts', () => {
    expect(isCalendarDate(today())).toBe(true);
  });

  it('agrees with Intl for the current instant', () => {
    expect(today()).toBe(new Intl.DateTimeFormat('en-CA').format(new Date()));
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx nx test web --include='**/calendar-date.spec.ts'`
Expected: FAIL — cannot resolve `./calendar-date`.

- [ ] **Step 3: Write the module**

Create `apps/web/src/app/core/date/calendar-date.ts`:

```ts
/**
 * A calendar day as the API sends it: `YYYY-MM-DD`, no time, no zone.
 *
 * Every function here operates on the string directly. **No value from the
 * API is ever passed to `new Date()`** — doing so parses it as UTC midnight
 * and renders it in local time, moving the date backwards for everyone west
 * of Greenwich. That is the off-by-one the API's own date handling exists to
 * avoid, and reintroducing it in the browser would undo that work.
 *
 * The day arithmetic uses Howard Hinnant's civil-calendar algorithms, which
 * convert between a civil date and a day count using integer arithmetic
 * only. They are exact for every proleptic Gregorian date and never touch a
 * time zone.
 */
export type CalendarDate = string;

const PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const MONTH_NAMES_LONG: readonly string[] = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export const MONTH_NAMES_SHORT: readonly string[] = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

export const MONTH_NAMES_NARROW: readonly string[] = [
  'J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D',
];

export const DAY_NAMES_LONG: readonly string[] = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

export const DAY_NAMES_SHORT: readonly string[] = [
  'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat',
];

export const DAY_NAMES_NARROW: readonly string[] = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

export function isCalendarDate(value: unknown): value is CalendarDate {
  if (typeof value !== 'string' || !PATTERN.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12) return false;
  return day >= 1 && day <= daysInMonth(year, month);
}

export function parts(date: CalendarDate): { year: number; month: number; day: number } {
  return {
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
    day: Number(date.slice(8, 10)),
  };
}

export function fromParts(year: number, month: number, day: number): CalendarDate {
  const clamped = Math.min(day, daysInMonth(year, month));
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(clamped).padStart(2, '0')}`;
}

/** Days since 1970-01-01. Hinnant's `days_from_civil`. */
function toDayNumber(date: CalendarDate): number {
  const { month, day } = parts(date);
  let { year } = parts(date);
  year -= month <= 2 ? 1 : 0;
  const era = Math.floor(year / 400);
  const yearOfEra = year - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

/** The inverse. Hinnant's `civil_from_days`. */
function fromDayNumber(dayNumber: number): CalendarDate {
  const z = dayNumber + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthPrime = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthPrime + 2) / 5) + 1;
  const month = monthPrime + (monthPrime < 10 ? 3 : -9);
  const year = yearOfEra + era * 400 + (month <= 2 ? 1 : 0);
  return fromParts(year, month, day);
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromDayNumber(toDayNumber(date) + days);
}

/**
 * Adds whole months, clamping onto the end of a shorter month.
 *
 * The clamp reads the day from the **anchor**, never from an intermediate
 * result, so `addMonths('2026-01-31', 2)` is `2026-03-31` and not
 * `2026-03-28`. Stepping one month at a time would lose the 31 at February
 * and never recover it — the same drift the API's generator avoids.
 */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const { year, month, day } = parts(date);
  const total = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(total / 12);
  const targetMonth = total - targetYear * 12 + 1;
  return fromParts(targetYear, targetMonth, day);
}

export function addYears(date: CalendarDate, years: number): CalendarDate {
  return addMonths(date, years * 12);
}

export function startOfMonth(date: CalendarDate): CalendarDate {
  const { year, month } = parts(date);
  return fromParts(year, month, 1);
}

export function endOfMonth(date: CalendarDate): CalendarDate {
  const { year, month } = parts(date);
  return fromParts(year, month, daysInMonth(year, month));
}

/** Lexicographic comparison is correct for zero-padded ISO dates. */
export function compare(a: CalendarDate, b: CalendarDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return toDayNumber(to) - toDayNumber(from);
}

/** 0 is Sunday. 1970-01-01 was a Thursday, hence the offset of 4. */
export function dayOfWeek(date: CalendarDate): number {
  return (((toDayNumber(date) + 4) % 7) + 7) % 7;
}

/**
 * The current calendar day in the browser's own time zone.
 *
 * This is the only `Date` in the module, and it **formats** the current
 * instant rather than parsing a stored string. `en-CA` is used because its
 * short date format is `YYYY-MM-DD`.
 *
 * Note what this is not for: deciding whether a bill is overdue. That is
 * derived server-side against `APP_TIMEZONE` and arrives on the instance.
 */
export function today(): CalendarDate {
  return new Intl.DateTimeFormat('en-CA').format(new Date());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx nx test web --include='**/calendar-date.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Run the suite under a non-UTC time zone**

Run: `TZ=America/New_York npx nx test web --skip-nx-cache --include='**/calendar-date.spec.ts'`
Then: `TZ=Pacific/Kiritimati npx nx test web --skip-nx-cache --include='**/calendar-date.spec.ts'`
Then: `TZ=Pacific/Pago_Pago npx nx test web --skip-nx-cache --include='**/calendar-date.spec.ts'`

Expected: PASS in all three. Kiritimati is UTC+14 and Pago Pago is UTC-11;
together they straddle every date boundary a browser can sit on. A failure
here means a `Date` crept into the arithmetic.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/core/date/calendar-date.ts apps/web/src/app/core/date/calendar-date.spec.ts
git commit -m "feat(web): add calendar-date arithmetic over YYYY-MM-DD strings"
```

- [ ] **Step 7: Write the failing pipe test**

Create `apps/web/src/app/core/date/calendar-date.pipe.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CalendarDatePipe } from './calendar-date.pipe';

const pipe = new CalendarDatePipe();

describe('CalendarDatePipe', () => {
  it('formats medium by default', () => {
    expect(pipe.transform('2026-10-06')).toBe('Oct 6, 2026');
  });

  it('formats long with the weekday', () => {
    expect(pipe.transform('2026-10-06', 'long')).toBe('Tuesday, October 6, 2026');
  });

  it('formats short without the year', () => {
    expect(pipe.transform('2026-10-06', 'short')).toBe('Oct 6');
  });

  it('does not pad the day, so it reads like prose', () => {
    expect(pipe.transform('2026-10-06')).not.toContain('06,');
  });

  it('returns an empty string for null', () => {
    expect(pipe.transform(null)).toBe('');
  });

  it('returns the input unchanged when it is not a calendar date', () => {
    // A malformed value should be visible, not silently rendered as some
    // other day.
    expect(pipe.transform('20261006')).toBe('20261006');
  });

  it('renders the same string regardless of the host time zone', () => {
    // The real regression guard: a Date-based implementation would move
    // this date by a day in a negative-offset zone.
    expect(pipe.transform('2026-01-01')).toBe('Jan 1, 2026');
    expect(pipe.transform('2026-12-31')).toBe('Dec 31, 2026');
  });
});
```

- [ ] **Step 8: Run the test to verify it fails**

Run: `npx nx test web --include='**/calendar-date.pipe.spec.ts'`
Expected: FAIL — cannot resolve `./calendar-date.pipe`.

- [ ] **Step 9: Write the pipe**

Create `apps/web/src/app/core/date/calendar-date.pipe.ts`:

```ts
import { Pipe, PipeTransform } from '@angular/core';
import {
  CalendarDate,
  DAY_NAMES_LONG,
  MONTH_NAMES_LONG,
  MONTH_NAMES_SHORT,
  dayOfWeek,
  isCalendarDate,
  parts,
} from './calendar-date';

export type CalendarDateFormat = 'short' | 'medium' | 'long';

/**
 * Renders a `CalendarDate` by reading its digits, never by parsing it.
 *
 * Angular's own `DatePipe` would be the obvious choice and is the wrong
 * one: it accepts a `YYYY-MM-DD` string by handing it to the `Date`
 * constructor, which treats it as UTC midnight and then formats it in the
 * host zone — so a due date of the 1st renders as the previous month's
 * last day for anyone behind UTC.
 *
 * A value that is not a calendar date is returned unchanged rather than
 * coerced, so a malformed date is visible instead of silently becoming a
 * different day.
 */
@Pipe({ name: 'calendarDate' })
export class CalendarDatePipe implements PipeTransform {
  transform(value: CalendarDate | null | undefined, format: CalendarDateFormat = 'medium'): string {
    if (value === null || value === undefined) return '';
    if (!isCalendarDate(value)) return String(value);

    const { year, month, day } = parts(value);

    if (format === 'short') return `${MONTH_NAMES_SHORT[month - 1]} ${day}`;
    if (format === 'long') {
      return `${DAY_NAMES_LONG[dayOfWeek(value)]}, ${MONTH_NAMES_LONG[month - 1]} ${day}, ${year}`;
    }
    return `${MONTH_NAMES_SHORT[month - 1]} ${day}, ${year}`;
  }
}
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `TZ=Pacific/Pago_Pago npx nx test web --skip-nx-cache --include='**/calendar-date.pipe.spec.ts'`
Expected: PASS. Running this one under a negative-offset zone is the
point — a `DatePipe`-based implementation fails here and passes under UTC.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/app/core/date/calendar-date.pipe.ts apps/web/src/app/core/date/calendar-date.pipe.spec.ts
git commit -m "feat(web): render calendar dates without parsing them"
```

---

## Task 4: A Material date adapter over `YYYY-MM-DD`

Spec §8.3. The riskiest unit in the plan: twenty-odd small methods, each
wrong in a way that shifts a date by one day. Material's API is **0-based
for months** and the calendar-date module is 1-based, so every conversion
is a place to get it wrong — which is why the tests below check both
directions of every boundary.

**Files:**
- Create: `apps/web/src/app/core/date/calendar-date.adapter.ts`
- Create: `apps/web/src/app/core/date/calendar-date.adapter.spec.ts`
- Modify: `apps/web/src/app/app.config.ts`

**Interfaces:**
- Consumes: everything from `core/date/calendar-date.ts` (Task 3).
- Produces:
  - `CalendarDateAdapter extends DateAdapter<CalendarDate>`, `@Injectable()`
  - `CALENDAR_DATE_FORMATS: MatDateFormats`
  - `INVALID_CALENDAR_DATE: CalendarDate`
  - `provideCalendarDateAdapter(): Provider[]`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/core/date/calendar-date.adapter.spec.ts`:

```ts
import { Component, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CALENDAR_DATE_FORMATS,
  CalendarDateAdapter,
  INVALID_CALENDAR_DATE,
  provideCalendarDateAdapter,
} from './calendar-date.adapter';
import { today } from './calendar-date';

let adapter: CalendarDateAdapter;

beforeEach(() => {
  adapter = new CalendarDateAdapter();
});

describe('component accessors', () => {
  it('reads the year', () => {
    expect(adapter.getYear('2026-10-06')).toBe(2026);
  });

  it('reads the month zero-based, as Material requires', () => {
    // October is 10 in a calendar date and 9 to Material. Getting this
    // backwards shifts every date by a month and nothing else fails.
    expect(adapter.getMonth('2026-10-06')).toBe(9);
    expect(adapter.getMonth('2026-01-06')).toBe(0);
    expect(adapter.getMonth('2026-12-06')).toBe(11);
  });

  it('reads the day of the month one-based', () => {
    expect(adapter.getDate('2026-10-06')).toBe(6);
    expect(adapter.getDate('2026-10-01')).toBe(1);
  });

  it('reads the day of the week with Sunday as zero', () => {
    expect(adapter.getDayOfWeek('2026-10-04')).toBe(0);
    expect(adapter.getDayOfWeek('2026-10-10')).toBe(6);
  });

  it('counts the days in the given month', () => {
    expect(adapter.getNumDaysInMonth('2026-02-10')).toBe(28);
    expect(adapter.getNumDaysInMonth('2024-02-10')).toBe(29);
    expect(adapter.getNumDaysInMonth('2026-10-10')).toBe(31);
  });

  it('names the year', () => {
    expect(adapter.getYearName('2026-10-06')).toBe('2026');
  });

  it('starts the week on Sunday', () => {
    expect(adapter.getFirstDayOfWeek()).toBe(0);
  });
});

describe('name tables', () => {
  it('returns twelve month names in each style, January first', () => {
    const first = { long: 'January', short: 'Jan', narrow: 'J' };
    const last = { long: 'December', short: 'Dec', narrow: 'D' };
    for (const style of ['long', 'short', 'narrow'] as const) {
      const names = adapter.getMonthNames(style);
      expect(names).toHaveLength(12);
      expect(names[0]).toBe(first[style]);
      expect(names[11]).toBe(last[style]);
    }
  });

  it('returns seven day names in each style, Sunday first', () => {
    const first = { long: 'Sunday', short: 'Sun', narrow: 'S' };
    for (const style of ['long', 'short', 'narrow'] as const) {
      const names = adapter.getDayOfWeekNames(style);
      expect(names).toHaveLength(7);
      expect(names[0]).toBe(first[style]);
    }
  });

  it('returns thirty-one date names, "1" first and "31" last', () => {
    const names = adapter.getDateNames();
    expect(names).toHaveLength(31);
    expect(names[0]).toBe('1');
    expect(names[30]).toBe('31');
  });
});

describe('createDate', () => {
  it('takes a zero-based month', () => {
    expect(adapter.createDate(2026, 9, 6)).toBe('2026-10-06');
    expect(adapter.createDate(2026, 0, 1)).toBe('2026-01-01');
  });

  it('builds the last day of a leap February', () => {
    expect(adapter.createDate(2024, 1, 29)).toBe('2024-02-29');
  });

  it('returns an invalid date for a day outside the month', () => {
    expect(adapter.isValid(adapter.createDate(2026, 1, 29))).toBe(false);
  });

  it('returns an invalid date for a month outside the year', () => {
    expect(adapter.isValid(adapter.createDate(2026, 12, 1))).toBe(false);
    expect(adapter.isValid(adapter.createDate(2026, -1, 1))).toBe(false);
  });
});

describe('arithmetic', () => {
  it('adds calendar days across a month boundary', () => {
    expect(adapter.addCalendarDays('2026-01-31', 1)).toBe('2026-02-01');
  });

  it('adds calendar months with an anchored clamp', () => {
    expect(adapter.addCalendarMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(adapter.addCalendarMonths('2026-01-31', 2)).toBe('2026-03-31');
  });

  it('adds calendar years, clamping a leap day', () => {
    expect(adapter.addCalendarYears('2024-02-29', 1)).toBe('2025-02-28');
  });

  it('goes backwards', () => {
    expect(adapter.addCalendarDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(adapter.addCalendarMonths('2026-01-15', -1)).toBe('2025-12-15');
  });
});

describe('validity', () => {
  it('accepts a well-formed calendar date', () => {
    expect(adapter.isValid('2026-10-06')).toBe(true);
  });

  it('rejects the invalid sentinel', () => {
    expect(adapter.isValid(adapter.invalid())).toBe(false);
    expect(adapter.invalid()).toBe(INVALID_CALENDAR_DATE);
  });

  it('rejects a day that does not exist', () => {
    expect(adapter.isValid('2026-02-31')).toBe(false);
  });

  it('treats a well-formed string as a date instance and anything else as not', () => {
    expect(adapter.isDateInstance('2026-10-06')).toBe(true);
    expect(adapter.isDateInstance(new Date())).toBe(false);
    expect(adapter.isDateInstance(20261006)).toBe(false);
    expect(adapter.isDateInstance(null)).toBe(false);
  });
});

describe('parse', () => {
  it('parses the wire format', () => {
    expect(adapter.parse('2026-10-06', 'input')).toBe('2026-10-06');
  });

  it('parses the slash format a user is likely to type', () => {
    expect(adapter.parse('10/6/2026', 'input')).toBe('2026-10-06');
    expect(adapter.parse('10/06/2026', 'input')).toBe('2026-10-06');
  });

  it('returns null for an empty or whitespace value, so clearing a field clears it', () => {
    expect(adapter.parse('', 'input')).toBeNull();
    expect(adapter.parse('   ', 'input')).toBeNull();
    expect(adapter.parse(null, 'input')).toBeNull();
  });

  it('returns the invalid sentinel rather than null for an unparseable value', () => {
    // null means "no date"; invalid means "you typed something wrong".
    // Collapsing the two makes a typo look like an empty field, and the
    // picker silently clears itself instead of showing an error.
    expect(adapter.parse('next tuesday', 'input')).toBe(INVALID_CALENDAR_DATE);
    expect(adapter.parse('20261006', 'input')).toBe(INVALID_CALENDAR_DATE);
    expect(adapter.parse('2026-02-31', 'input')).toBe(INVALID_CALENDAR_DATE);
  });
});

describe('format', () => {
  it.each([
    ['input', '2026-10-06'],
    ['monthYear', 'Oct 2026'],
    ['monthYearA11y', 'October 2026'],
    ['dateA11y', 'Tuesday, October 6, 2026'],
    ['monthNarrow', 'O'],
  ])('formats %s as %s', (format, expected) => {
    expect(adapter.format('2026-10-06', format)).toBe(expected);
  });

  it('returns an empty string for an invalid date rather than throwing', () => {
    expect(adapter.format(INVALID_CALENDAR_DATE, 'input')).toBe('');
  });
});

describe('serialization', () => {
  it('passes a calendar date through toIso8601 unchanged, because it already is one', () => {
    expect(adapter.toIso8601('2026-10-06')).toBe('2026-10-06');
  });

  it('deserializes a wire value', () => {
    expect(adapter.deserialize('2026-10-06')).toBe('2026-10-06');
  });

  it('deserializes null, undefined, and the empty string to null', () => {
    expect(adapter.deserialize(null)).toBeNull();
    expect(adapter.deserialize(undefined)).toBeNull();
    expect(adapter.deserialize('')).toBeNull();
  });

  it('deserializes a malformed value to the invalid sentinel', () => {
    expect(adapter.deserialize('20261006')).toBe(INVALID_CALENDAR_DATE);
  });
});

describe('clone and today', () => {
  it('clones to an equal value, since strings are already immutable', () => {
    expect(adapter.clone('2026-10-06')).toBe('2026-10-06');
  });

  it('agrees with the module own today()', () => {
    expect(adapter.today()).toBe(today());
  });
});

describe('inherited behaviour built on the overrides', () => {
  it('compares dates', () => {
    expect(adapter.compareDate('2026-01-01', '2026-01-02')).toBeLessThan(0);
    expect(adapter.compareDate('2026-01-02', '2026-01-01')).toBeGreaterThan(0);
    expect(adapter.compareDate('2026-01-01', '2026-01-01')).toBe(0);
  });

  it('reports equal dates as the same', () => {
    expect(adapter.sameDate('2026-01-01', '2026-01-01')).toBe(true);
    expect(adapter.sameDate('2026-01-01', '2026-01-02')).toBe(false);
    expect(adapter.sameDate(null, null)).toBe(true);
  });

  it('clamps between a minimum and a maximum', () => {
    expect(adapter.clampDate('2025-06-01', '2026-01-01', '2026-12-31')).toBe('2026-01-01');
    expect(adapter.clampDate('2027-06-01', '2026-01-01', '2026-12-31')).toBe('2026-12-31');
    expect(adapter.clampDate('2026-06-01', '2026-01-01', '2026-12-31')).toBe('2026-06-01');
  });
});

describe('CALENDAR_DATE_FORMATS', () => {
  it('names a format token for every slot the datepicker reads', () => {
    expect(CALENDAR_DATE_FORMATS.parse.dateInput).toBe('input');
    expect(CALENDAR_DATE_FORMATS.display.dateInput).toBe('input');
    expect(CALENDAR_DATE_FORMATS.display.monthLabel).toBe('monthNarrow');
    expect(CALENDAR_DATE_FORMATS.display.monthYearLabel).toBe('monthYear');
    expect(CALENDAR_DATE_FORMATS.display.dateA11yLabel).toBe('dateA11y');
    expect(CALENDAR_DATE_FORMATS.display.monthYearA11yLabel).toBe('monthYearA11y');
  });

  it('uses only tokens that the format method understands', () => {
    const tokens = [
      CALENDAR_DATE_FORMATS.parse.dateInput,
      ...Object.values(CALENDAR_DATE_FORMATS.display),
    ];
    for (const token of tokens) {
      expect(adapter.format('2026-10-06', token)).not.toBe('');
    }
  });
});

@Component({
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatDatepickerModule],
  template: `
    <mat-form-field>
      <input matInput [matDatepicker]="picker" [formControl]="control" />
      <mat-datepicker #picker />
    </mat-form-field>
  `,
})
class DatepickerHost {
  readonly control = new FormControl<string | null>(null);
}

describe('the datepicker driven by the adapter', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [DatepickerHost],
      providers: [
        provideZonelessChangeDetection(),
        { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
        ...provideCalendarDateAdapter(),
      ],
    });
  });

  it('writes a bare YYYY-MM-DD string into the input, with no Date anywhere', async () => {
    const fixture = TestBed.createComponent(DatepickerHost);
    fixture.componentInstance.control.setValue('2026-10-06');
    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('2026-10-06');
  });

  it('reads a typed value back as a calendar date string', async () => {
    const fixture = TestBed.createComponent(DatepickerHost);
    await fixture.whenStable();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = '10/6/2026';
    input.dispatchEvent(new Event('input'));
    await fixture.whenStable();

    expect(fixture.componentInstance.control.value).toBe('2026-10-06');
    expect(fixture.componentInstance.control.value).not.toBeInstanceOf(Date);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx nx test web --include='**/calendar-date.adapter.spec.ts'`
Expected: FAIL — cannot resolve `./calendar-date.adapter`.

- [ ] **Step 3: Write the adapter**

Create `apps/web/src/app/core/date/calendar-date.adapter.ts`:

```ts
import { Injectable, Provider } from '@angular/core';
import { DateAdapter, MAT_DATE_FORMATS, MatDateFormats } from '@angular/material/core';
import {
  CalendarDate,
  DAY_NAMES_LONG,
  DAY_NAMES_NARROW,
  DAY_NAMES_SHORT,
  MONTH_NAMES_LONG,
  MONTH_NAMES_NARROW,
  MONTH_NAMES_SHORT,
  addDays,
  addMonths,
  addYears,
  dayOfWeek,
  daysInMonth,
  fromParts,
  isCalendarDate,
  parts,
  today,
} from './calendar-date';

/**
 * The value `invalid()` returns. Deliberately not a well-formed date, so
 * `isCalendarDate` rejects it and it can never be mistaken for a real day.
 */
export const INVALID_CALENDAR_DATE: CalendarDate = 'invalid';

const SLASH_FORMAT = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

/**
 * Adapts Angular Material's datepicker to `YYYY-MM-DD` strings.
 *
 * The alternative — `NativeDateAdapter` plus conversion at the form
 * boundary — means a `Date` exists somewhere in the flow, and every such
 * `Date` is a chance to render a due date as the previous day. Adapting the
 * picker itself means no `Date` is ever constructed from a stored value at
 * all.
 *
 * **Material's month is zero-based and a calendar date's is one-based.**
 * Every conversion between the two happens here and nowhere else.
 */
@Injectable()
export class CalendarDateAdapter extends DateAdapter<CalendarDate> {
  getYear(date: CalendarDate): number {
    return parts(date).year;
  }

  getMonth(date: CalendarDate): number {
    return parts(date).month - 1;
  }

  getDate(date: CalendarDate): number {
    return parts(date).day;
  }

  getDayOfWeek(date: CalendarDate): number {
    return dayOfWeek(date);
  }

  getMonthNames(style: 'long' | 'short' | 'narrow'): string[] {
    const table = { long: MONTH_NAMES_LONG, short: MONTH_NAMES_SHORT, narrow: MONTH_NAMES_NARROW };
    return [...table[style]];
  }

  getDateNames(): string[] {
    return Array.from({ length: 31 }, (_, index) => String(index + 1));
  }

  getDayOfWeekNames(style: 'long' | 'short' | 'narrow'): string[] {
    const table = { long: DAY_NAMES_LONG, short: DAY_NAMES_SHORT, narrow: DAY_NAMES_NARROW };
    return [...table[style]];
  }

  getYearName(date: CalendarDate): string {
    return String(parts(date).year);
  }

  getFirstDayOfWeek(): number {
    return 0;
  }

  getNumDaysInMonth(date: CalendarDate): number {
    const { year, month } = parts(date);
    return daysInMonth(year, month);
  }

  clone(date: CalendarDate): CalendarDate {
    return date;
  }

  /** `month` is zero-based, per Material's contract. */
  createDate(year: number, month: number, date: number): CalendarDate {
    if (month < 0 || month > 11) return this.invalid();
    if (date < 1 || date > daysInMonth(year, month + 1)) return this.invalid();
    return fromParts(year, month + 1, date);
  }

  today(): CalendarDate {
    return today();
  }

  /**
   * `null` means "there is no date here"; the invalid sentinel means "you
   * typed something that is not one". Collapsing them would make a typo
   * look like an empty field, and the picker would clear itself instead of
   * reporting an error.
   */
  parse(value: unknown, _parseFormat: unknown): CalendarDate | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    if (text === '') return null;

    if (isCalendarDate(text)) return text;

    const slash = SLASH_FORMAT.exec(text);
    if (slash) {
      const month = Number(slash[1]);
      const day = Number(slash[2]);
      const year = Number(slash[3]);
      if (month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)) {
        return fromParts(year, month, day);
      }
    }

    return this.invalid();
  }

  format(date: CalendarDate, displayFormat: unknown): string {
    if (!this.isValid(date)) return '';
    const { year, month, day } = parts(date);

    switch (displayFormat) {
      case 'monthNarrow':
        return MONTH_NAMES_NARROW[month - 1];
      case 'monthYear':
        return `${MONTH_NAMES_SHORT[month - 1]} ${year}`;
      case 'monthYearA11y':
        return `${MONTH_NAMES_LONG[month - 1]} ${year}`;
      case 'dateA11y':
        return `${DAY_NAMES_LONG[dayOfWeek(date)]}, ${MONTH_NAMES_LONG[month - 1]} ${day}, ${year}`;
      default:
        return date;
    }
  }

  addCalendarYears(date: CalendarDate, years: number): CalendarDate {
    return addYears(date, years);
  }

  addCalendarMonths(date: CalendarDate, months: number): CalendarDate {
    return addMonths(date, months);
  }

  addCalendarDays(date: CalendarDate, days: number): CalendarDate {
    return addDays(date, days);
  }

  /** A calendar date already is an ISO 8601 date. */
  toIso8601(date: CalendarDate): string {
    return date;
  }

  isDateInstance(obj: unknown): boolean {
    return typeof obj === 'string' && isCalendarDate(obj);
  }

  isValid(date: CalendarDate): boolean {
    return isCalendarDate(date);
  }

  invalid(): CalendarDate {
    return INVALID_CALENDAR_DATE;
  }

  override deserialize(value: unknown): CalendarDate | null {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    if (typeof value === 'string' && isCalendarDate(value)) return value;
    return this.invalid();
  }
}

export const CALENDAR_DATE_FORMATS: MatDateFormats = {
  parse: { dateInput: 'input' },
  display: {
    dateInput: 'input',
    monthLabel: 'monthNarrow',
    monthYearLabel: 'monthYear',
    dateA11yLabel: 'dateA11y',
    monthYearA11yLabel: 'monthYearA11y',
  },
};

export function provideCalendarDateAdapter(): Provider[] {
  return [
    { provide: DateAdapter, useClass: CalendarDateAdapter },
    { provide: MAT_DATE_FORMATS, useValue: CALENDAR_DATE_FORMATS },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx nx test web --include='**/calendar-date.adapter.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Run it under a negative-offset time zone**

Run: `TZ=Pacific/Pago_Pago npx nx test web --skip-nx-cache --include='**/calendar-date.adapter.spec.ts'`
Expected: PASS. A `Date`-based adapter renders `2026-10-05` here and
passes under UTC, which is exactly why this run exists.

- [ ] **Step 6: Register the adapter application-wide**

In `apps/web/src/app/app.config.ts`, add the import:

```ts
import { provideCalendarDateAdapter } from './core/date/calendar-date.adapter';
```

and add it as the last entry in the `providers` array:

```ts
...provideCalendarDateAdapter(),
```

- [ ] **Step 7: Prove the two off-by-one conversions are tested**

Temporarily change `getMonth` to `return parts(date).month;`, dropping the
`- 1`.

Run: `npx nx test web --include='**/calendar-date.adapter.spec.ts'`
Expected: FAIL on the zero-based month assertions.

Restore it, then temporarily change `createDate` to call
`fromParts(year, month, date)`, dropping the `+ 1`.

Run again. Expected: FAIL on the `createDate` assertions.

Restore and re-run. Expected: PASS. These two are the most likely defects
in the file and the suite must be able to see each one alone.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/core/date/calendar-date.adapter.ts \
        apps/web/src/app/core/date/calendar-date.adapter.spec.ts \
        apps/web/src/app/app.config.ts
git commit -m "feat(web): adapt the Material datepicker to YYYY-MM-DD strings"
```

---

## Task 5: Typed API clients

Spec §7.1. One thin client per resource, no state. Every request and
response type comes from `@bill-tracker/shared-types`; no client
re-declares a shape.

**Three return shapes are easy to get wrong**, so they are stated here
from the controllers rather than from prose:

| Endpoint | Returns |
|---|---|
| `POST /api/bill-instances/:id/payments` | `PaymentResultResponse` — instance **and** payment |
| `POST /api/bill-instances/:id/payments/:paymentId/reverse` | `PaymentResultResponse` |
| `POST /api/bill-instances/:id/unpay` | `BillInstanceResponse` — **the instance alone, no payment** |

**Files:**
- Create: `apps/web/src/app/core/api/api.constants.ts`
- Create: `apps/web/src/app/core/api/api-error.ts`
- Create: `apps/web/src/app/core/api/api-error.spec.ts`
- Create: `apps/web/src/app/core/auth/auth.tokens.ts`
- Create: `apps/web/src/app/core/api/auth.api.ts`
- Create: `apps/web/src/app/core/api/users.api.ts`
- Create: `apps/web/src/app/core/api/categories.api.ts`
- Create: `apps/web/src/app/core/api/bills.api.ts`
- Create: `apps/web/src/app/core/api/bill-instances.api.ts`
- Create: `apps/web/src/app/core/api/api-clients.spec.ts`

**Interfaces:**
- Consumes: `CalendarDate` (Task 3); every contract from `@bill-tracker/shared-types` including `ValidationErrorResponse` (Task 1).
- Produces:
  - `API_BASE = '/api'`
  - `SKIP_AUTH_RETRY: HttpContextToken<boolean>` from `core/auth/auth.tokens.ts` — Task 6 reads it
  - `isValidationErrorResponse(body: unknown): body is ValidationErrorResponse`
  - `errorMessage(error: unknown): string`
  - `AuthApi`, `UsersApi`, `CategoriesApi`, `BillsApi`, `BillInstancesApi` — all `providedIn: 'root'`
  - `BillInstanceQuery` from `core/api/bill-instances.api.ts`

- [ ] **Step 1: Write the failing error-helper test**

Create `apps/web/src/app/core/api/api-error.spec.ts`:

```ts
import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { errorMessage, isValidationErrorResponse } from './api-error';

function httpError(status: number, body: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body, url: '/api/bills' });
}

describe('isValidationErrorResponse', () => {
  it('accepts a pipe failure carrying a field map', () => {
    expect(
      isValidationErrorResponse({
        statusCode: 400,
        error: 'Bad Request',
        message: ['name should not be empty'],
        errors: { name: ['name should not be empty'] },
        path: '/api/bills',
        timestamp: '2026-10-06T00:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('rejects a service-raised 400, which carries no field map at all', () => {
    // The distinction the client branches on. A categoryId naming another
    // user's category is a 400 with no `errors` key, and treating it as a
    // field failure would silently drop its message.
    expect(
      isValidationErrorResponse({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Category not found',
        path: '/api/bills',
        timestamp: '2026-10-06T00:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('rejects a malformed errors value', () => {
    expect(isValidationErrorResponse({ errors: 'nope', message: [] })).toBe(false);
    expect(isValidationErrorResponse({ errors: { name: 'nope' }, message: [] })).toBe(false);
  });

  it('rejects null, undefined, and a string', () => {
    expect(isValidationErrorResponse(null)).toBe(false);
    expect(isValidationErrorResponse(undefined)).toBe(false);
    expect(isValidationErrorResponse('error')).toBe(false);
  });
});

describe('errorMessage', () => {
  it('uses the server message when there is one', () => {
    expect(errorMessage(httpError(409, { message: 'This category is used by 3 bill(s).' }))).toBe(
      'This category is used by 3 bill(s).',
    );
  });

  it('joins a message array into one sentence', () => {
    expect(errorMessage(httpError(400, { message: ['name is required', 'amount must be positive'] }))).toBe(
      'name is required, amount must be positive',
    );
  });

  it('names the offline case rather than showing status 0', () => {
    expect(errorMessage(httpError(0, null))).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
  });

  it('falls back to a readable sentence for a 500 with no body', () => {
    expect(errorMessage(httpError(500, null))).toBe('Something went wrong. Please try again.');
  });

  it('handles a value that is not an HttpErrorResponse at all', () => {
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx nx test web --include='**/api-error.spec.ts'`
Expected: FAIL — cannot resolve `./api-error`.

- [ ] **Step 3: Write the constants, the context token, and the error helper**

Create `apps/web/src/app/core/api/api.constants.ts`:

```ts
/**
 * Every API path is relative. In development the dev server proxies `/api`
 * to port 3000 (`proxy.conf.json`), which keeps the browser on one origin
 * and therefore keeps the refresh cookie first-party — the condition
 * foundation spec §7 relies on when it chooses `SameSite=Lax`.
 */
export const API_BASE = '/api';
```

Create `apps/web/src/app/core/auth/auth.tokens.ts`:

```ts
import { HttpContextToken } from '@angular/common/http';

/**
 * Opts a request out of the interceptor's refresh-and-retry.
 *
 * This is **not** what prevents a retry loop — see
 * `auth.interceptor.ts`, where the structure of `catchError` does that. It
 * exists for one caller: `SessionService.restore()` sets it on its
 * `GET /api/users/me` so that a 401 during boot resolves the session as
 * anonymous instead of starting a second refresh behind the app
 * initializer's back.
 *
 * `HttpContext` is mutable and shared across `clone()`, so the flag
 * survives the interceptor's own cloning, which is the behaviour wanted.
 */
export const SKIP_AUTH_RETRY = new HttpContextToken<boolean>(() => false);
```

Create `apps/web/src/app/core/api/api-error.ts`:

```ts
import { HttpErrorResponse } from '@angular/common/http';
import type { ValidationErrorResponse } from '@bill-tracker/shared-types';

const OFFLINE =
  'Cannot reach the server. Check your connection and try again.';
const FALLBACK = 'Something went wrong. Please try again.';

/**
 * Narrows a response body to a `ValidationPipe` failure.
 *
 * Only pipe failures carry `errors`. A 400 raised by a service — a
 * `categoryId` naming another user's category, for instance — has no field
 * information, so the client branches on the key's presence and never on
 * the status code alone. Getting this wrong drops the service's message
 * on the floor, because nothing would match a control.
 */
export function isValidationErrorResponse(body: unknown): body is ValidationErrorResponse {
  if (typeof body !== 'object' || body === null) return false;
  const errors = (body as { errors?: unknown }).errors;
  if (typeof errors !== 'object' || errors === null || Array.isArray(errors)) return false;
  return Object.values(errors).every(
    (messages) => Array.isArray(messages) && messages.every((m) => typeof m === 'string'),
  );
}

/** The sentence to show a person for any failed request. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return FALLBACK;

  // Status 0 is the browser's way of saying the request never completed:
  // offline, DNS failure, or a blocked request. "Error 0" means nothing to
  // anyone.
  if (error.status === 0) return OFFLINE;

  const message = (error.error as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message !== '') return message;
  if (Array.isArray(message) && message.length > 0) return message.join(', ');

  return FALLBACK;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx nx test web --include='**/api-error.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Write the failing client test**

Create `apps/web/src/app/core/api/api-clients.spec.ts`:

```ts
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SKIP_AUTH_RETRY } from '../auth/auth.tokens';
import { AuthApi } from './auth.api';
import { BillInstancesApi } from './bill-instances.api';
import { BillsApi } from './bills.api';
import { CategoriesApi } from './categories.api';
import { UsersApi } from './users.api';

let http: HttpTestingController;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
  });
  http = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  http.verify();
});

describe('AuthApi', () => {
  it('posts credentials to the login route', () => {
    TestBed.inject(AuthApi).login({ email: 'a@b.c', password: 'hunter22' }).subscribe();
    const req = http.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'a@b.c', password: 'hunter22' });
    req.flush({});
  });

  it('posts an empty body to refresh, since the cookie carries the credential', () => {
    TestBed.inject(AuthApi).refresh().subscribe();
    const req = http.expectOne('/api/auth/refresh');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ accessToken: 'token' });
  });

  it('posts to logout', () => {
    TestBed.inject(AuthApi).logout().subscribe();
    const req = http.expectOne('/api/auth/logout');
    expect(req.request.method).toBe('POST');
    req.flush(null);
  });
});

describe('UsersApi', () => {
  it('reads the profile', () => {
    TestBed.inject(UsersApi).me().subscribe();
    const req = http.expectOne('/api/users/me');
    expect(req.request.method).toBe('GET');
    expect(req.request.context.get(SKIP_AUTH_RETRY)).toBe(false);
    req.flush({});
  });

  it('marks the profile read as retry-exempt when asked', () => {
    TestBed.inject(UsersApi).me({ skipAuthRetry: true }).subscribe();
    const req = http.expectOne('/api/users/me');
    expect(req.request.context.get(SKIP_AUTH_RETRY)).toBe(true);
    req.flush({});
  });

  it('patches the profile', () => {
    TestBed.inject(UsersApi).updateProfile({ name: 'Ada' }).subscribe();
    const req = http.expectOne('/api/users/me');
    expect(req.request.method).toBe('PATCH');
    req.flush({});
  });

  it('patches the password at its own path', () => {
    TestBed.inject(UsersApi)
      .changePassword({ currentPassword: 'old-one-here', newPassword: 'new-one-here' })
      .subscribe();
    const req = http.expectOne('/api/users/me/password');
    expect(req.request.method).toBe('PATCH');
    req.flush(null);
  });
});

describe('CategoriesApi', () => {
  it('lists, creates, updates, and deletes at the right paths and methods', () => {
    const api = TestBed.inject(CategoriesApi);

    api.list().subscribe();
    expect(http.expectOne('/api/categories').request.method).toBe('GET');
    http.verify();

    api.create({ name: 'Insurance' }).subscribe();
    expect(http.expectOne('/api/categories').request.method).toBe('POST');
    http.verify();

    api.update('cat-1', { name: 'Renamed' }).subscribe();
    expect(http.expectOne('/api/categories/cat-1').request.method).toBe('PATCH');
    http.verify();

    api.remove('cat-1').subscribe();
    expect(http.expectOne('/api/categories/cat-1').request.method).toBe('DELETE');
  });
});

describe('BillsApi', () => {
  it('lists without a query parameter when isActive is omitted', () => {
    TestBed.inject(BillsApi).list().subscribe();
    const req = http.expectOne((r) => r.url === '/api/bills');
    expect(req.request.params.has('isActive')).toBe(false);
    req.flush([]);
  });

  it('sends isActive=false, not an omitted parameter', () => {
    // `false` is falsy, and a truthiness check here would silently list
    // every bill instead of only the inactive ones.
    TestBed.inject(BillsApi).list(false).subscribe();
    const req = http.expectOne((r) => r.url === '/api/bills');
    expect(req.request.params.get('isActive')).toBe('false');
    req.flush([]);
  });

  it('creates, reads, updates, and deletes', () => {
    const api = TestBed.inject(BillsApi);

    api.create({ name: 'Rent', defaultAmount: 1200, frequency: 'MONTHLY', startDate: '2026-01-01' }).subscribe();
    expect(http.expectOne('/api/bills').request.method).toBe('POST');
    http.verify();

    api.get('bill-1').subscribe();
    expect(http.expectOne('/api/bills/bill-1').request.method).toBe('GET');
    http.verify();

    api.update('bill-1', { defaultAmount: 1300 }).subscribe();
    expect(http.expectOne('/api/bills/bill-1').request.method).toBe('PATCH');
    http.verify();

    api.remove('bill-1').subscribe();
    expect(http.expectOne('/api/bills/bill-1').request.method).toBe('DELETE');
  });
});

describe('BillInstancesApi', () => {
  it('sends from and to as query parameters', () => {
    TestBed.inject(BillInstancesApi).list({ from: '2026-10-01', to: '2026-10-31' }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/bill-instances');
    expect(req.request.params.get('from')).toBe('2026-10-01');
    expect(req.request.params.get('to')).toBe('2026-10-31');
    req.flush([]);
  });

  it('omits every optional filter that was not supplied', () => {
    TestBed.inject(BillInstancesApi).list({ from: '2026-10-01', to: '2026-10-31' }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/bill-instances');
    expect(req.request.params.has('status')).toBe(false);
    expect(req.request.params.has('overdue')).toBe(false);
    expect(req.request.params.has('billId')).toBe(false);
    req.flush([]);
  });

  it('sends overdue=false rather than dropping it', () => {
    // The API reads overdue=false as the exact negation — "paid, or not
    // yet due". Dropping it would mean "no filter", a different question.
    TestBed.inject(BillInstancesApi)
      .list({ from: '2026-10-01', to: '2026-10-31', overdue: false })
      .subscribe();
    const req = http.expectOne((r) => r.url === '/api/bill-instances');
    expect(req.request.params.get('overdue')).toBe('false');
    req.flush([]);
  });

  it('sends every filter when all are supplied', () => {
    TestBed.inject(BillInstancesApi)
      .list({
        from: '2026-10-01',
        to: '2026-10-31',
        status: 'UNPAID',
        overdue: true,
        billId: 'bill-1',
      })
      .subscribe();
    const req = http.expectOne((r) => r.url === '/api/bill-instances');
    expect(req.request.params.get('status')).toBe('UNPAID');
    expect(req.request.params.get('overdue')).toBe('true');
    expect(req.request.params.get('billId')).toBe('bill-1');
    req.flush([]);
  });

  it('records a payment with an empty body when no amount is given', () => {
    // An empty body means "pay the remaining balance", computed by the
    // server under a row lock. The client must never compute it.
    TestBed.inject(BillInstancesApi).recordPayment('inst-1').subscribe();
    const req = http.expectOne('/api/bill-instances/inst-1/payments');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({});
  });

  it('records a partial payment with the amount it was given', () => {
    TestBed.inject(BillInstancesApi).recordPayment('inst-1', { amount: 40 }).subscribe();
    const req = http.expectOne('/api/bill-instances/inst-1/payments');
    expect(req.request.body).toEqual({ amount: 40 });
    req.flush({});
  });

  it('reverses a payment at its nested path', () => {
    TestBed.inject(BillInstancesApi).reversePayment('inst-1', 'pay-1').subscribe();
    const req = http.expectOne('/api/bill-instances/inst-1/payments/pay-1/reverse');
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('clears payments at the unpay path', () => {
    TestBed.inject(BillInstancesApi).unpay('inst-1').subscribe();
    const req = http.expectOne('/api/bill-instances/inst-1/unpay');
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('lists payments oldest first, as the API returns them', () => {
    TestBed.inject(BillInstancesApi).payments('inst-1').subscribe();
    const req = http.expectOne('/api/bill-instances/inst-1/payments');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx nx test web --include='**/api-clients.spec.ts'`
Expected: FAIL — none of the client modules resolve.

- [ ] **Step 7: Write the clients**

Create `apps/web/src/app/core/api/auth.api.ts`:

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  AuthResponse,
  LoginRequest,
  RefreshResponse,
  RegisterRequest,
} from '@bill-tracker/shared-types';
import { API_BASE } from './api.constants';

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  register(body: RegisterRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${API_BASE}/auth/register`, body);
  }

  login(body: LoginRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${API_BASE}/auth/login`, body);
  }

  /** The refresh token is an httpOnly cookie; there is nothing to send. */
  refresh(): Observable<RefreshResponse> {
    return this.http.post<RefreshResponse>(`${API_BASE}/auth/refresh`, {});
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${API_BASE}/auth/logout`, {});
  }
}
```

Create `apps/web/src/app/core/api/users.api.ts`:

```ts
import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  ChangePasswordRequest,
  UpdateProfileRequest,
  UserProfile,
} from '@bill-tracker/shared-types';
import { SKIP_AUTH_RETRY } from '../auth/auth.tokens';
import { API_BASE } from './api.constants';

@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly http = inject(HttpClient);

  /**
   * `skipAuthRetry` is for `SessionService.restore()` only: during boot a
   * 401 here means "not signed in", and triggering a refresh would race
   * the one restore has already performed.
   */
  me(options: { skipAuthRetry?: boolean } = {}): Observable<UserProfile> {
    return this.http.get<UserProfile>(`${API_BASE}/users/me`, {
      context: new HttpContext().set(SKIP_AUTH_RETRY, options.skipAuthRetry ?? false),
    });
  }

  updateProfile(body: UpdateProfileRequest): Observable<UserProfile> {
    return this.http.patch<UserProfile>(`${API_BASE}/users/me`, body);
  }

  changePassword(body: ChangePasswordRequest): Observable<void> {
    return this.http.patch<void>(`${API_BASE}/users/me/password`, body);
  }
}
```

Create `apps/web/src/app/core/api/categories.api.ts`:

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CategoryResponse,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from '@bill-tracker/shared-types';
import { API_BASE } from './api.constants';

@Injectable({ providedIn: 'root' })
export class CategoriesApi {
  private readonly http = inject(HttpClient);

  list(): Observable<CategoryResponse[]> {
    return this.http.get<CategoryResponse[]>(`${API_BASE}/categories`);
  }

  create(body: CreateCategoryRequest): Observable<CategoryResponse> {
    return this.http.post<CategoryResponse>(`${API_BASE}/categories`, body);
  }

  update(id: string, body: UpdateCategoryRequest): Observable<CategoryResponse> {
    return this.http.patch<CategoryResponse>(`${API_BASE}/categories/${id}`, body);
  }

  /** 409 when any bill still references the category — bills spec §7.4. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE}/categories/${id}`);
  }
}
```

Create `apps/web/src/app/core/api/bills.api.ts`:

```ts
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  BillResponse,
  CreateBillRequest,
  UpdateBillRequest,
} from '@bill-tracker/shared-types';
import { API_BASE } from './api.constants';

@Injectable({ providedIn: 'root' })
export class BillsApi {
  private readonly http = inject(HttpClient);

  /**
   * `isActive` is checked against `undefined`, not for truthiness: `false`
   * is a meaningful filter ("show me only the deactivated ones") and a
   * truthiness check would turn it into no filter at all.
   */
  list(isActive?: boolean): Observable<BillResponse[]> {
    const params =
      isActive === undefined ? new HttpParams() : new HttpParams().set('isActive', isActive);
    return this.http.get<BillResponse[]>(`${API_BASE}/bills`, { params });
  }

  get(id: string): Observable<BillResponse> {
    return this.http.get<BillResponse>(`${API_BASE}/bills/${id}`);
  }

  create(body: CreateBillRequest): Observable<BillResponse> {
    return this.http.post<BillResponse>(`${API_BASE}/bills`, body);
  }

  update(id: string, body: UpdateBillRequest): Observable<BillResponse> {
    return this.http.patch<BillResponse>(`${API_BASE}/bills/${id}`, body);
  }

  /** A real delete, cascading through instances and payment logs. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE}/bills/${id}`);
  }
}
```

Create `apps/web/src/app/core/api/bill-instances.api.ts`:

```ts
import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  BillInstanceResponse,
  BillStatus,
  PaymentLogResponse,
  PaymentResultResponse,
  RecordPaymentRequest,
  UpdateBillInstanceRequest,
} from '@bill-tracker/shared-types';
import type { CalendarDate } from '../date/calendar-date';
import { API_BASE } from './api.constants';

/**
 * `from` and `to` are required, and they are the pagination: there is no
 * cursor. The span is capped at 400 days by the API; the client checks it
 * before sending so an over-wide range is a message, not a 400.
 */
export interface BillInstanceQuery {
  from: CalendarDate;
  to: CalendarDate;
  status?: BillStatus;
  overdue?: boolean;
  billId?: string;
}

@Injectable({ providedIn: 'root' })
export class BillInstancesApi {
  private readonly http = inject(HttpClient);

  list(query: BillInstanceQuery): Observable<BillInstanceResponse[]> {
    let params = new HttpParams().set('from', query.from).set('to', query.to);
    if (query.status !== undefined) params = params.set('status', query.status);
    // `overdue: false` is the exact negation of overdue, not the absence
    // of a filter, so it is compared against undefined rather than tested
    // for truthiness.
    if (query.overdue !== undefined) params = params.set('overdue', query.overdue);
    if (query.billId !== undefined) params = params.set('billId', query.billId);

    return this.http.get<BillInstanceResponse[]>(`${API_BASE}/bill-instances`, { params });
  }

  get(id: string): Observable<BillInstanceResponse> {
    return this.http.get<BillInstanceResponse>(`${API_BASE}/bill-instances/${id}`);
  }

  /** Any successful patch sets `isCustomized` and opts the row out of template rewrites. */
  update(id: string, body: UpdateBillInstanceRequest): Observable<BillInstanceResponse> {
    return this.http.patch<BillInstanceResponse>(`${API_BASE}/bill-instances/${id}`, body);
  }

  payments(id: string): Observable<PaymentLogResponse[]> {
    return this.http.get<PaymentLogResponse[]>(`${API_BASE}/bill-instances/${id}/payments`);
  }

  /**
   * An empty body means "pay the remaining balance". The server computes
   * that figure under a row lock; a client-computed one races every other
   * writer.
   */
  recordPayment(id: string, body: RecordPaymentRequest = {}): Observable<PaymentResultResponse> {
    return this.http.post<PaymentResultResponse>(`${API_BASE}/bill-instances/${id}/payments`, body);
  }

  reversePayment(id: string, paymentId: string): Observable<PaymentResultResponse> {
    return this.http.post<PaymentResultResponse>(
      `${API_BASE}/bill-instances/${id}/payments/${paymentId}/reverse`,
      {},
    );
  }

  /** Returns the instance alone — there is no payment row to return. */
  unpay(id: string): Observable<BillInstanceResponse> {
    return this.http.post<BillInstanceResponse>(`${API_BASE}/bill-instances/${id}/unpay`, {});
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx nx test web --include='**/api-clients.spec.ts'`
Expected: PASS.

- [ ] **Step 9: Prove the two falsy-parameter tests can fail**

Temporarily change `BillsApi.list` to `isActive ? params.set(...) : new HttpParams()`.

Run: `npx nx test web --include='**/api-clients.spec.ts'`
Expected: FAIL on "sends isActive=false, not an omitted parameter".

Restore it, then make the same change to `overdue` in `BillInstancesApi.list`.

Run again. Expected: FAIL on "sends overdue=false rather than dropping it".

Restore and re-run. Expected: PASS. Both are the same one-character
mistake, and both would list the wrong rows without failing anything else.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/app/core/api apps/web/src/app/core/auth/auth.tokens.ts
git commit -m "feat(web): add typed API clients for every resource"
```

---

## Task 6: Session, the refresh interceptor, and the guards

Spec §6. The unit most likely to carry a subtle bug, so its rules are
tested one at a time rather than through one happy path.

**Read §6.3 of the spec before starting.** In particular: the thing that
prevents a retry loop is the *structure* — `catchError` does not re-catch
the replacement observable it returns, and `next` is the downstream
handler rather than a re-entry into this interceptor. `SKIP_AUTH_RETRY` is
a caller-facing opt-out with exactly one caller, not the loop guard.

**Files:**
- Create: `apps/web/src/app/core/auth/session.service.ts`
- Create: `apps/web/src/app/core/auth/session.service.spec.ts`
- Create: `apps/web/src/app/core/auth/auth.interceptor.ts`
- Create: `apps/web/src/app/core/auth/auth.interceptor.spec.ts`
- Create: `apps/web/src/app/core/auth/auth.guard.ts`
- Create: `apps/web/src/app/core/auth/auth.guard.spec.ts`
- Modify: `apps/web/src/app/app.config.ts`

**Interfaces:**
- Consumes: `AuthApi`, `UsersApi`, `SKIP_AUTH_RETRY`, `API_BASE` (Task 5).
- Produces:
  - `SessionService` with `user: Signal<UserProfile | null>`, `isAuthenticated: Signal<boolean>`, `accessToken(): string | null`, `signIn(response: AuthResponse): void`, `setUser(user: UserProfile): void`, `restore(): Promise<void>`, `refresh(): Observable<string>`, `signOut(): Promise<void>`, `clear(): void`
  - `authInterceptor: HttpInterceptorFn`
  - `authGuard: CanActivateFn`, `guestGuard: CanActivateFn`

- [ ] **Step 1: Write the failing session test**

Create `apps/web/src/app/core/auth/session.service.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SKIP_AUTH_RETRY } from './auth.tokens';
import { SessionService } from './session.service';

let http: HttpTestingController;
let session: SessionService;

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada',
  notifyEmail: true,
  notifyInApp: true,
};

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  http = TestBed.inject(HttpTestingController);
  session = TestBed.inject(SessionService);
});

afterEach(() => {
  http.verify();
});

describe('initial state', () => {
  it('starts anonymous with no token', () => {
    expect(session.isAuthenticated()).toBe(false);
    expect(session.user()).toBeNull();
    expect(session.accessToken()).toBeNull();
  });
});

describe('signIn', () => {
  it('records the token and the user', () => {
    session.signIn({ accessToken: 'token-1', user: profile });

    expect(session.accessToken()).toBe('token-1');
    expect(session.user()).toEqual(profile);
    expect(session.isAuthenticated()).toBe(true);
  });
});

describe('setUser', () => {
  it('replaces the profile and leaves the token alone', () => {
    session.signIn({ accessToken: 'token-1', user: profile });

    session.setUser({ ...profile, name: 'Ada Lovelace' });

    expect(session.user()?.name).toBe('Ada Lovelace');
    expect(session.accessToken()).toBe('token-1');
  });

  it('does not discard an in-flight refresh', () => {
    // Saving a profile is not a sign-in. Routing it through signIn would
    // reset the single-flight state and let a second refresh go out.
    session.signIn({ accessToken: 'token-1', user: profile });
    session.refresh().subscribe({ error: () => undefined });

    session.setUser({ ...profile, name: 'Ada Lovelace' });
    session.refresh().subscribe({ error: () => undefined });

    expect(http.match('/api/auth/refresh')).toHaveLength(1);
    http.match('/api/auth/refresh').forEach((r) => r.flush({ accessToken: 'token-2' }));
  });
});

describe('restore', () => {
  it('refreshes, then reads the profile, and ends authenticated', async () => {
    const restored = session.restore();

    http.expectOne('/api/auth/refresh').flush({ accessToken: 'token-1' });
    const me = http.expectOne('/api/users/me');
    me.flush(profile);

    await restored;

    expect(session.accessToken()).toBe('token-1');
    expect(session.user()).toEqual(profile);
  });

  it('marks its profile read retry-exempt, so a 401 there cannot start a second refresh', async () => {
    const restored = session.restore();

    http.expectOne('/api/auth/refresh').flush({ accessToken: 'token-1' });
    const me = http.expectOne('/api/users/me');
    expect(me.request.context.get(SKIP_AUTH_RETRY)).toBe(true);
    me.flush(profile);

    await restored;
  });

  it('resolves anonymous when the refresh is rejected, and does not reject', async () => {
    // A 401 here is the ordinary state of a visitor who is not signed in.
    // A rejected initializer would fail application bootstrap outright.
    const restored = session.restore();

    http.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });

    await expect(restored).resolves.toBeUndefined();
    expect(session.isAuthenticated()).toBe(false);
    expect(session.accessToken()).toBeNull();
  });

  it('resolves anonymous when the profile read fails after a successful refresh', async () => {
    const restored = session.restore();

    http.expectOne('/api/auth/refresh').flush({ accessToken: 'token-1' });
    http.expectOne('/api/users/me').flush(null, { status: 500, statusText: 'Server Error' });

    await expect(restored).resolves.toBeUndefined();
    // Half a session is not a session: a token with no user would render a
    // shell with no name and no way to recover.
    expect(session.isAuthenticated()).toBe(false);
    expect(session.accessToken()).toBeNull();
  });
});

describe('refresh', () => {
  it('issues one request for several concurrent callers and gives them all the same token', async () => {
    const tokens: string[] = [];
    session.refresh().subscribe((t) => tokens.push(t));
    session.refresh().subscribe((t) => tokens.push(t));
    session.refresh().subscribe((t) => tokens.push(t));

    const requests = http.match('/api/auth/refresh');
    expect(requests).toHaveLength(1);
    requests[0].flush({ accessToken: 'token-2' });

    expect(tokens).toEqual(['token-2', 'token-2', 'token-2']);
    expect(session.accessToken()).toBe('token-2');
  });

  it('starts a fresh request once the previous one has settled', () => {
    session.refresh().subscribe();
    http.expectOne('/api/auth/refresh').flush({ accessToken: 'token-2' });

    session.refresh().subscribe();
    http.expectOne('/api/auth/refresh').flush({ accessToken: 'token-3' });

    expect(session.accessToken()).toBe('token-3');
  });

  it('propagates the failure to every waiting caller', () => {
    const errors: unknown[] = [];
    session.refresh().subscribe({ error: (e) => errors.push(e) });
    session.refresh().subscribe({ error: (e) => errors.push(e) });

    http.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(errors).toHaveLength(2);
  });
});

describe('clear and signOut', () => {
  it('clear drops the token and the user', () => {
    session.signIn({ accessToken: 'token-1', user: profile });
    session.clear();

    expect(session.isAuthenticated()).toBe(false);
    expect(session.accessToken()).toBeNull();
  });

  it('signOut calls the API and then clears', async () => {
    session.signIn({ accessToken: 'token-1', user: profile });
    const done = session.signOut();

    http.expectOne('/api/auth/logout').flush(null);
    await done;

    expect(session.isAuthenticated()).toBe(false);
  });

  it('signOut clears even when the API call fails', async () => {
    // The session is ending regardless. Leaving a user signed in because
    // the server could not be reached is the wrong failure.
    session.signIn({ accessToken: 'token-1', user: profile });
    const done = session.signOut();

    http.expectOne('/api/auth/logout').flush(null, { status: 500, statusText: 'Server Error' });
    await expect(done).resolves.toBeUndefined();

    expect(session.isAuthenticated()).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx nx test web --include='**/session.service.spec.ts'`
Expected: FAIL — cannot resolve `./session.service`.

- [ ] **Step 3: Write the session service**

Create `apps/web/src/app/core/auth/session.service.ts`:

```ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, finalize, firstValueFrom, map, shareReplay, tap } from 'rxjs';
import type { AuthResponse, UserProfile } from '@bill-tracker/shared-types';
import { AuthApi } from '../api/auth.api';
import { UsersApi } from '../api/users.api';

@Injectable({ providedIn: 'root' })
export class SessionService {
  private readonly authApi = inject(AuthApi);
  private readonly usersApi = inject(UsersApi);

  /**
   * The access token lives here and nowhere else — never `localStorage`,
   * never `sessionStorage`, never a cookie the client writes. Cross-site
   * scripting cannot exfiltrate a credential that is not durable.
   */
  private readonly token = signal<string | null>(null);
  private readonly currentUser = signal<UserProfile | null>(null);

  private inFlightRefresh: Observable<string> | null = null;
  private refreshGeneration = 0;

  readonly user = this.currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

  accessToken(): string | null {
    return this.token();
  }

  signIn(response: AuthResponse): void {
    this.resetRefresh();
    this.token.set(response.accessToken);
    this.currentUser.set(response.user);
  }

  /**
   * Replaces the profile without touching the token or the refresh state.
   * Saving a name is not a sign-in, and routing it through `signIn` would
   * discard an in-flight refresh for no reason.
   */
  setUser(user: UserProfile): void {
    this.currentUser.set(user);
  }

  clear(): void {
    this.resetRefresh();
    this.token.set(null);
    this.currentUser.set(null);
  }

  /**
   * Rebuilds the session at boot from the refresh cookie.
   *
   * Two round trips, because `POST /api/auth/refresh` returns only the
   * access token. **This never rejects**: a 401 is the ordinary state of a
   * visitor who is not signed in, and a rejected app initializer fails
   * bootstrap outright.
   *
   * A token without a profile is not a usable session — it renders a shell
   * with no name and no way to recover — so a failed profile read clears
   * everything rather than leaving half a session behind.
   */
  async restore(): Promise<void> {
    try {
      const { accessToken } = await firstValueFrom(this.authApi.refresh());
      this.token.set(accessToken);
      this.currentUser.set(await firstValueFrom(this.usersApi.me({ skipAuthRetry: true })));
    } catch {
      this.clear();
    }
  }

  /**
   * Single-flight refresh: however many requests fail with 401 at once,
   * exactly one `POST /api/auth/refresh` goes out and they all wait on it.
   *
   * The server tolerates a stampede through its 30-second grace window
   * (foundation spec §7), which exists so that client correctness is
   * optional. Depending on that is still the wrong instinct, and
   * single-flighting means the window is never exercised in normal use.
   *
   * The generation counter stops a late `finalize` from clearing a *newer*
   * in-flight refresh that `clear()` or `signIn()` started in between.
   */
  refresh(): Observable<string> {
    if (this.inFlightRefresh) return this.inFlightRefresh;

    const generation = ++this.refreshGeneration;
    const shared = this.authApi.refresh().pipe(
      map((response) => response.accessToken),
      tap((accessToken) => this.token.set(accessToken)),
      finalize(() => {
        if (this.refreshGeneration === generation) this.inFlightRefresh = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this.inFlightRefresh = shared;
    return shared;
  }

  async signOut(): Promise<void> {
    try {
      await firstValueFrom(this.authApi.logout());
    } catch {
      // The session ends either way. Keeping someone signed in because the
      // server was unreachable is the wrong failure to pick.
    }
    this.clear();
  }

  private resetRefresh(): void {
    this.refreshGeneration += 1;
    this.inFlightRefresh = null;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx nx test web --include='**/session.service.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Write the failing interceptor test**

Create `apps/web/src/app/core/auth/auth.interceptor.spec.ts`:

```ts
import { HttpClient, HttpContext, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authInterceptor } from './auth.interceptor';
import { SKIP_AUTH_RETRY } from './auth.tokens';
import { SessionService } from './session.service';

let http: HttpTestingController;
let client: HttpClient;
let session: SessionService;
let router: Router;

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada',
  notifyEmail: true,
  notifyInApp: true,
};

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(withInterceptors([authInterceptor])),
      provideHttpClientTesting(),
    ],
  });
  http = TestBed.inject(HttpTestingController);
  client = TestBed.inject(HttpClient);
  session = TestBed.inject(SessionService);
  router = TestBed.inject(Router);
});

afterEach(() => {
  http.verify();
  vi.restoreAllMocks();
});

function apiRequests() {
  return http.match((request) => !request.url.includes('/api/auth/'));
}

describe('outbound decoration', () => {
  it('attaches the bearer token to an API request', () => {
    session.signIn({ accessToken: 'token-1', user: profile });
    client.get('/api/bills').subscribe();

    const req = http.expectOne('/api/bills');
    expect(req.request.headers.get('Authorization')).toBe('Bearer token-1');
    req.flush([]);
  });

  it('sends credentials on API requests, so the refresh cookie travels', () => {
    client.get('/api/bills').subscribe();

    const req = http.expectOne('/api/bills');
    expect(req.request.withCredentials).toBe(true);
    req.flush([]);
  });

  it('attaches no Authorization header when there is no token', () => {
    client.get('/api/bills').subscribe();

    const req = http.expectOne('/api/bills');
    expect(req.request.headers.has('Authorization')).toBe(false);
    req.flush([]);
  });

  it('leaves a non-API request completely alone', () => {
    // Attaching a bearer token to a third-party request leaks it.
    session.signIn({ accessToken: 'token-1', user: profile });
    client.get('/assets/config.json').subscribe();

    const req = http.expectOne('/assets/config.json');
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(req.request.withCredentials).toBe(false);
    req.flush({});
  });
});

describe('the 401 path', () => {
  it('refreshes once for several simultaneous 401s, then retries each with the new token', () => {
    session.signIn({ accessToken: 'stale', user: profile });
    const results: unknown[] = [];

    client.get('/api/bills').subscribe((r) => results.push(r));
    client.get('/api/categories').subscribe((r) => results.push(r));
    client.get('/api/bill-instances').subscribe((r) => results.push(r));

    const first = apiRequests();
    expect(first).toHaveLength(3);
    for (const request of first) {
      request.flush(null, { status: 401, statusText: 'Unauthorized' });
    }

    // The assertion this whole design exists for.
    const refreshes = http.match('/api/auth/refresh');
    expect(refreshes).toHaveLength(1);
    refreshes[0].flush({ accessToken: 'fresh' });

    const retries = apiRequests();
    expect(retries).toHaveLength(3);
    for (const request of retries) {
      expect(request.request.headers.get('Authorization')).toBe('Bearer fresh');
      request.flush({ ok: true });
    }

    expect(results).toHaveLength(3);
  });

  it('does not refresh when a request fails with something other than 401', () => {
    session.signIn({ accessToken: 'token-1', user: profile });
    const errors: unknown[] = [];
    client.get('/api/bills').subscribe({ error: (e) => errors.push(e) });

    http.expectOne('/api/bills').flush(null, { status: 500, statusText: 'Server Error' });

    expect(http.match('/api/auth/refresh')).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it('surfaces the error instead of refreshing again when the retry also fails with 401', () => {
    session.signIn({ accessToken: 'stale', user: profile });
    const errors: unknown[] = [];
    client.get('/api/bills').subscribe({ error: (e) => errors.push(e) });

    http.expectOne('/api/bills').flush(null, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/auth/refresh').flush({ accessToken: 'fresh' });
    http.expectOne('/api/bills').flush(null, { status: 401, statusText: 'Unauthorized' });

    // Exactly one refresh, and the second failure reaches the caller.
    expect(http.match('/api/auth/refresh')).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });
});

describe('exemptions', () => {
  it.each([
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/refresh',
    '/api/auth/logout',
  ])('does not refresh when %s fails with 401', (url) => {
    const errors: unknown[] = [];
    client.post(url, {}).subscribe({ error: (e) => errors.push(e) });

    http.expectOne(url).flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(http.match('/api/auth/refresh')).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });

  it('does not refresh a request that opted out through SKIP_AUTH_RETRY', () => {
    const errors: unknown[] = [];
    client
      .get('/api/users/me', { context: new HttpContext().set(SKIP_AUTH_RETRY, true) })
      .subscribe({ error: (e) => errors.push(e) });

    http.expectOne('/api/users/me').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(http.match('/api/auth/refresh')).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });
});

describe('a refresh that fails mid-session', () => {
  it('clears the session, navigates to the login screen, and fails the waiting request', () => {
    // Review Focus 1. The user is on a screen, the refresh token has been
    // revoked, and nothing about the happy path covers what they see next.
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    session.signIn({ accessToken: 'stale', user: profile });

    const errors: unknown[] = [];
    client.get('/api/bills').subscribe({ error: (e) => errors.push(e) });

    http.expectOne('/api/bills').flush(null, { status: 401, statusText: 'Unauthorized' });
    http.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(session.isAuthenticated()).toBe(false);
    expect(session.accessToken()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { reason: 'expired' } });
    expect(errors).toHaveLength(1);
  });

  it('navigates once even when several requests were waiting on the same refresh', () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    session.signIn({ accessToken: 'stale', user: profile });

    const errors: unknown[] = [];
    client.get('/api/bills').subscribe({ error: (e) => errors.push(e) });
    client.get('/api/categories').subscribe({ error: (e) => errors.push(e) });

    for (const request of apiRequests()) {
      request.flush(null, { status: 401, statusText: 'Unauthorized' });
    }
    http.expectOne('/api/auth/refresh').flush(null, { status: 401, statusText: 'Unauthorized' });

    expect(errors).toHaveLength(2);
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx nx test web --include='**/auth.interceptor.spec.ts'`
Expected: FAIL — cannot resolve `./auth.interceptor`.

- [ ] **Step 7: Write the interceptor**

Create `apps/web/src/app/core/auth/auth.interceptor.ts`:

```ts
import {
  HttpErrorResponse,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { catchError, switchMap, throwError } from 'rxjs';
import { API_BASE } from '../api/api.constants';
import { SKIP_AUTH_RETRY } from './auth.tokens';
import { SessionService } from './session.service';

/**
 * Refreshing after a rejected sign-in is meaningless, and refreshing after
 * a rejected refresh is a loop. All four auth routes are exempt.
 */
const EXEMPT_PATHS = [
  `${API_BASE}/auth/login`,
  `${API_BASE}/auth/register`,
  `${API_BASE}/auth/refresh`,
  `${API_BASE}/auth/logout`,
];

function isExemptPath(url: string): boolean {
  return EXEMPT_PATHS.some((path) => url === path || url.startsWith(`${path}?`));
}

function withAuth(request: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  return request.clone({
    withCredentials: true,
    setHeaders: token === null ? {} : { Authorization: `Bearer ${token}` },
  });
}

/**
 * Adds the bearer token and credentials to API requests, and turns a 401
 * into a single-flight refresh followed by one retry.
 *
 * **What prevents a retry loop is the shape of this function, not a flag.**
 * The 401 branch lives inside a `catchError` wrapping `next(request)`. The
 * observable it returns is a *replacement*, which `catchError` does not
 * re-catch, and `next` is the downstream handler rather than a re-entry
 * into this interceptor. A retry that fails again therefore propagates to
 * the caller, and no counter is involved.
 *
 * The `catchError` below sits **before** `switchMap` on purpose. Placed
 * after, it would also catch failures of the retried request, so a 500 on
 * the retry would sign the user out.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  if (!request.url.startsWith(API_BASE)) return next(request);

  const session = inject(SessionService);
  const router = inject(Router);
  const authorized = withAuth(request, session.accessToken());

  if (isExemptPath(request.url) || request.context.get(SKIP_AUTH_RETRY)) {
    return next(authorized);
  }

  return next(authorized).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse) || error.status !== 401) {
        return throwError(() => error);
      }

      return session.refresh().pipe(
        catchError((refreshError: unknown) => {
          session.clear();
          void router.navigate(['/login'], { queryParams: { reason: 'expired' } });
          return throwError(() => refreshError);
        }),
        switchMap((accessToken) => next(withAuth(request, accessToken))),
      );
    }),
  );
};
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx nx test web --include='**/auth.interceptor.spec.ts'`
Expected: PASS.

- [ ] **Step 9: Prove the single-flight assertion can fail**

Temporarily change `SessionService.refresh()` to drop the cache — delete
the `if (this.inFlightRefresh) return this.inFlightRefresh;` line and the
`this.inFlightRefresh = shared;` assignment.

Run: `npx nx test web`
Expected: FAIL on "refreshes once for several simultaneous 401s" (three
refreshes, not one) and on the session service's own single-flight test.

Restore both lines and re-run. Expected: PASS. Without this step the
interceptor suite would pass just as happily against a stampede.

- [ ] **Step 10: Prove the catchError placement is tested**

Temporarily move the inner `catchError` to *after* the `switchMap`.

Run: `npx nx test web --include='**/auth.interceptor.spec.ts'`
Expected: FAIL on "surfaces the error instead of refreshing again when the
retry also fails with 401" — the retry's 401 now clears the session and
navigates, which that test does not expect.

Restore the order and re-run. Expected: PASS.

- [ ] **Step 11: Write the failing guard test**

Create `apps/web/src/app/core/auth/auth.guard.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection, runInInjectionContext, Injector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  UrlTree,
  provideRouter,
} from '@angular/router';
import { beforeEach, describe, expect, it } from 'vitest';
import { authGuard, guestGuard } from './auth.guard';
import { SessionService } from './session.service';

let injector: Injector;
let session: SessionService;

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada',
  notifyEmail: true,
  notifyInApp: true,
};

function stateFor(url: string): RouterStateSnapshot {
  return { url } as RouterStateSnapshot;
}

const route = {} as ActivatedRouteSnapshot;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  injector = TestBed.inject(Injector);
  session = TestBed.inject(SessionService);
});

describe('authGuard', () => {
  it('admits an authenticated visitor', () => {
    session.signIn({ accessToken: 'token-1', user: profile });

    const result = runInInjectionContext(injector, () => authGuard(route, stateFor('/bills')));

    expect(result).toBe(true);
  });

  it('redirects an anonymous visitor to the login screen', () => {
    const result = runInInjectionContext(injector, () => authGuard(route, stateFor('/bills')));

    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toContain('/login');
  });

  it('carries the attempted URL so the visitor lands where they were going', () => {
    const result = runInInjectionContext(injector, () =>
      authGuard(route, stateFor('/bills/abc-123')),
    ) as UrlTree;

    expect(result.queryParams['returnUrl']).toBe('/bills/abc-123');
  });
});

describe('guestGuard', () => {
  it('admits an anonymous visitor', () => {
    const result = runInInjectionContext(injector, () => guestGuard(route, stateFor('/login')));

    expect(result).toBe(true);
  });

  it('redirects a signed-in visitor away from the login screen', () => {
    // A bookmarked /login should not present a sign-in form to someone who
    // is already signed in.
    session.signIn({ accessToken: 'token-1', user: profile });

    const result = runInInjectionContext(injector, () => guestGuard(route, stateFor('/login')));

    expect(result).toBeInstanceOf(UrlTree);
    expect(String(result)).toContain('/upcoming');
  });
});
```

- [ ] **Step 12: Run the test to verify it fails**

Run: `npx nx test web --include='**/auth.guard.spec.ts'`
Expected: FAIL — cannot resolve `./auth.guard`.

- [ ] **Step 13: Write the guards**

Create `apps/web/src/app/core/auth/auth.guard.ts`:

```ts
import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { SessionService } from './session.service';

/**
 * Both guards read the session synchronously, which is only safe because
 * `SessionService.restore()` runs in an app initializer and has already
 * settled before any route activates — spec §6.2.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const session = inject(SessionService);
  const router = inject(Router);

  if (session.isAuthenticated()) return true;
  return router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
};

export const guestGuard: CanActivateFn = () => {
  const session = inject(SessionService);
  const router = inject(Router);

  return session.isAuthenticated() ? router.createUrlTree(['/upcoming']) : true;
};
```

- [ ] **Step 14: Run the test to verify it passes**

Run: `npx nx test web --include='**/auth.guard.spec.ts'`
Expected: PASS.

- [ ] **Step 15: Wire the interceptor and the initializer into the application**

In `apps/web/src/app/app.config.ts`, add the imports:

```ts
import { provideAppInitializer, inject } from '@angular/core';
import { authInterceptor } from './core/auth/auth.interceptor';
import { SessionService } from './core/auth/session.service';
```

Change the HTTP provider to carry the interceptor:

```ts
provideHttpClient(withFetch(), withInterceptors([authInterceptor])),
```

and add, as the **last** entry in the `providers` array:

```ts
provideAppInitializer(() => inject(SessionService).restore()),
```

It goes last because it runs during bootstrap and needs every provider
above it — `HttpClient`, the interceptor, and the session — already
configured.

- [ ] **Step 16: Verify the whole suite**

Run: `npx nx run-many -t lint typecheck test --skip-nx-cache`
Expected: all green.

- [ ] **Step 17: Commit**

```bash
git add apps/web/src/app/core/auth apps/web/src/app/app.config.ts
git commit -m "feat(web): restore the session at boot and refresh it silently

One POST /api/auth/refresh however many requests fail with 401 at once.
The retry loop is prevented structurally — catchError does not re-catch
its replacement observable — rather than by a counter."
```

---

## Task 7: The shared presentational kit

Spec §9, §10. Six small pieces every feature uses. They are one task
because none is worth a review gate alone and they all change together.

**Files:**
- Create: `apps/web/src/app/shared/money.ts` and `money.spec.ts`
- Create: `apps/web/src/app/shared/server-errors.ts` and `server-errors.spec.ts`
- Create: `apps/web/src/app/shared/field-errors.component.ts` and `field-errors.component.spec.ts`
- Create: `apps/web/src/app/shared/empty-state.component.ts`
- Create: `apps/web/src/app/shared/notification.service.ts`
- Create: `apps/web/src/app/shared/confirm-dialog.component.ts` and `confirm-dialog.component.spec.ts`

**Interfaces:**
- Consumes: `isValidationErrorResponse`, `errorMessage` (Task 5).
- Produces:
  - `CURRENCY = 'USD'`, `MIN_AMOUNT = 0.01`, `MAX_AMOUNT = 9999999999.99`, `formatMoney(value: number): string`, `amountValidators: ValidatorFn[]`
  - `applyServerErrors(form: FormGroup, error: unknown): string[]` — returns the messages that matched no control
  - `FieldErrorsComponent`, selector `app-field-errors`, inputs `control` (required) and `label`
  - `EmptyStateComponent`, selector `app-empty-state`, inputs `icon`, `title`, `message`
  - `NotificationService` with `success(message: string): void` and `error(message: string): void`
  - `ConfirmDialogComponent`, `ConfirmDialogData`, `ConfirmDialogResult = 'confirm' | 'alternate' | undefined`

- [ ] **Step 1: Write the failing money test**

Create `apps/web/src/app/shared/money.spec.ts`:

```ts
import { FormControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT, MIN_AMOUNT, amountValidators, formatMoney } from './money';

describe('formatMoney', () => {
  it('renders two decimal places and a currency symbol', () => {
    expect(formatMoney(1200)).toBe('$1,200.00');
  });

  it('renders cents', () => {
    expect(formatMoney(12.5)).toBe('$12.50');
  });

  it('renders zero', () => {
    expect(formatMoney(0)).toBe('$0.00');
  });
});

describe('amountValidators', () => {
  function validate(value: unknown) {
    return new FormControl(value, amountValidators).errors;
  }

  it('accepts a positive amount', () => {
    expect(validate(1200)).toBeNull();
  });

  it('accepts the smallest representable amount', () => {
    expect(validate(MIN_AMOUNT)).toBeNull();
  });

  it('rejects zero, because an amount must be greater than zero', () => {
    expect(validate(0)).not.toBeNull();
  });

  it('rejects a negative amount', () => {
    expect(validate(-1)).not.toBeNull();
  });

  it('rejects an amount past the column capacity, so it is a message and not a 400', () => {
    expect(validate(MAX_AMOUNT + 0.01)).not.toBeNull();
  });

  it('accepts the largest amount the column holds', () => {
    expect(validate(MAX_AMOUNT)).toBeNull();
  });

  it('rejects an empty value', () => {
    expect(validate(null)).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx nx test web --include='**/money.spec.ts'`
Expected: FAIL — cannot resolve `./money`.

- [ ] **Step 3: Write the money module**

Create `apps/web/src/app/shared/money.ts`:

```ts
import { ValidatorFn, Validators } from '@angular/forms';

/**
 * Multi-currency is not in any sub-project. The constant exists so that
 * when it becomes a real requirement there is one place to change, rather
 * than a `'USD'` at every call site.
 */
export const CURRENCY = 'USD';

/** Money carries two decimal places, so this is the smallest amount above zero. */
export const MIN_AMOUNT = 0.01;

/** The `numeric(12,2)` column's capacity — bills spec §7.1. */
export const MAX_AMOUNT = 9999999999.99;

const FORMATTER = new Intl.NumberFormat('en-US', { style: 'currency', currency: CURRENCY });

export function formatMoney(value: number): string {
  return FORMATTER.format(value);
}

/**
 * Mirrors the API's own bounds so an out-of-range figure produces a
 * message beside the field rather than a 400 from the server.
 */
export const amountValidators: ValidatorFn[] = [
  Validators.required,
  Validators.min(MIN_AMOUNT),
  Validators.max(MAX_AMOUNT),
];
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx nx test web --include='**/money.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Write the failing server-errors test**

Create `apps/web/src/app/shared/server-errors.spec.ts`:

```ts
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormGroup } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';
import { applyServerErrors } from './server-errors';

let form: FormGroup;

beforeEach(() => {
  const fb = new FormBuilder();
  form = fb.group({ name: [''], defaultAmount: [0] });
});

function badRequest(body: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status: 400, error: body, url: '/api/bills' });
}

describe('applyServerErrors', () => {
  it('attaches a message to the control that produced it', () => {
    const unmatched = applyServerErrors(
      form,
      badRequest({
        statusCode: 400,
        error: 'Bad Request',
        message: ['name should not be empty'],
        errors: { name: ['name should not be empty'] },
        path: '/api/bills',
        timestamp: '2026-10-06T00:00:00.000Z',
      }),
    );

    expect(form.controls['name'].errors).toMatchObject({ server: 'name should not be empty' });
    expect(unmatched).toEqual([]);
  });

  it('marks the control touched, so the message is actually displayed', () => {
    applyServerErrors(
      form,
      badRequest({ message: ['name should not be empty'], errors: { name: ['x'] } }),
    );

    expect(form.controls['name'].touched).toBe(true);
  });

  it('attaches messages to several controls at once', () => {
    applyServerErrors(
      form,
      badRequest({
        message: ['a', 'b'],
        errors: { name: ['name is required'], defaultAmount: ['amount must be positive'] },
      }),
    );

    expect(form.controls['name'].errors).toMatchObject({ server: 'name is required' });
    expect(form.controls['defaultAmount'].errors).toMatchObject({
      server: 'amount must be positive',
    });
  });

  it('returns a message whose field matches no control instead of dropping it', () => {
    // The failure mode this guards: a form rejects a submission and shows
    // nothing at all, because the only message belonged to a field the
    // form does not render.
    const unmatched = applyServerErrors(
      form,
      badRequest({ message: ['x'], errors: { frequency: ['frequency must be one of...'] } }),
    );

    expect(unmatched).toEqual(['frequency must be one of...']);
  });

  it('returns every message of an unmatched field, not just the first', () => {
    const unmatched = applyServerErrors(
      form,
      badRequest({ message: ['x', 'y'], errors: { frequency: ['first', 'second'] } }),
    );

    expect(unmatched).toEqual(['first', 'second']);
  });

  it('returns the single message of a 400 that carries no field map', () => {
    // A service-raised 400 — a categoryId naming another user's category.
    // There is nothing to attach, and the message must still be seen.
    const unmatched = applyServerErrors(
      form,
      badRequest({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Category not found',
        path: '/api/bills',
        timestamp: '2026-10-06T00:00:00.000Z',
      }),
    );

    expect(unmatched).toEqual(['Category not found']);
    expect(form.controls['name'].errors).toBeNull();
  });

  it('returns a readable message for a 409', () => {
    const unmatched = applyServerErrors(
      form,
      new HttpErrorResponse({ status: 409, error: { message: 'Already exists' } }),
    );

    expect(unmatched).toEqual(['Already exists']);
  });

  it('keeps the own validation errors of a control alongside those from the server', () => {
    form.controls['name'].setErrors({ required: true });
    applyServerErrors(form, badRequest({ message: ['x'], errors: { name: ['too short'] } }));

    expect(form.controls['name'].errors).toMatchObject({ required: true, server: 'too short' });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx nx test web --include='**/server-errors.spec.ts'`
Expected: FAIL — cannot resolve `./server-errors`.

- [ ] **Step 7: Write the server-errors mapper**

Create `apps/web/src/app/shared/server-errors.ts`:

```ts
import { HttpErrorResponse } from '@angular/common/http';
import { FormGroup } from '@angular/forms';
import { errorMessage, isValidationErrorResponse } from '../core/api/api-error';

/**
 * Attaches each server message to the control that produced it, and
 * returns the messages that matched no control.
 *
 * **The return value is not optional.** A caller that discards it will, on
 * some input, reject a submission and display nothing — the message
 * belonged to a field the form does not render, or to a 400 that carries
 * no field map at all. Every caller shows the returned messages in a
 * form-level banner.
 *
 * The control's own validation errors are preserved: a field can be both
 * empty and rejected by the server, and clearing the first to show the
 * second would be arbitrary.
 */
export function applyServerErrors(form: FormGroup, error: unknown): string[] {
  if (!(error instanceof HttpErrorResponse)) return [errorMessage(error)];

  const body = error.error;
  if (!isValidationErrorResponse(body)) return [errorMessage(error)];

  const unmatched: string[] = [];

  for (const [path, messages] of Object.entries(body.errors)) {
    const control = form.get(path);
    if (control === null) {
      unmatched.push(...messages);
      continue;
    }
    control.setErrors({ ...control.errors, server: messages[0] });
    control.markAsTouched();
  }

  return unmatched;
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx nx test web --include='**/server-errors.spec.ts'`
Expected: PASS.

- [ ] **Step 9: Write the failing field-errors test**

Create `apps/web/src/app/shared/field-errors.component.spec.ts`:

```ts
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { beforeEach, describe, expect, it } from 'vitest';
import { FieldErrorsComponent } from './field-errors.component';
import { MAX_AMOUNT, MIN_AMOUNT, amountValidators } from './money';

@Component({
  imports: [ReactiveFormsModule, FieldErrorsComponent],
  template: `<app-field-errors [control]="control()" [label]="label()" />`,
})
class Host {
  readonly control = signal(new FormControl('', [Validators.required]));
  readonly label = signal('Name');
}

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [Host],
    providers: [provideZonelessChangeDetection()],
  });
});

describe('FieldErrorsComponent', () => {
  it('shows nothing while the control is untouched', async () => {
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent.trim()).toBe('');
  });

  it('names the field in a required message', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.control().markAsTouched();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Name is required');
  });

  it('prefers the server message over a client one', async () => {
    // The server knows something the client does not; showing "is
    // required" over "that name is already taken" hides the real answer.
    const fixture = TestBed.createComponent(Host);
    const control = fixture.componentInstance.control();
    control.setErrors({ required: true, server: 'That name is already taken' });
    control.markAsTouched();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('That name is already taken');
    expect(fixture.nativeElement.textContent).not.toContain('is required');
  });

  it('reports a minimum and a maximum in money terms', async () => {
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.control.set(new FormControl(0, amountValidators));
    fixture.componentInstance.label.set('Amount');
    fixture.componentInstance.control().markAsTouched();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(String(MIN_AMOUNT));

    fixture.componentInstance.control.set(new FormControl(MAX_AMOUNT + 1, amountValidators));
    fixture.componentInstance.control().markAsTouched();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain(String(MAX_AMOUNT));
  });

  it('falls back to a generic sentence for a validator it does not know', async () => {
    const fixture = TestBed.createComponent(Host);
    const control = fixture.componentInstance.control();
    control.setErrors({ someCustomRule: true });
    control.markAsTouched();
    await fixture.whenStable();

    // Never render nothing when a control is invalid: an un-submittable
    // form with no visible reason is the worst outcome here.
    expect(fixture.nativeElement.textContent.trim()).not.toBe('');
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `npx nx test web --include='**/field-errors.component.spec.ts'`
Expected: FAIL — cannot resolve `./field-errors.component`.

- [ ] **Step 11: Write the field-errors component**

Create `apps/web/src/app/shared/field-errors.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { AbstractControl } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';

/**
 * Renders the one message a person needs for a control.
 *
 * The server's message wins over a client one: the server knows things the
 * client does not, and showing "is required" instead of "that name is
 * already taken" hides the real answer.
 *
 * An unrecognised validator still produces a sentence. A form that will
 * not submit and shows no reason is the worst outcome this component can
 * produce, so there is no path through it that renders nothing for an
 * invalid, touched control.
 */
@Component({
  selector: 'app-field-errors',
  imports: [MatFormFieldModule],
  template: `
    @if (message(); as text) {
      <mat-error>{{ text }}</mat-error>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FieldErrorsComponent {
  readonly control = input.required<AbstractControl>();
  readonly label = input('This field');

  message(): string | null {
    const control = this.control();
    if (!control.touched || control.errors === null) return null;

    const errors = control.errors;
    const name = this.label();

    if (typeof errors['server'] === 'string') return errors['server'];
    if (errors['required']) return `${name} is required`;
    if (errors['email']) return `${name} must be a valid email address`;
    if (errors['minlength']) {
      return `${name} must be at least ${errors['minlength'].requiredLength} characters`;
    }
    if (errors['maxlength']) {
      return `${name} must be at most ${errors['maxlength'].requiredLength} characters`;
    }
    if (errors['min']) return `${name} must be at least ${errors['min'].min}`;
    if (errors['max']) return `${name} must be at most ${errors['max'].max}`;
    if (errors['matDatepickerParse']) return `${name} must be a date, as YYYY-MM-DD`;

    return `${name} is not valid`;
  }
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `npx nx test web --include='**/field-errors.component.spec.ts'`
Expected: PASS.

- [ ] **Step 13: Write the empty state and the notification service**

Create `apps/web/src/app/shared/empty-state.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';

/**
 * A blank region reads as a loading failure. Every list in this
 * application says, in words, that it is empty and what to do about it.
 */
@Component({
  selector: 'app-empty-state',
  imports: [MatIconModule],
  template: `
    <div class="empty-state">
      <mat-icon aria-hidden="true">{{ icon() }}</mat-icon>
      <h2>{{ title() }}</h2>
      <p>{{ message() }}</p>
      <ng-content />
    </div>
  `,
  styles: `
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      padding: 3rem 1rem;
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
    }
    mat-icon {
      font-size: 3rem;
      width: 3rem;
      height: 3rem;
    }
    h2 {
      margin: 0;
      font: var(--mat-sys-title-medium);
    }
    p {
      margin: 0;
      max-width: 36ch;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmptyStateComponent {
  readonly icon = input('inbox');
  readonly title = input.required<string>();
  readonly message = input('');
}
```

Create `apps/web/src/app/shared/notification.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

/**
 * One entry point for transient messages, so dismissal and duration behave
 * the same everywhere. An error stays longer than a confirmation because
 * it is the one a person needs time to read.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);

  success(message: string): void {
    this.snackBar.open(message, 'Dismiss', { duration: 4000 });
  }

  error(message: string): void {
    this.snackBar.open(message, 'Dismiss', { duration: 8000 });
  }
}
```

- [ ] **Step 14: Write the failing confirm-dialog test**

Create `apps/web/src/app/shared/confirm-dialog.component.spec.ts`:

```ts
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialogComponent, ConfirmDialogData } from './confirm-dialog.component';

function build(data: ConfirmDialogData) {
  const close = vi.fn();
  TestBed.configureTestingModule({
    imports: [ConfirmDialogComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close } },
    ],
  });
  return { fixture: TestBed.createComponent(ConfirmDialogComponent), close };
}

describe('ConfirmDialogComponent', () => {
  it('shows the title, the message, and the confirm label', async () => {
    const { fixture } = build({
      title: 'Delete Rent?',
      message: 'This deletes 12 instances and their payment history.',
      confirmLabel: 'Delete',
    });
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Delete Rent?');
    expect(text).toContain('This deletes 12 instances and their payment history.');
    expect(text).toContain('Delete');
  });

  it('offers no alternate action when none was supplied', async () => {
    const { fixture } = build({ title: 'T', message: 'M', confirmLabel: 'OK' });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="alternate"]')).toBeNull();
  });

  it('closes with "confirm" when the destructive action is chosen', async () => {
    const { fixture, close } = build({ title: 'T', message: 'M', confirmLabel: 'Delete' });
    await fixture.whenStable();

    fixture.nativeElement.querySelector('[data-testid="confirm"]').click();

    expect(close).toHaveBeenCalledWith('confirm');
  });

  it('closes with "alternate" when the safer action is chosen', async () => {
    const { fixture, close } = build({
      title: 'T',
      message: 'M',
      confirmLabel: 'Delete',
      alternateLabel: 'Deactivate instead',
    });
    await fixture.whenStable();

    fixture.nativeElement.querySelector('[data-testid="alternate"]').click();

    expect(close).toHaveBeenCalledWith('alternate');
  });

  it('gives the alternate action focus when there is one', async () => {
    // The API offers a non-destructive path; the dialog should land on it
    // rather than on the one that destroys payment history.
    const { fixture } = build({
      title: 'T',
      message: 'M',
      confirmLabel: 'Delete',
      alternateLabel: 'Deactivate instead',
    });
    await fixture.whenStable();

    const alternate = fixture.nativeElement.querySelector('[data-testid="alternate"]');
    expect(alternate.hasAttribute('cdkFocusInitial')).toBe(true);
  });
});
```

- [ ] **Step 15: Run the test to verify it fails**

Run: `npx nx test web --include='**/confirm-dialog.component.spec.ts'`
Expected: FAIL — cannot resolve `./confirm-dialog.component`.

- [ ] **Step 16: Write the confirm dialog**

Create `apps/web/src/app/shared/confirm-dialog.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel: string;
  /**
   * A safer action offered beside the destructive one — "Deactivate
   * instead" for a bill whose deletion cascades through its payment
   * history. When present it takes initial focus.
   */
  alternateLabel?: string;
}

export type ConfirmDialogResult = 'confirm' | 'alternate' | undefined;

@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>{{ data.message }}</mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close data-testid="cancel">Cancel</button>
      @if (data.alternateLabel) {
        <button matButton cdkFocusInitial data-testid="alternate" (click)="close('alternate')">
          {{ data.alternateLabel }}
        </button>
      }
      <button
        matButton="filled"
        class="destructive"
        data-testid="confirm"
        (click)="close('confirm')"
      >
        {{ data.confirmLabel }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .destructive {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialogComponent {
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ConfirmDialogComponent, ConfirmDialogResult>>(
    MatDialogRef,
  );

  close(result: ConfirmDialogResult): void {
    this.dialogRef.close(result);
  }
}
```

- [ ] **Step 17: Run the test to verify it passes**

Run: `npx nx test web --include='**/confirm-dialog.component.spec.ts'`
Expected: PASS.

- [ ] **Step 18: Prove the unmatched-message path is tested**

Temporarily change `applyServerErrors` so the `control === null` branch
does `continue` without pushing to `unmatched`.

Run: `npx nx test web --include='**/server-errors.spec.ts'`
Expected: FAIL on both unmatched-message tests.

Restore and re-run. Expected: PASS. This is the silent-rejection failure
mode, and it must not be able to return.

- [ ] **Step 19: Commit**

```bash
git add apps/web/src/app/shared
git commit -m "feat(web): add the shared form, dialog, and money kit"
```

---

## Task 8: Routing, the shell, and the authentication screens

Spec §5, §6.4, §11. The route table is written in full here. Four of its
paths load components that later tasks create, so **they are registered
by those tasks, not this one** — the table below is what exists after
Task 8, and each feature task appends its own entry and asserts it
resolves.

One consequence to expect and not mistake for a defect: `''` redirects to
`/upcoming`, which does not exist until Task 11. Between Task 8 and Task
11 the default route lands on the not-found screen. Every suite is green
throughout; the application is simply incomplete, which is what being
mid-plan means.

**Files:**
- Create: `apps/web/src/app/shared/password-validators.ts` and `password-validators.spec.ts`
- Create: `apps/web/src/app/shared/return-url.ts` and `return-url.spec.ts`
- Create: `apps/web/src/app/auth/login.component.ts` and `login.component.spec.ts`
- Create: `apps/web/src/app/auth/register.component.ts` and `register.component.spec.ts`
- Create: `apps/web/src/app/shell/shell.component.ts` and `shell.component.spec.ts`
- Create: `apps/web/src/app/shell/not-found.component.ts`
- Modify: `apps/web/src/app/app.routes.ts`
- Modify: `apps/web/src/app/app.ts` and `apps/web/src/app/app.html` — the Task 2 scaffolding goes

**Interfaces:**
- Consumes: `SessionService`, `authGuard`, `guestGuard` (Task 6); `AuthApi` (Task 5); `applyServerErrors`, `FieldErrorsComponent`, `NotificationService` (Task 7).
- Produces:
  - `maxBytesValidator(limit: number): ValidatorFn`
  - `safeReturnUrl(value: unknown, fallback: string): string`
  - `LoginComponent`, `RegisterComponent`, `ShellComponent`, `NotFoundComponent`
  - `routes: Routes` in `app.routes.ts`, with the shell as a parent route guarded by `authGuard`

- [ ] **Step 1: Write the failing validator and return-url tests**

Create `apps/web/src/app/shared/password-validators.spec.ts`:

```ts
import { FormControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { maxBytesValidator } from './password-validators';

function validate(value: string) {
  return new FormControl(value, [maxBytesValidator(72)]).errors;
}

describe('maxBytesValidator', () => {
  it('accepts a short password', () => {
    expect(validate('hunter22')).toBeNull();
  });

  it('accepts exactly the limit in ASCII', () => {
    expect(validate('a'.repeat(72))).toBeNull();
  });

  it('rejects one ASCII character past the limit', () => {
    expect(validate('a'.repeat(73))).not.toBeNull();
  });

  it('counts bytes, not characters', () => {
    // bcrypt truncates at 72 *bytes*. Twenty-five four-byte emoji are 25
    // characters and 100 bytes: a length check would accept them, and the
    // server would silently authenticate a shorter prefix.
    const emoji = '😀'.repeat(25);
    expect(emoji.length).toBe(50);
    expect(validate(emoji)).not.toBeNull();
  });

  it('reports the limit and the actual size, so the message can say both', () => {
    expect(validate('a'.repeat(80))).toEqual({ maxBytes: { limit: 72, actual: 80 } });
  });

  it('accepts an empty value and leaves required to Validators.required', () => {
    expect(validate('')).toBeNull();
  });
});
```

Create `apps/web/src/app/shared/return-url.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { safeReturnUrl } from './return-url';

describe('safeReturnUrl', () => {
  it('accepts an absolute path within the application', () => {
    expect(safeReturnUrl('/bills/abc-123', '/upcoming')).toBe('/bills/abc-123');
  });

  it('keeps a query string', () => {
    expect(safeReturnUrl('/bills?isActive=true', '/upcoming')).toBe('/bills?isActive=true');
  });

  it('rejects a protocol-relative URL, which would leave the site', () => {
    // "//evil.example" is a URL, not a path. Navigating to it after a
    // successful sign-in is an open redirect.
    expect(safeReturnUrl('//evil.example/phish', '/upcoming')).toBe('/upcoming');
  });

  it('rejects an absolute URL', () => {
    expect(safeReturnUrl('https://evil.example', '/upcoming')).toBe('/upcoming');
  });

  it('rejects a backslash-prefixed path, which some browsers normalise to a slash', () => {
    expect(safeReturnUrl('/\\evil.example', '/upcoming')).toBe('/upcoming');
  });

  it('rejects a relative path', () => {
    expect(safeReturnUrl('bills', '/upcoming')).toBe('/upcoming');
  });

  it('falls back for null, undefined, an array, and the empty string', () => {
    expect(safeReturnUrl(null, '/upcoming')).toBe('/upcoming');
    expect(safeReturnUrl(undefined, '/upcoming')).toBe('/upcoming');
    expect(safeReturnUrl(['/bills'], '/upcoming')).toBe('/upcoming');
    expect(safeReturnUrl('', '/upcoming')).toBe('/upcoming');
  });
});
```

- [ ] **Step 2: Run both to verify they fail**

Run: `npx nx test web`
Expected: FAIL — neither module resolves.

- [ ] **Step 3: Write both modules**

Create `apps/web/src/app/shared/password-validators.ts`:

```ts
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

const ENCODER = new TextEncoder();

/**
 * bcrypt silently truncates input beyond 72 **bytes**, so the API caps
 * passwords there (foundation spec §7). A character-length check would
 * accept a 50-character string of four-byte emoji — 200 bytes — and the
 * server would authenticate a 72-byte prefix of it without telling anyone.
 */
export function maxBytesValidator(limit: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (typeof value !== 'string' || value === '') return null;

    const actual = ENCODER.encode(value).length;
    return actual > limit ? { maxBytes: { limit, actual } } : null;
  };
}
```

Create `apps/web/src/app/shared/return-url.ts`:

```ts
/**
 * Narrows a `returnUrl` query parameter to an in-application path.
 *
 * Without this, signing in from `/login?returnUrl=https://evil.example`
 * hands the visitor straight to another site immediately after they typed
 * a password — an open redirect, and a convincing one because the hop
 * happens at the exact moment they expect to be sent somewhere.
 *
 * A protocol-relative `//host` and a `/\host` are both rejected: the first
 * is a URL that merely looks like a path, and some browsers normalise the
 * backslash in the second into a slash.
 */
export function safeReturnUrl(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || value === '') return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  return value;
}
```

- [ ] **Step 4: Run both to verify they pass**

Run: `npx nx test web`
Expected: PASS.

- [ ] **Step 5: Write the failing login test**

Create `apps/web/src/app/auth/login.component.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { LoginComponent } from './login.component';

let http: HttpTestingController;
let router: Router;
let queryParams: Record<string, unknown>;

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada',
  notifyEmail: true,
  notifyInApp: true,
};

function configure(params: Record<string, unknown> = {}) {
  queryParams = params;
  TestBed.configureTestingModule({
    imports: [LoginComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      {
        provide: ActivatedRoute,
        useValue: { snapshot: { queryParams }, queryParams: of(queryParams) },
      },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  router = TestBed.inject(Router);
}

afterEach(() => {
  http.verify();
  vi.restoreAllMocks();
});

describe('LoginComponent', () => {
  beforeEach(() => configure());

  it('does not submit an empty form', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();

    fixture.componentInstance.submit();

    expect(http.match('/api/auth/login')).toHaveLength(0);
  });

  it('posts the credentials and signs the session in', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.componentInstance.form.setValue({ email: 'a@b.c', password: 'hunter22' });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    http.expectOne('/api/auth/login').flush({ accessToken: 'token-1', user: profile });
    await fixture.whenStable();

    expect(TestBed.inject(SessionService).isAuthenticated()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/upcoming');
  });

  it('attaches a server validation message to its control', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.componentInstance.form.setValue({ email: 'a@b.c', password: 'hunter22' });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    http.expectOne('/api/auth/login').flush(
      {
        statusCode: 400,
        error: 'Bad Request',
        message: ['email must be an email'],
        errors: { email: ['email must be an email'] },
        path: '/api/auth/login',
        timestamp: '2026-10-06T00:00:00.000Z',
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(fixture.componentInstance.form.controls.email.errors).toMatchObject({
      server: 'email must be an email',
    });
  });

  it('shows a 401 in the form banner, since no single field is at fault', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.componentInstance.form.setValue({ email: 'a@b.c', password: 'wrong-one' });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    http
      .expectOne('/api/auth/login')
      .flush({ message: 'Invalid credentials' }, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();

    expect(fixture.componentInstance.formErrors()).toEqual(['Invalid credentials']);
    expect(fixture.nativeElement.textContent).toContain('Invalid credentials');
  });

  it('stops submitting after a failure, so the button is usable again', async () => {
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.componentInstance.form.setValue({ email: 'a@b.c', password: 'wrong-one' });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    expect(fixture.componentInstance.submitting()).toBe(true);

    http.expectOne('/api/auth/login').flush(null, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();

    expect(fixture.componentInstance.submitting()).toBe(false);
  });
});

describe('LoginComponent and the returnUrl', () => {
  it('returns the visitor to where they were going', async () => {
    configure({ returnUrl: '/bills/abc-123' });
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.componentInstance.form.setValue({ email: 'a@b.c', password: 'hunter22' });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    http.expectOne('/api/auth/login').flush({ accessToken: 'token-1', user: profile });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith('/bills/abc-123');
  });

  it('refuses to follow a returnUrl that leaves the site', async () => {
    configure({ returnUrl: 'https://evil.example' });
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(LoginComponent);
    fixture.componentInstance.form.setValue({ email: 'a@b.c', password: 'hunter22' });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    http.expectOne('/api/auth/login').flush({ accessToken: 'token-1', user: profile });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith('/upcoming');
  });
});

describe('LoginComponent and an expired session', () => {
  it('explains why the visitor is looking at this screen', async () => {
    // The interceptor sends them here with reason=expired after a failed
    // refresh. Without the explanation it reads as the application
    // forgetting them for no reason.
    configure({ reason: 'expired' });
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('session expired');
  });

  it('says nothing special on an ordinary visit', async () => {
    configure();
    const fixture = TestBed.createComponent(LoginComponent);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).not.toContain('session expired');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx nx test web --include='**/login.component.spec.ts'`
Expected: FAIL — cannot resolve `./login.component`.

- [ ] **Step 7: Write the login component**

Create `apps/web/src/app/auth/login.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AuthApi } from '../core/api/auth.api';
import { SessionService } from '../core/auth/session.service';
import { FieldErrorsComponent } from '../shared/field-errors.component';
import { applyServerErrors } from '../shared/server-errors';
import { safeReturnUrl } from '../shared/return-url';

@Component({
  selector: 'app-login',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    FieldErrorsComponent,
  ],
  template: `
    <main class="auth-page">
      <mat-card>
        @if (submitting()) {
          <mat-progress-bar mode="indeterminate" />
        }
        <mat-card-header>
          <mat-card-title>Sign in</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          @if (expired()) {
            <p class="notice" role="status">
              Your session expired. Please sign in again.
            </p>
          }
          @for (message of formErrors(); track message) {
            <p class="form-error" role="alert">{{ message }}</p>
          }

          <form [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field>
              <mat-label>Email</mat-label>
              <input matInput type="email" formControlName="email" autocomplete="username" />
              <app-field-errors [control]="form.controls.email" label="Email" />
            </mat-form-field>

            <mat-form-field>
              <mat-label>Password</mat-label>
              <input
                matInput
                type="password"
                formControlName="password"
                autocomplete="current-password"
              />
              <app-field-errors [control]="form.controls.password" label="Password" />
            </mat-form-field>

            <button matButton="filled" type="submit" [disabled]="submitting()">Sign in</button>
          </form>
        </mat-card-content>
        <mat-card-actions>
          <a routerLink="/register">Create an account</a>
        </mat-card-actions>
      </mat-card>
    </main>
  `,
  styles: `
    .auth-page {
      display: grid;
      place-items: center;
      min-height: 100dvh;
      padding: 1rem;
    }
    mat-card {
      width: min(28rem, 100%);
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .notice,
    .form-error {
      margin: 0 0 1rem;
    }
    .form-error {
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authApi = inject(AuthApi);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  readonly submitting = signal(false);
  readonly formErrors = signal<string[]>([]);
  readonly expired = signal(this.route.snapshot.queryParams['reason'] === 'expired');

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.formErrors.set([]);

    this.authApi.login(this.form.getRawValue()).subscribe({
      next: (response) => {
        this.session.signIn(response);
        this.submitting.set(false);
        void this.router.navigateByUrl(
          safeReturnUrl(this.route.snapshot.queryParams['returnUrl'], '/upcoming'),
        );
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.formErrors.set(applyServerErrors(this.form, error));
      },
    });
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx nx test web --include='**/login.component.spec.ts'`
Expected: PASS.

- [ ] **Step 9: Write the failing register test**

Create `apps/web/src/app/auth/register.component.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { RegisterComponent } from './register.component';

let http: HttpTestingController;
let router: Router;

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada',
  notifyEmail: true,
  notifyInApp: true,
};

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [RegisterComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  router = TestBed.inject(Router);
});

afterEach(() => {
  http.verify();
  vi.restoreAllMocks();
});

describe('RegisterComponent', () => {
  it('requires a password of at least eight characters', async () => {
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.componentInstance.form.setValue({ email: 'a@b.c', name: 'Ada', password: 'short' });
    await fixture.whenStable();

    expect(fixture.componentInstance.form.controls.password.errors).toMatchObject({
      minlength: expect.anything(),
    });
  });

  it('rejects a password over 72 bytes before it reaches the server', async () => {
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.componentInstance.form.setValue({
      email: 'a@b.c',
      name: 'Ada',
      password: '😀'.repeat(25),
    });
    await fixture.whenStable();

    expect(fixture.componentInstance.form.controls.password.errors).toMatchObject({
      maxBytes: expect.anything(),
    });
  });

  it('registers and signs the session in', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.componentInstance.form.setValue({
      email: 'a@b.c',
      name: 'Ada',
      password: 'hunter22',
    });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    const req = http.expectOne('/api/auth/register');
    expect(req.request.body).toEqual({ email: 'a@b.c', name: 'Ada', password: 'hunter22' });
    req.flush({ accessToken: 'token-1', user: profile });
    await fixture.whenStable();

    expect(TestBed.inject(SessionService).isAuthenticated()).toBe(true);
    expect(navigate).toHaveBeenCalledWith('/upcoming');
  });

  it('shows a duplicate-email 409 in the banner', async () => {
    const fixture = TestBed.createComponent(RegisterComponent);
    fixture.componentInstance.form.setValue({
      email: 'taken@b.c',
      name: 'Ada',
      password: 'hunter22',
    });
    await fixture.whenStable();

    fixture.componentInstance.submit();
    http
      .expectOne('/api/auth/register')
      .flush({ message: 'Email already registered' }, { status: 409, statusText: 'Conflict' });
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Email already registered');
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `npx nx test web --include='**/register.component.spec.ts'`
Expected: FAIL — cannot resolve `./register.component`.

- [ ] **Step 11: Write the register component**

Create `apps/web/src/app/auth/register.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AuthApi } from '../core/api/auth.api';
import { SessionService } from '../core/auth/session.service';
import { FieldErrorsComponent } from '../shared/field-errors.component';
import { maxBytesValidator } from '../shared/password-validators';
import { applyServerErrors } from '../shared/server-errors';

@Component({
  selector: 'app-register',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    FieldErrorsComponent,
  ],
  template: `
    <main class="auth-page">
      <mat-card>
        @if (submitting()) {
          <mat-progress-bar mode="indeterminate" />
        }
        <mat-card-header>
          <mat-card-title>Create an account</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          @for (message of formErrors(); track message) {
            <p class="form-error" role="alert">{{ message }}</p>
          }

          <form [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field>
              <mat-label>Email</mat-label>
              <input matInput type="email" formControlName="email" autocomplete="username" />
              <app-field-errors [control]="form.controls.email" label="Email" />
            </mat-form-field>

            <mat-form-field>
              <mat-label>Name</mat-label>
              <input matInput formControlName="name" autocomplete="name" />
              <app-field-errors [control]="form.controls.name" label="Name" />
            </mat-form-field>

            <mat-form-field>
              <mat-label>Password</mat-label>
              <input
                matInput
                type="password"
                formControlName="password"
                autocomplete="new-password"
              />
              <mat-hint>At least 8 characters. No symbol requirements.</mat-hint>
              <app-field-errors [control]="form.controls.password" label="Password" />
            </mat-form-field>

            <button matButton="filled" type="submit" [disabled]="submitting()">
              Create account
            </button>
          </form>
        </mat-card-content>
        <mat-card-actions>
          <a routerLink="/login">I already have an account</a>
        </mat-card-actions>
      </mat-card>
    </main>
  `,
  styles: `
    .auth-page {
      display: grid;
      place-items: center;
      min-height: 100dvh;
      padding: 1rem;
    }
    mat-card {
      width: min(28rem, 100%);
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .form-error {
      margin: 0 0 1rem;
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authApi = inject(AuthApi);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  /**
   * The password rules mirror the API's, which follow NIST guidance: a
   * length floor, no composition rules, and a 72-byte ceiling because
   * bcrypt truncates there.
   */
  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    name: ['', [Validators.required, Validators.maxLength(100)]],
    password: ['', [Validators.required, Validators.minLength(8), maxBytesValidator(72)]],
  });

  readonly submitting = signal(false);
  readonly formErrors = signal<string[]>([]);

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.formErrors.set([]);

    this.authApi.register(this.form.getRawValue()).subscribe({
      next: (response) => {
        this.session.signIn(response);
        this.submitting.set(false);
        void this.router.navigateByUrl('/upcoming');
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.formErrors.set(applyServerErrors(this.form, error));
      },
    });
  }
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `npx nx test web --include='**/register.component.spec.ts'`
Expected: PASS.

- [ ] **Step 13: Write the failing shell test**

Create `apps/web/src/app/shell/shell.component.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { ShellComponent } from './shell.component';

let http: HttpTestingController;
let session: SessionService;
let router: Router;

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada Lovelace',
  notifyEmail: true,
  notifyInApp: true,
};

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [ShellComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  session = TestBed.inject(SessionService);
  router = TestBed.inject(Router);
  session.signIn({ accessToken: 'token-1', user: profile });
});

afterEach(() => {
  http.verify();
  vi.restoreAllMocks();
});

describe('ShellComponent', () => {
  it('names the signed-in user', async () => {
    const fixture = TestBed.createComponent(ShellComponent);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Ada Lovelace');
  });

  it('links to every section', async () => {
    const fixture = TestBed.createComponent(ShellComponent);
    await fixture.whenStable();

    const hrefs = [...fixture.nativeElement.querySelectorAll('a[href]')].map((a: HTMLAnchorElement) =>
      a.getAttribute('href'),
    );
    expect(hrefs).toEqual(
      expect.arrayContaining(['/upcoming', '/bills', '/categories', '/settings']),
    );
  });

  it('signs out and returns to the login screen', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(ShellComponent);
    await fixture.whenStable();

    fixture.nativeElement.querySelector('[data-testid="sign-out"]').click();
    http.expectOne('/api/auth/logout').flush(null);
    await fixture.whenStable();

    expect(session.isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/login');
  });
});
```

- [ ] **Step 14: Run the test to verify it fails**

Run: `npx nx test web --include='**/shell.component.spec.ts'`
Expected: FAIL — cannot resolve `./shell.component`.

- [ ] **Step 15: Write the shell and the not-found screen**

Create `apps/web/src/app/shell/shell.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { SessionService } from '../core/auth/session.service';

@Component({
  selector: 'app-shell',
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatSidenavModule,
    MatToolbarModule,
  ],
  template: `
    <mat-toolbar>
      <span class="brand">Bill Tracker</span>
      <span class="spacer"></span>
      <span class="user">{{ user()?.name }}</span>
      <button matIconButton data-testid="sign-out" aria-label="Sign out" (click)="signOut()">
        <mat-icon>logout</mat-icon>
      </button>
    </mat-toolbar>

    <mat-sidenav-container>
      <mat-sidenav mode="side" opened>
        <mat-nav-list>
          <a mat-list-item routerLink="/upcoming" routerLinkActive="active">
            <mat-icon matListItemIcon>event</mat-icon>
            <span matListItemTitle>Upcoming</span>
          </a>
          <a mat-list-item routerLink="/bills" routerLinkActive="active">
            <mat-icon matListItemIcon>receipt_long</mat-icon>
            <span matListItemTitle>Bills</span>
          </a>
          <a mat-list-item routerLink="/categories" routerLinkActive="active">
            <mat-icon matListItemIcon>label</mat-icon>
            <span matListItemTitle>Categories</span>
          </a>
          <a mat-list-item routerLink="/settings" routerLinkActive="active">
            <mat-icon matListItemIcon>settings</mat-icon>
            <span matListItemTitle>Settings</span>
          </a>
        </mat-nav-list>
      </mat-sidenav>

      <mat-sidenav-content>
        <router-outlet />
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100dvh;
    }
    .spacer {
      flex: 1;
    }
    .user {
      margin-right: 0.5rem;
    }
    mat-sidenav-container {
      flex: 1;
    }
    mat-sidenav {
      width: 15rem;
    }
    mat-sidenav-content {
      padding: 1.5rem;
    }
    @media (max-width: 48rem) {
      mat-sidenav {
        width: 4rem;
      }
      mat-sidenav span[matListItemTitle] {
        display: none;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShellComponent {
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  readonly user = this.session.user;

  async signOut(): Promise<void> {
    await this.session.signOut();
    void this.router.navigateByUrl('/login');
  }
}
```

Create `apps/web/src/app/shell/not-found.component.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { EmptyStateComponent } from '../shared/empty-state.component';

@Component({
  selector: 'app-not-found',
  imports: [RouterLink, MatButtonModule, EmptyStateComponent],
  template: `
    <app-empty-state
      icon="explore_off"
      title="That page does not exist"
      message="The link may be out of date, or the bill it pointed to may have been deleted."
    >
      <a matButton="filled" routerLink="/upcoming">Go to Upcoming</a>
    </app-empty-state>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotFoundComponent {}
```

- [ ] **Step 16: Run the test to verify it passes**

Run: `npx nx test web --include='**/shell.component.spec.ts'`
Expected: PASS.

- [ ] **Step 17: Write the route table**

Replace `apps/web/src/app/app.routes.ts` with:

```ts
import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/auth/auth.guard';

/**
 * Every route is lazily loaded. The shell is a parent route rather than a
 * component the children each import, so `authGuard` runs once for the
 * whole signed-in area instead of being repeated — and forgotten — on
 * each child.
 *
 * Children are added by the tasks that create their screens: `/categories`
 * in task 9, `/bills` in task 10, `/upcoming` in task 11, `/settings` in
 * task 13. Until task 11 the default redirect lands on the not-found
 * screen, which is expected mid-plan.
 */
export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'register',
    canActivate: [guestGuard],
    loadComponent: () => import('./auth/register.component').then((m) => m.RegisterComponent),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./shell/shell.component').then((m) => m.ShellComponent),
    children: [{ path: '', pathMatch: 'full', redirectTo: 'upcoming' }],
  },
  {
    path: '**',
    loadComponent: () => import('./shell/not-found.component').then((m) => m.NotFoundComponent),
  },
];
```

- [ ] **Step 18: Replace the Task 2 scaffolding**

`App` exists only to host the router now. Replace `apps/web/src/app/app.ts`:

```ts
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet],
  template: '<router-outlet />',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {}
```

Delete `apps/web/src/app/app.html` and remove `templateUrl`/`styleUrl` from
the decorator — the inline template above replaces both. Delete
`apps/web/src/app/app.scss` if the generator created it and nothing else
references it.

Replace `apps/web/src/app/app.spec.ts` with:

```ts
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { beforeEach, describe, expect, it } from 'vitest';
import { App } from './app';
import { routes } from './app.routes';

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [App],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter(routes),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
});

describe('routing', () => {
  it('renders the not-found screen for an unknown path', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/nonsense');
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('That page does not exist');
  });

  it('shows the login screen without a guard redirect loop', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/login');
    await fixture.whenStable();

    expect(router.url).toBe('/login');
    expect(fixture.nativeElement.textContent).toContain('Sign in');
  });

  it('shows the register screen', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/register');
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Create an account');
  });
});
```

**There is no guard test here on purpose.** `authGuard` guards the shell's
children, and at this point the shell has no child but the redirect, so a
navigation to any protected path backtracks past the `''` route and lands on
`**` without ever running the guard. Task 9 registers the first real child and
tests the guard there.

- [ ] **Step 19: Run the whole suite**

Run: `npx nx run-many -t lint typecheck test build --skip-nx-cache`
Expected: all green.

- [ ] **Step 20: Prove the open-redirect guard is load-bearing**

Temporarily change `LoginComponent.submit()` to navigate to
`this.route.snapshot.queryParams['returnUrl'] ?? '/upcoming'`, bypassing
`safeReturnUrl`.

Run: `npx nx test web --include='**/login.component.spec.ts'`
Expected: FAIL on "refuses to follow a returnUrl that leaves the site".

Restore and re-run. Expected: PASS.

- [ ] **Step 21: Commit**

```bash
git add apps/web/src/app
git commit -m "feat(web): add routing, the application shell, and the auth screens"
```

---

## Task 9: Categories — the store pattern, and the first feature screen

Spec §7.2, §10, §11. This task establishes the store shape that Tasks 10
and 11 copy, so get it right here.

Three properties of the shape matter and are each tested:

- **`isEmpty` distinguishes "loaded and empty" from "not loaded yet".** A
  single `items().length === 0` renders the empty state during the first
  load, so a person sees "You have no categories" and then a list — which
  reads as a bug.
- **Each store resets itself when the session ends**, through an `effect`
  on `isAuthenticated`. A second user signing in on the same tab must not
  see the first one's rows, and wiring this into `SessionService` would
  make it depend on every store.
- **A mutation patches local state from the response**, never refetches.

**Files:**
- Create: `apps/web/src/app/core/state/categories.store.ts` and `categories.store.spec.ts`
- Create: `apps/web/src/app/categories/categories.component.ts` and `categories.component.spec.ts`
- Create: `apps/web/src/app/categories/category-dialog.component.ts`
- Modify: `apps/web/src/app/app.routes.ts`
- Modify: `apps/web/src/app/app.spec.ts` — the guard tests Task 8 deferred

**Interfaces:**
- Consumes: `CategoriesApi` (Task 5); `SessionService` (Task 6); `errorMessage` (Task 5); `applyServerErrors`, `FieldErrorsComponent`, `EmptyStateComponent`, `NotificationService`, `ConfirmDialogComponent` (Task 7).
- Produces:
  - `CategoriesStore` with `categories: Signal<CategoryResponse[]>`, `loading: Signal<boolean>`, `error: Signal<string | null>`, `isEmpty: Signal<boolean>`, `load(force?: boolean): Promise<void>`, `create(body): Promise<CategoryResponse>`, `update(id, body): Promise<CategoryResponse>`, `remove(id): Promise<void>`, `reset(): void`
  - `CategoriesComponent`, `CategoryDialogComponent`, `CategoryDialogData`

- [ ] **Step 1: Write the failing store test**

Create `apps/web/src/app/core/state/categories.store.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../auth/session.service';
import { CategoriesStore } from './categories.store';

let http: HttpTestingController;
let store: CategoriesStore;
let session: SessionService;

const utilities = { id: 'cat-1', name: 'Utilities', color: '#2f80ed' };
const housing = { id: 'cat-2', name: 'Housing', color: null };

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada',
  notifyEmail: true,
  notifyInApp: true,
};

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  http = TestBed.inject(HttpTestingController);
  session = TestBed.inject(SessionService);
  session.signIn({ accessToken: 'token-1', user: profile });
  store = TestBed.inject(CategoriesStore);
});

afterEach(() => {
  http.verify();
});

describe('load', () => {
  it('fills the store', async () => {
    const loaded = store.load();
    http.expectOne('/api/categories').flush([utilities, housing]);
    await loaded;

    expect(store.categories()).toEqual([utilities, housing]);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBeNull();
  });

  it('does not report emptiness before the first load has finished', async () => {
    // Review Focus 4. A length check alone renders "you have none" during
    // the first load, and a list a moment later, which reads as a bug.
    expect(store.isEmpty()).toBe(false);

    const loaded = store.load();
    expect(store.isEmpty()).toBe(false);
    expect(store.loading()).toBe(true);

    http.expectOne('/api/categories').flush([]);
    await loaded;

    expect(store.isEmpty()).toBe(true);
  });

  it('does not refetch on a second call', async () => {
    const first = store.load();
    http.expectOne('/api/categories').flush([utilities]);
    await first;

    await store.load();
    expect(http.match('/api/categories')).toHaveLength(0);
  });

  it('refetches when forced', async () => {
    const first = store.load();
    http.expectOne('/api/categories').flush([utilities]);
    await first;

    const second = store.load(true);
    http.expectOne('/api/categories').flush([utilities, housing]);
    await second;

    expect(store.categories()).toHaveLength(2);
  });

  it('records a readable error and stops loading when the request fails', async () => {
    const loaded = store.load();
    http.expectOne('/api/categories').flush(null, { status: 0, statusText: 'Unknown Error' });
    await loaded;

    expect(store.error()).toContain('Cannot reach the server');
    expect(store.loading()).toBe(false);
    // A failed load is not an empty list, and must not render as one.
    expect(store.isEmpty()).toBe(false);
  });

  it('retries after a failure, since the first attempt did not mark it loaded', async () => {
    const failed = store.load();
    http.expectOne('/api/categories').flush(null, { status: 500, statusText: 'Server Error' });
    await failed;

    const retried = store.load();
    http.expectOne('/api/categories').flush([utilities]);
    await retried;

    expect(store.categories()).toEqual([utilities]);
    expect(store.error()).toBeNull();
  });
});

describe('mutations', () => {
  async function seed() {
    const loaded = store.load();
    http.expectOne('/api/categories').flush([utilities]);
    await loaded;
  }

  it('appends a created category from the response, without refetching', async () => {
    await seed();

    const created = store.create({ name: 'Insurance' });
    http.expectOne('/api/categories').flush({ id: 'cat-3', name: 'Insurance', color: null });
    await created;

    expect(store.categories().map((c) => c.name)).toEqual(['Utilities', 'Insurance']);
    expect(http.match('/api/categories')).toHaveLength(0);
  });

  it('replaces an updated category in place', async () => {
    await seed();

    const updated = store.update('cat-1', { name: 'Power' });
    http.expectOne('/api/categories/cat-1').flush({ ...utilities, name: 'Power' });
    await updated;

    expect(store.categories()[0].name).toBe('Power');
    expect(store.categories()).toHaveLength(1);
  });

  it('drops a removed category', async () => {
    await seed();

    const removed = store.remove('cat-1');
    http.expectOne('/api/categories/cat-1').flush(null);
    await removed;

    expect(store.categories()).toEqual([]);
  });

  it('leaves the list untouched when a delete is refused with 409', async () => {
    // The category is still in use. Removing it locally would show a row
    // disappearing that the server still holds.
    await seed();

    const removed = store.remove('cat-1');
    http
      .expectOne('/api/categories/cat-1')
      .flush({ message: 'This category is used by 3 bill(s).' }, {
        status: 409,
        statusText: 'Conflict',
      });

    await expect(removed).rejects.toBeDefined();
    expect(store.categories()).toEqual([utilities]);
  });

  it('rejects rather than swallowing a failed create, so the form can show why', async () => {
    await seed();

    const created = store.create({ name: '' });
    http.expectOne('/api/categories').flush(
      { message: ['name should not be empty'], errors: { name: ['name should not be empty'] } },
      { status: 400, statusText: 'Bad Request' },
    );

    await expect(created).rejects.toBeDefined();
    expect(store.categories()).toEqual([utilities]);
  });
});

describe('session lifecycle', () => {
  it('empties itself when the session ends', async () => {
    const loaded = store.load();
    http.expectOne('/api/categories').flush([utilities]);
    await loaded;

    session.clear();
    TestBed.tick();

    expect(store.categories()).toEqual([]);
  });

  it('loads again for the next session rather than serving the previous one', async () => {
    const loaded = store.load();
    http.expectOne('/api/categories').flush([utilities]);
    await loaded;

    session.clear();
    TestBed.tick();
    session.signIn({ accessToken: 'token-2', user: { ...profile, id: 'user-2' } });

    const reloaded = store.load();
    http.expectOne('/api/categories').flush([housing]);
    await reloaded;

    expect(store.categories()).toEqual([housing]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx nx test web --include='**/categories.store.spec.ts'`
Expected: FAIL — cannot resolve `./categories.store`.

- [ ] **Step 3: Write the store**

Create `apps/web/src/app/core/state/categories.store.ts`:

```ts
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  CategoryResponse,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from '@bill-tracker/shared-types';
import { CategoriesApi } from '../api/categories.api';
import { errorMessage } from '../api/api-error';
import { SessionService } from '../auth/session.service';

@Injectable({ providedIn: 'root' })
export class CategoriesStore {
  private readonly api = inject(CategoriesApi);
  private readonly session = inject(SessionService);

  private readonly items = signal<CategoryResponse[]>([]);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly loaded = signal(false);

  readonly categories = this.items.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();

  /**
   * True only once a load has actually succeeded and returned nothing. A
   * bare `length === 0` would render the empty state during the first
   * load, and again whenever a load fails — telling a person their data
   * is gone when it is merely unreachable.
   */
  readonly isEmpty = computed(() => this.loaded() && this.items().length === 0);

  constructor() {
    // The store empties itself rather than `SessionService` emptying it,
    // which would make the session depend on every store in the
    // application. A second user signing in on the same tab must never
    // see the first one's rows.
    effect(() => {
      if (!this.session.isAuthenticated()) this.reset();
    });
  }

  async load(force = false): Promise<void> {
    if (this.loaded() && !force) return;

    this.loadingState.set(true);
    this.errorState.set(null);
    try {
      this.items.set(await firstValueFrom(this.api.list()));
      this.loaded.set(true);
    } catch (error: unknown) {
      this.errorState.set(errorMessage(error));
    } finally {
      this.loadingState.set(false);
    }
  }

  /**
   * Mutations reject rather than swallow. The caller is a form that needs
   * the error to attach messages to its controls; a store that returned
   * `void` on failure would leave the form looking successful.
   */
  async create(body: CreateCategoryRequest): Promise<CategoryResponse> {
    const created = await firstValueFrom(this.api.create(body));
    this.items.update((current) => [...current, created]);
    return created;
  }

  async update(id: string, body: UpdateCategoryRequest): Promise<CategoryResponse> {
    const updated = await firstValueFrom(this.api.update(id, body));
    this.items.update((current) => current.map((item) => (item.id === id ? updated : item)));
    return updated;
  }

  /**
   * The local removal happens only after the server confirms. A delete
   * refused with 409 — the category is still used by bills — must leave
   * the row where it is, not show it vanishing from a list the server
   * still holds.
   */
  async remove(id: string): Promise<void> {
    await firstValueFrom(this.api.remove(id));
    this.items.update((current) => current.filter((item) => item.id !== id));
  }

  reset(): void {
    this.items.set([]);
    this.loaded.set(false);
    this.errorState.set(null);
    this.loadingState.set(false);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx nx test web --include='**/categories.store.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Write the failing screen test**

Create `apps/web/src/app/categories/categories.component.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { CategoriesComponent } from './categories.component';

let http: HttpTestingController;

const utilities = { id: 'cat-1', name: 'Utilities', color: '#2f80ed' };

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [CategoriesComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  TestBed.inject(SessionService).signIn({
    accessToken: 'token-1',
    user: { id: 'user-1', email: 'a@b.c', name: 'Ada', notifyEmail: true, notifyInApp: true },
  });
});

afterEach(() => {
  http.verify();
});

describe('CategoriesComponent', () => {
  it('loads and lists categories', async () => {
    const fixture = TestBed.createComponent(CategoriesComponent);
    await fixture.whenStable();

    http.expectOne('/api/categories').flush([utilities]);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Utilities');
  });

  it('names the empty state instead of rendering a blank panel', async () => {
    // Review Focus 4. A new account with no categories must read as
    // "there are none yet", not as a page that failed to load.
    const fixture = TestBed.createComponent(CategoriesComponent);
    await fixture.whenStable();

    http.expectOne('/api/categories').flush([]);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('No categories yet');
  });

  it('shows no empty state while the first load is still in flight', async () => {
    const fixture = TestBed.createComponent(CategoriesComponent);
    await fixture.whenStable();

    const request = http.expectOne('/api/categories');
    expect(fixture.nativeElement.textContent).not.toContain('No categories yet');

    request.flush([]);
  });

  it('shows the load failure instead of an empty list', async () => {
    const fixture = TestBed.createComponent(CategoriesComponent);
    await fixture.whenStable();

    http.expectOne('/api/categories').flush(null, { status: 500, statusText: 'Server Error' });
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Something went wrong');
    expect(fixture.nativeElement.textContent).not.toContain('No categories yet');
  });

  it('reports the server message when a delete is refused with 409', async () => {
    // Bills spec §7.4: the message names how many bills still use it, and
    // that count is the only thing that tells a person what to do next.
    const fixture = TestBed.createComponent(CategoriesComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([utilities]);
    await fixture.whenStable();

    await fixture.componentInstance.confirmRemove(utilities);
    http.expectOne('/api/categories/cat-1').flush(
      { message: 'This category is used by 3 bill(s). Reassign or delete them first.' },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();

    expect(fixture.componentInstance.lastError()).toContain('used by 3 bill(s)');
    expect(fixture.nativeElement.textContent).toContain('Utilities');
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx nx test web --include='**/categories.component.spec.ts'`
Expected: FAIL — cannot resolve `./categories.component`.

- [ ] **Step 7: Write the dialog and the screen**

Create `apps/web/src/app/categories/category-dialog.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { CategoryResponse } from '@bill-tracker/shared-types';
import { FieldErrorsComponent } from '../shared/field-errors.component';

export interface CategoryDialogData {
  category: CategoryResponse | null;
}

export interface CategoryDialogResult {
  name: string;
  color: string | null;
}

@Component({
  selector: 'app-category-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    FieldErrorsComponent,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.category ? 'Edit category' : 'New category' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="dialog-form">
        <mat-form-field>
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" cdkFocusInitial />
          <app-field-errors [control]="form.controls.name" label="Name" />
        </mat-form-field>

        <mat-form-field>
          <mat-label>Colour</mat-label>
          <input matInput type="color" formControlName="color" />
          <mat-hint>Used to tint this category in lists.</mat-hint>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Cancel</button>
      <button matButton="filled" [disabled]="form.invalid" (click)="save()">Save</button>
    </mat-dialog-actions>
  `,
  styles: `
    .dialog-form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      min-width: 20rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryDialogComponent {
  private readonly fb = inject(FormBuilder);
  protected readonly data = inject<CategoryDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<CategoryDialogComponent, CategoryDialogResult | undefined>>(MatDialogRef);

  readonly form = this.fb.nonNullable.group({
    name: [
      this.data.category?.name ?? '',
      [Validators.required, Validators.maxLength(50)],
    ],
    color: [this.data.category?.color ?? '#2f80ed'],
  });

  readonly saving = signal(false);

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.dialogRef.close(this.form.getRawValue());
  }
}
```

Create `apps/web/src/app/categories/categories.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import type { CategoryResponse } from '@bill-tracker/shared-types';
import { errorMessage } from '../core/api/api-error';
import { CategoriesStore } from '../core/state/categories.store';
import { ConfirmDialogComponent, ConfirmDialogResult } from '../shared/confirm-dialog.component';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { NotificationService } from '../shared/notification.service';
import {
  CategoryDialogComponent,
  CategoryDialogResult,
} from './category-dialog.component';

@Component({
  selector: 'app-categories',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatListModule,
    MatProgressBarModule,
    EmptyStateComponent,
  ],
  template: `
    <header class="page-header">
      <h1>Categories</h1>
      <button matButton="filled" (click)="openCreate()">
        <mat-icon>add</mat-icon>
        New category
      </button>
    </header>

    @if (store.loading()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (store.error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    } @else if (store.isEmpty()) {
      <app-empty-state
        icon="label"
        title="No categories yet"
        message="Categories group your bills. Create one to start sorting them."
      />
    } @else {
      <mat-list>
        @for (category of store.categories(); track category.id) {
          <mat-list-item>
            <span
              matListItemIcon
              class="swatch"
              [style.background]="category.color ?? 'transparent'"
              aria-hidden="true"
            ></span>
            <span matListItemTitle>{{ category.name }}</span>
            <span matListItemMeta>
              <button
                matIconButton
                [attr.aria-label]="'Edit ' + category.name"
                (click)="openEdit(category)"
              >
                <mat-icon>edit</mat-icon>
              </button>
              <button
                matIconButton
                [attr.aria-label]="'Delete ' + category.name"
                (click)="confirmRemove(category)"
              >
                <mat-icon>delete</mat-icon>
              </button>
            </span>
          </mat-list-item>
        }
      </mat-list>
    }

    @if (lastError(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }
  `,
  styles: `
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .swatch {
      width: 1.25rem;
      height: 1.25rem;
      border-radius: 50%;
      border: 1px solid var(--mat-sys-outline-variant);
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriesComponent {
  protected readonly store = inject(CategoriesStore);
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);

  readonly lastError = signal<string | null>(null);

  constructor() {
    void this.store.load();
  }

  async openCreate(): Promise<void> {
    const result = await this.openDialog(null);
    if (!result) return;

    try {
      await this.store.create(result);
      this.notifications.success(`Created ${result.name}`);
      this.lastError.set(null);
    } catch (error: unknown) {
      this.lastError.set(errorMessage(error));
    }
  }

  async openEdit(category: CategoryResponse): Promise<void> {
    const result = await this.openDialog(category);
    if (!result) return;

    try {
      await this.store.update(category.id, result);
      this.lastError.set(null);
    } catch (error: unknown) {
      this.lastError.set(errorMessage(error));
    }
  }

  /**
   * A 409 here is informative, not a failure to retry: it names how many
   * bills still reference the category, and that count is the only thing
   * that tells a person what to do next. It belongs on the page, not in a
   * snack bar that disappears while they read it.
   */
  async confirmRemove(category: CategoryResponse): Promise<void> {
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialogComponent, unknown, ConfirmDialogResult>(ConfirmDialogComponent, {
          data: {
            title: `Delete ${category.name}?`,
            message: 'Bills using this category must be reassigned or deleted first.',
            confirmLabel: 'Delete',
          },
        })
        .afterClosed(),
    );
    if (confirmed !== 'confirm') return;

    try {
      await this.store.remove(category.id);
      this.lastError.set(null);
      this.notifications.success(`Deleted ${category.name}`);
    } catch (error: unknown) {
      this.lastError.set(errorMessage(error));
    }
  }

  private openDialog(category: CategoryResponse | null): Promise<CategoryDialogResult | undefined> {
    return firstValueFrom(
      this.dialog
        .open<CategoryDialogComponent, unknown, CategoryDialogResult | undefined>(
          CategoryDialogComponent,
          { data: { category } },
        )
        .afterClosed(),
    );
  }
}
```

- [ ] **Step 8: Register the route**

In `apps/web/src/app/app.routes.ts`, add to the shell route's `children`
array, after the redirect:

```ts
{
  path: 'categories',
  loadComponent: () =>
    import('./categories/categories.component').then((m) => m.CategoriesComponent),
},
```

- [ ] **Step 9: Add the guard tests that Task 8 could not run**

`/categories` is the first protected child the shell has, so this is the
first point at which `authGuard` is reachable at all. Until now a
navigation to a protected path backtracked past the `''` route and landed
on `**` without the guard ever running.

Append to `apps/web/src/app/app.spec.ts`:

```ts
describe('the guarded area', () => {
  it('sends an anonymous visitor to the login screen', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/categories');
    await fixture.whenStable();

    expect(router.url).toContain('/login');
  });

  it('carries the attempted path so they land where they were going', async () => {
    const router = TestBed.inject(Router);
    const fixture = TestBed.createComponent(App);

    await router.navigateByUrl('/categories');
    await fixture.whenStable();

    expect(decodeURIComponent(router.url)).toContain('returnUrl=/categories');
  });
});
```

- [ ] **Step 10: Run the test to verify it passes**

Run: `npx nx test web`
Expected: PASS, the store suite, the component suite, and the routing
suite.

- [ ] **Step 11: Prove the loaded-versus-empty distinction is tested**

Temporarily change `isEmpty` to `computed(() => this.items().length === 0)`.

Run: `npx nx test web`
Expected: FAIL on "does not report emptiness before the first load has
finished" and on "shows no empty state while the first load is still in
flight".

Restore and re-run. Expected: PASS. This is the difference between an
empty state and a bug report.

- [ ] **Step 12: Commit**

```bash
git add apps/web/src/app/core/state/categories.store.ts \
        apps/web/src/app/core/state/categories.store.spec.ts \
        apps/web/src/app/categories \
        apps/web/src/app/app.routes.ts \
        apps/web/src/app/app.spec.ts
git commit -m "feat(web): manage categories, and establish the signal store pattern"
```

---

## Task 10: Bill templates — list, form, and the destructive-delete dialog

Spec §7.2, §10, §11. Follows the store shape from Task 9.

**One new idea:** `BillsStore` exposes a `mutations` counter that
increments whenever a template change may have altered generated
instances — create, update, and delete all qualify (bills spec §5.4,
§7.1). Task 11's instance store watches that counter and invalidates its
range. The dependency points that way deliberately: the bills store knows
nothing about instances, and the store that owns the stale data is the one
that decides what to do about it.

**Files:**
- Create: `apps/web/src/app/core/state/bills.store.ts` and `bills.store.spec.ts`
- Create: `apps/web/src/app/bills/bills.component.ts` and `bills.component.spec.ts`
- Create: `apps/web/src/app/bills/bill-form.component.ts` and `bill-form.component.spec.ts`
- Create: `apps/web/src/app/bills/date-range.validator.ts` and `date-range.validator.spec.ts`
- Modify: `apps/web/src/app/app.routes.ts`

**Interfaces:**
- Consumes: `BillsApi`, `CategoriesStore`, `SessionService`, the shared kit, `CalendarDatePipe` and `today()` (Task 3), `provideCalendarDateAdapter` already application-wide (Task 4).
- Produces:
  - `BillsStore` with `bills`, `loading`, `error`, `isEmpty`, `mutations: Signal<number>`, `load(force?)`, `get(id): Promise<BillResponse>`, `create(body)`, `update(id, body)`, `remove(id)`, `reset()`
  - `endDateAfterStart: ValidatorFn` — a group-level validator keyed `endBeforeStart`
  - `BillsComponent`, `BillFormComponent`

- [ ] **Step 1: Write the failing range-validator test**

Create `apps/web/src/app/bills/date-range.validator.spec.ts`:

```ts
import { FormBuilder } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { endDateAfterStart } from './date-range.validator';

const fb = new FormBuilder();

function group(startDate: string | null, endDate: string | null) {
  return fb.group({ startDate: [startDate], endDate: [endDate] }, { validators: [endDateAfterStart] });
}

describe('endDateAfterStart', () => {
  it('accepts an end date after the start', () => {
    expect(group('2026-01-01', '2026-12-31').errors).toBeNull();
  });

  it('accepts an end date equal to the start, since a one-day window is legal', () => {
    expect(group('2026-01-01', '2026-01-01').errors).toBeNull();
  });

  it('rejects an end date before the start', () => {
    expect(group('2026-12-31', '2026-01-01').errors).toEqual({ endBeforeStart: true });
  });

  it('accepts a missing end date, which means the bill never ends', () => {
    expect(group('2026-01-01', null).errors).toBeNull();
    expect(group('2026-01-01', '').errors).toBeNull();
  });

  it('says nothing when the start date is missing, leaving that to required', () => {
    expect(group(null, '2026-01-01').errors).toBeNull();
  });

  it('compares across a year boundary rather than by day of month', () => {
    // A naive comparison on the day number alone calls this valid.
    expect(group('2026-12-01', '2025-12-31').errors).toEqual({ endBeforeStart: true });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx nx test web --include='**/date-range.validator.spec.ts'`
Expected: FAIL — cannot resolve `./date-range.validator`.

- [ ] **Step 3: Write the validator**

Create `apps/web/src/app/bills/date-range.validator.ts`:

```ts
import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { compare, isCalendarDate } from '../core/date/calendar-date';

/**
 * A group-level validator, because the rule is about the pair rather than
 * either control: the API requires `endDate` to be null or `>= startDate`.
 *
 * Comparison goes through `compare`, which is lexicographic over
 * zero-padded ISO dates — correct across month and year boundaries, which
 * a day-of-month comparison is not.
 */
export const endDateAfterStart: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const startDate = control.get('startDate')?.value;
  const endDate = control.get('endDate')?.value;

  if (!isCalendarDate(startDate) || !isCalendarDate(endDate)) return null;
  return compare(endDate, startDate) < 0 ? { endBeforeStart: true } : null;
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx nx test web --include='**/date-range.validator.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Write the failing store test**

Create `apps/web/src/app/core/state/bills.store.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../auth/session.service';
import { BillsStore } from './bills.store';

let http: HttpTestingController;
let store: BillsStore;
let session: SessionService;

const rent = {
  id: 'bill-1',
  categoryId: 'cat-1',
  name: 'Rent',
  defaultAmount: 1200,
  frequency: 'MONTHLY' as const,
  startDate: '2026-01-01',
  endDate: null,
  isActive: true,
};

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada',
  notifyEmail: true,
  notifyInApp: true,
};

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  http = TestBed.inject(HttpTestingController);
  session = TestBed.inject(SessionService);
  session.signIn({ accessToken: 'token-1', user: profile });
  store = TestBed.inject(BillsStore);
});

afterEach(() => {
  http.verify();
});

async function seed() {
  const loaded = store.load();
  http.expectOne((r) => r.url === '/api/bills').flush([rent]);
  await loaded;
}

describe('load', () => {
  it('fills the store and reports emptiness only after a successful load', async () => {
    expect(store.isEmpty()).toBe(false);
    await seed();

    expect(store.bills()).toEqual([rent]);
    expect(store.isEmpty()).toBe(false);
  });

  it('reports an empty account as empty', async () => {
    const loaded = store.load();
    http.expectOne((r) => r.url === '/api/bills').flush([]);
    await loaded;

    expect(store.isEmpty()).toBe(true);
  });
});

describe('get', () => {
  it('reads one bill without disturbing the list', async () => {
    await seed();

    const fetched = store.get('bill-1');
    http.expectOne('/api/bills/bill-1').flush(rent);

    expect(await fetched).toEqual(rent);
    expect(store.bills()).toEqual([rent]);
  });
});

describe('the mutations counter', () => {
  it('starts at zero', () => {
    expect(store.mutations()).toBe(0);
  });

  it('increments on create, because the server generates instances synchronously', async () => {
    await seed();
    const before = store.mutations();

    const created = store.create({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-01-01',
    });
    http.expectOne((r) => r.url === '/api/bills').flush({ ...rent, id: 'bill-2', name: 'Water' });
    await created;

    expect(store.mutations()).toBe(before + 1);
    expect(store.bills()).toHaveLength(2);
  });

  it('increments on update, because a template edit rewrites future instances', async () => {
    await seed();
    const before = store.mutations();

    const updated = store.update('bill-1', { defaultAmount: 1300 });
    http.expectOne('/api/bills/bill-1').flush({ ...rent, defaultAmount: 1300 });
    await updated;

    expect(store.mutations()).toBe(before + 1);
    expect(store.bills()[0].defaultAmount).toBe(1300);
  });

  it('increments on delete, because the delete cascades through instances', async () => {
    await seed();
    const before = store.mutations();

    const removed = store.remove('bill-1');
    http.expectOne('/api/bills/bill-1').flush(null);
    await removed;

    expect(store.mutations()).toBe(before + 1);
    expect(store.bills()).toEqual([]);
  });

  it('does not increment when a mutation fails', async () => {
    // Nothing changed on the server, so nothing downstream is stale.
    await seed();
    const before = store.mutations();

    const updated = store.update('bill-1', { defaultAmount: -1 });
    http
      .expectOne('/api/bills/bill-1')
      .flush({ message: ['bad'] }, { status: 400, statusText: 'Bad Request' });
    await expect(updated).rejects.toBeDefined();

    expect(store.mutations()).toBe(before);
  });
});

describe('session lifecycle', () => {
  it('empties itself when the session ends', async () => {
    await seed();

    session.clear();
    TestBed.tick();

    expect(store.bills()).toEqual([]);
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx nx test web --include='**/bills.store.spec.ts'`
Expected: FAIL — cannot resolve `./bills.store`.

- [ ] **Step 7: Write the store**

Create `apps/web/src/app/core/state/bills.store.ts`:

```ts
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  BillResponse,
  CreateBillRequest,
  UpdateBillRequest,
} from '@bill-tracker/shared-types';
import { BillsApi } from '../api/bills.api';
import { errorMessage } from '../api/api-error';
import { SessionService } from '../auth/session.service';

@Injectable({ providedIn: 'root' })
export class BillsStore {
  private readonly api = inject(BillsApi);
  private readonly session = inject(SessionService);

  private readonly items = signal<BillResponse[]>([]);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly loaded = signal(false);
  private readonly mutationCount = signal(0);

  readonly bills = this.items.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly isEmpty = computed(() => this.loaded() && this.items().length === 0);

  /**
   * Increments after every successful template change.
   *
   * Each of the three mutations alters generated instances in a way the
   * client cannot predict: `POST` generates them synchronously, `PATCH`
   * rewrites untouched future ones by the rule in bills spec §5.4, and
   * `DELETE` cascades through instances and payment logs. The instance
   * store watches this counter and refetches.
   *
   * Reimplementing the rewrite rule here to avoid that refetch would put
   * the same business rule in two codebases, and the copy would drift.
   */
  readonly mutations = this.mutationCount.asReadonly();

  constructor() {
    effect(() => {
      if (!this.session.isAuthenticated()) this.reset();
    });
  }

  async load(force = false): Promise<void> {
    if (this.loaded() && !force) return;

    this.loadingState.set(true);
    this.errorState.set(null);
    try {
      this.items.set(await firstValueFrom(this.api.list()));
      this.loaded.set(true);
    } catch (error: unknown) {
      this.errorState.set(errorMessage(error));
    } finally {
      this.loadingState.set(false);
    }
  }

  /** Reads one bill directly, so an edit form opened by URL works on a cold store. */
  get(id: string): Promise<BillResponse> {
    return firstValueFrom(this.api.get(id));
  }

  async create(body: CreateBillRequest): Promise<BillResponse> {
    const created = await firstValueFrom(this.api.create(body));
    this.items.update((current) => [...current, created]);
    this.mutationCount.update((count) => count + 1);
    return created;
  }

  async update(id: string, body: UpdateBillRequest): Promise<BillResponse> {
    const updated = await firstValueFrom(this.api.update(id, body));
    this.items.update((current) => current.map((item) => (item.id === id ? updated : item)));
    this.mutationCount.update((count) => count + 1);
    return updated;
  }

  async remove(id: string): Promise<void> {
    await firstValueFrom(this.api.remove(id));
    this.items.update((current) => current.filter((item) => item.id !== id));
    this.mutationCount.update((count) => count + 1);
  }

  reset(): void {
    this.items.set([]);
    this.loaded.set(false);
    this.errorState.set(null);
    this.loadingState.set(false);
  }
}
```

The counter is **not** reset by `reset()`: a monotonic counter is what
makes "has something changed since I last looked" answerable, and
restarting it at zero would make a new session look unchanged to a
watcher that had already seen a higher value.

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx nx test web --include='**/bills.store.spec.ts'`
Expected: PASS.

- [ ] **Step 9: Write the failing list test**

Create `apps/web/src/app/bills/bills.component.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { SessionService } from '../core/auth/session.service';
import { BillsComponent } from './bills.component';

let http: HttpTestingController;

const rent = {
  id: 'bill-1',
  categoryId: 'cat-1',
  name: 'Rent',
  defaultAmount: 1200,
  frequency: 'MONTHLY' as const,
  startDate: '2026-01-01',
  endDate: null,
  isActive: true,
};

function flushInitialLoads(bills: unknown[] = [rent]) {
  http.expectOne((r) => r.url === '/api/bills').flush(bills);
  http.expectOne('/api/categories').flush([{ id: 'cat-1', name: 'Housing', color: null }]);
}

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [BillsComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  TestBed.inject(SessionService).signIn({
    accessToken: 'token-1',
    user: { id: 'user-1', email: 'a@b.c', name: 'Ada', notifyEmail: true, notifyInApp: true },
  });
});

afterEach(() => {
  http.verify();
  vi.restoreAllMocks();
});

describe('BillsComponent', () => {
  it('lists bills with their amount, frequency, and category', async () => {
    const fixture = TestBed.createComponent(BillsComponent);
    await fixture.whenStable();
    flushInitialLoads();
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Rent');
    expect(text).toContain('$1,200.00');
    expect(text).toContain('Monthly');
    expect(text).toContain('Housing');
  });

  it('marks a deactivated bill as inactive', async () => {
    const fixture = TestBed.createComponent(BillsComponent);
    await fixture.whenStable();
    flushInitialLoads([{ ...rent, isActive: false }]);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Inactive');
  });

  it('names the empty state instead of rendering a blank table', async () => {
    const fixture = TestBed.createComponent(BillsComponent);
    await fixture.whenStable();
    flushInitialLoads([]);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('No bills yet');
  });

  it('offers deactivation as the default action when deleting', async () => {
    // The API offers a non-destructive path and the README documents the
    // distinction. The dialog must lead with it rather than with the
    // action that destroys payment history.
    const open = vi
      .spyOn(TestBed.inject(MatDialog), 'open')
      .mockReturnValue({ afterClosed: () => of(undefined) } as never);

    const fixture = TestBed.createComponent(BillsComponent);
    await fixture.whenStable();
    flushInitialLoads();
    await fixture.whenStable();

    await fixture.componentInstance.confirmRemove(rent);

    const data = open.mock.calls[0][1]?.data as { alternateLabel?: string; message: string };
    expect(data.alternateLabel).toBe('Deactivate instead');
    expect(data.message).toContain('payment history');
  });

  it('deactivates rather than deleting when the alternate action is chosen', async () => {
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
      afterClosed: () => of('alternate'),
    } as never);

    const fixture = TestBed.createComponent(BillsComponent);
    await fixture.whenStable();
    flushInitialLoads();
    await fixture.whenStable();

    const done = fixture.componentInstance.confirmRemove(rent);
    const req = http.expectOne('/api/bills/bill-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ isActive: false });
    req.flush({ ...rent, isActive: false });
    await done;
  });

  it('deletes when the destructive action is chosen', async () => {
    vi.spyOn(TestBed.inject(MatDialog), 'open').mockReturnValue({
      afterClosed: () => of('confirm'),
    } as never);

    const fixture = TestBed.createComponent(BillsComponent);
    await fixture.whenStable();
    flushInitialLoads();
    await fixture.whenStable();

    const done = fixture.componentInstance.confirmRemove(rent);
    const req = http.expectOne('/api/bills/bill-1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
    await done;
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `npx nx test web --include='**/bills.component.spec.ts'`
Expected: FAIL — cannot resolve `./bills.component`.

- [ ] **Step 11: Write the list screen**

Create `apps/web/src/app/bills/bills.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { firstValueFrom } from 'rxjs';
import type { BillFrequency, BillResponse } from '@bill-tracker/shared-types';
import { errorMessage } from '../core/api/api-error';
import { BillsStore } from '../core/state/bills.store';
import { CategoriesStore } from '../core/state/categories.store';
import { CalendarDatePipe } from '../core/date/calendar-date.pipe';
import { ConfirmDialogComponent, ConfirmDialogResult } from '../shared/confirm-dialog.component';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { NotificationService } from '../shared/notification.service';
import { formatMoney } from '../shared/money';

export const FREQUENCY_LABELS: Record<BillFrequency, string> = {
  ONE_TIME: 'One time',
  WEEKLY: 'Weekly',
  MONTHLY: 'Monthly',
  ANNUALLY: 'Annually',
};

@Component({
  selector: 'app-bills',
  imports: [
    RouterLink,
    MatButtonModule,
    MatChipsModule,
    MatDialogModule,
    MatIconModule,
    MatProgressBarModule,
    MatTableModule,
    CalendarDatePipe,
    EmptyStateComponent,
  ],
  template: `
    <header class="page-header">
      <h1>Bills</h1>
      <a matButton="filled" routerLink="/bills/new">
        <mat-icon>add</mat-icon>
        New bill
      </a>
    </header>

    @if (store.loading()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (store.error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    } @else if (store.isEmpty()) {
      <app-empty-state
        icon="receipt_long"
        title="No bills yet"
        message="A bill is a template. Create one and the app generates every occurrence it is due on."
      >
        <a matButton="filled" routerLink="/bills/new">Create your first bill</a>
      </app-empty-state>
    } @else {
      <table mat-table [dataSource]="store.bills()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>Name</th>
          <td mat-cell *matCellDef="let bill">
            <a [routerLink]="['/bills', bill.id]">{{ bill.name }}</a>
            @if (!bill.isActive) {
              <mat-chip class="inactive">Inactive</mat-chip>
            }
          </td>
        </ng-container>

        <ng-container matColumnDef="amount">
          <th mat-header-cell *matHeaderCellDef>Amount</th>
          <td mat-cell *matCellDef="let bill">{{ money(bill.defaultAmount) }}</td>
        </ng-container>

        <ng-container matColumnDef="frequency">
          <th mat-header-cell *matHeaderCellDef>Frequency</th>
          <td mat-cell *matCellDef="let bill">{{ frequencyLabel(bill.frequency) }}</td>
        </ng-container>

        <ng-container matColumnDef="category">
          <th mat-header-cell *matHeaderCellDef>Category</th>
          <td mat-cell *matCellDef="let bill">{{ categoryName(bill.categoryId) }}</td>
        </ng-container>

        <ng-container matColumnDef="starts">
          <th mat-header-cell *matHeaderCellDef>Starts</th>
          <td mat-cell *matCellDef="let bill">{{ bill.startDate | calendarDate }}</td>
        </ng-container>

        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef aria-label="Actions"></th>
          <td mat-cell *matCellDef="let bill">
            <button
              matIconButton
              [attr.aria-label]="'Delete ' + bill.name"
              (click)="confirmRemove(bill)"
            >
              <mat-icon>delete</mat-icon>
            </button>
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>
    }

    @if (lastError(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }
  `,
  styles: `
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    table {
      width: 100%;
    }
    .inactive {
      margin-left: 0.5rem;
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BillsComponent {
  protected readonly store = inject(BillsStore);
  private readonly categories = inject(CategoriesStore);
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);

  protected readonly columns = ['name', 'amount', 'frequency', 'category', 'starts', 'actions'];
  readonly lastError = signal<string | null>(null);

  private readonly categoryNames = computed(
    () => new Map(this.categories.categories().map((c) => [c.id, c.name])),
  );

  constructor() {
    void this.store.load();
    void this.categories.load();
  }

  protected money(value: number): string {
    return formatMoney(value);
  }

  protected frequencyLabel(frequency: BillFrequency): string {
    return FREQUENCY_LABELS[frequency];
  }

  protected categoryName(categoryId: string | null): string {
    return categoryId === null ? 'Uncategorised' : (this.categoryNames().get(categoryId) ?? '—');
  }

  /**
   * Deleting a bill is a real delete that cascades through its instances
   * and their payment logs. The API offers `PATCH { isActive: false }` as
   * the non-destructive path, so the dialog offers it too — and gives it
   * initial focus, because losing payment history to a reflexive Enter
   * keypress is not a recoverable mistake.
   */
  async confirmRemove(bill: BillResponse): Promise<void> {
    const choice = await firstValueFrom(
      this.dialog
        .open<ConfirmDialogComponent, unknown, ConfirmDialogResult>(ConfirmDialogComponent, {
          data: {
            title: `Delete ${bill.name}?`,
            message:
              'This permanently deletes the bill, every occurrence it generated, and their payment history. Deactivating stops new occurrences and keeps every record.',
            confirmLabel: 'Delete permanently',
            alternateLabel: 'Deactivate instead',
          },
        })
        .afterClosed(),
    );

    try {
      if (choice === 'confirm') {
        await this.store.remove(bill.id);
        this.notifications.success(`Deleted ${bill.name}`);
      } else if (choice === 'alternate') {
        await this.store.update(bill.id, { isActive: false });
        this.notifications.success(`Deactivated ${bill.name}`);
      } else {
        return;
      }
      this.lastError.set(null);
    } catch (error: unknown) {
      this.lastError.set(errorMessage(error));
    }
  }
}
```

- [ ] **Step 12: Write the failing form test**

Create `apps/web/src/app/bills/bill-form.component.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { BillFormComponent } from './bill-form.component';

let http: HttpTestingController;
let router: Router;

const rent = {
  id: 'bill-1',
  categoryId: 'cat-1',
  name: 'Rent',
  defaultAmount: 1200,
  frequency: 'MONTHLY' as const,
  startDate: '2026-01-01',
  endDate: null,
  isActive: true,
};

function configure(id: string | null) {
  TestBed.configureTestingModule({
    imports: [BillFormComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      { provide: ActivatedRoute, useValue: { snapshot: { paramMap: new Map([['id', id]]) } } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  router = TestBed.inject(Router);
  TestBed.inject(SessionService).signIn({
    accessToken: 'token-1',
    user: { id: 'user-1', email: 'a@b.c', name: 'Ada', notifyEmail: true, notifyInApp: true },
  });
}

afterEach(() => {
  http.verify();
  vi.restoreAllMocks();
});

describe('creating', () => {
  beforeEach(() => configure(null));

  it('posts the new bill and returns to the list', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    await fixture.whenStable();

    fixture.componentInstance.form.patchValue({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-02-01',
    });
    fixture.componentInstance.submit();

    const req = http.expectOne((r) => r.url === '/api/bills' && r.method === 'POST');
    expect(req.request.body).toEqual({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-02-01',
      endDate: null,
      categoryId: null,
    });
    req.flush({ ...rent, id: 'bill-2', name: 'Water' });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith('/bills');
  });

  it('sends startDate as a bare YYYY-MM-DD string, never a Date', async () => {
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    await fixture.whenStable();

    fixture.componentInstance.form.patchValue({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-02-01',
    });
    fixture.componentInstance.submit();

    const req = http.expectOne((r) => r.url === '/api/bills' && r.method === 'POST');
    expect(req.request.body.startDate).toBe('2026-02-01');
    expect(typeof req.request.body.startDate).toBe('string');
    req.flush(rent);
  });

  it('refuses to submit when the end date precedes the start', async () => {
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    await fixture.whenStable();

    fixture.componentInstance.form.patchValue({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-12-01',
      endDate: '2026-01-01',
    });
    fixture.componentInstance.submit();

    expect(http.match((r) => r.method === 'POST')).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('end date');
  });

  it('attaches a server field error to its control', async () => {
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    await fixture.whenStable();

    fixture.componentInstance.form.patchValue({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-02-01',
    });
    fixture.componentInstance.submit();

    http.expectOne((r) => r.method === 'POST').flush(
      {
        message: ['defaultAmount must be a positive number'],
        errors: { defaultAmount: ['defaultAmount must be a positive number'] },
      },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(fixture.componentInstance.form.controls.defaultAmount.errors).toMatchObject({
      server: 'defaultAmount must be a positive number',
    });
  });

  it('shows a service-raised 400 in the banner, since it names no field', async () => {
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    await fixture.whenStable();

    fixture.componentInstance.form.patchValue({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-02-01',
    });
    fixture.componentInstance.submit();

    http
      .expectOne((r) => r.method === 'POST')
      .flush({ message: 'Category not found' }, { status: 400, statusText: 'Bad Request' });
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Category not found');
  });
});

describe('editing', () => {
  beforeEach(() => configure('bill-1'));

  it('loads the bill into the form', async () => {
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    http.expectOne('/api/bills/bill-1').flush(rent);
    await fixture.whenStable();

    expect(fixture.componentInstance.form.getRawValue()).toMatchObject({
      name: 'Rent',
      defaultAmount: 1200,
      startDate: '2026-01-01',
    });
  });

  it('warns that saving rewrites untouched future occurrences', async () => {
    // Bills spec §5.4. A person who does not expect this will be
    // surprised by it, and the surprise lands on their own data.
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    http.expectOne('/api/bills/bill-1').flush(rent);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('future');
    expect(fixture.nativeElement.textContent).toContain('unpaid');
  });

  it('shows no such warning when creating', async () => {
    TestBed.resetTestingModule();
    configure(null);
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).not.toContain('untouched');
  });

  it('patches only the bill and returns to the list', async () => {
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(BillFormComponent);
    await fixture.whenStable();
    http.expectOne('/api/categories').flush([]);
    http.expectOne('/api/bills/bill-1').flush(rent);
    await fixture.whenStable();

    fixture.componentInstance.form.patchValue({ defaultAmount: 1300 });
    fixture.componentInstance.submit();

    const req = http.expectOne((r) => r.url === '/api/bills/bill-1' && r.method === 'PATCH');
    expect(req.request.body.defaultAmount).toBe(1300);
    req.flush({ ...rent, defaultAmount: 1300 });
    await fixture.whenStable();

    expect(navigate).toHaveBeenCalledWith('/bills');
  });
});
```

- [ ] **Step 13: Run the test to verify it fails**

Run: `npx nx test web --include='**/bill-form.component.spec.ts'`
Expected: FAIL — cannot resolve `./bill-form.component`.

- [ ] **Step 14: Write the form**

Create `apps/web/src/app/bills/bill-form.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { BILL_FREQUENCIES } from '@bill-tracker/shared-types';
import type { BillFrequency } from '@bill-tracker/shared-types';
import { errorMessage } from '../core/api/api-error';
import { BillsStore } from '../core/state/bills.store';
import { CategoriesStore } from '../core/state/categories.store';
import { FieldErrorsComponent } from '../shared/field-errors.component';
import { NotificationService } from '../shared/notification.service';
import { MAX_AMOUNT, amountValidators } from '../shared/money';
import { applyServerErrors } from '../shared/server-errors';
import { endDateAfterStart } from './date-range.validator';
import { FREQUENCY_LABELS } from './bills.component';

@Component({
  selector: 'app-bill-form',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    FieldErrorsComponent,
  ],
  template: `
    <mat-card>
      @if (busy()) {
        <mat-progress-bar mode="indeterminate" />
      }
      <mat-card-header>
        <mat-card-title>{{ billId() ? 'Edit bill' : 'New bill' }}</mat-card-title>
      </mat-card-header>

      <mat-card-content>
        @if (billId()) {
          <p class="notice" role="status">
            Saving rewrites every future occurrence that is still unpaid and has not been
            edited on its own. Occurrences you have already paid or customised are left alone.
          </p>
        }

        @for (message of formErrors(); track message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }

        <form [formGroup]="form" (ngSubmit)="submit()">
          <mat-form-field>
            <mat-label>Name</mat-label>
            <input matInput formControlName="name" />
            <app-field-errors [control]="form.controls.name" label="Name" />
          </mat-form-field>

          <mat-form-field>
            <mat-label>Amount</mat-label>
            <input matInput type="number" step="0.01" min="0.01" [max]="maxAmount" formControlName="defaultAmount" />
            <span matTextPrefix>$&nbsp;</span>
            <app-field-errors [control]="form.controls.defaultAmount" label="Amount" />
          </mat-form-field>

          <mat-form-field>
            <mat-label>Frequency</mat-label>
            <mat-select formControlName="frequency">
              @for (frequency of frequencies; track frequency) {
                <mat-option [value]="frequency">{{ label(frequency) }}</mat-option>
              }
            </mat-select>
            <app-field-errors [control]="form.controls.frequency" label="Frequency" />
          </mat-form-field>

          <mat-form-field>
            <mat-label>Category</mat-label>
            <mat-select formControlName="categoryId">
              <mat-option [value]="null">Uncategorised</mat-option>
              @for (category of categories.categories(); track category.id) {
                <mat-option [value]="category.id">{{ category.name }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field>
            <mat-label>Starts</mat-label>
            <input matInput [matDatepicker]="startPicker" formControlName="startDate" />
            <mat-datepicker-toggle matIconSuffix [for]="startPicker" />
            <mat-datepicker #startPicker />
            <app-field-errors [control]="form.controls.startDate" label="Start date" />
          </mat-form-field>

          <mat-form-field>
            <mat-label>Ends (optional)</mat-label>
            <input matInput [matDatepicker]="endPicker" formControlName="endDate" />
            <mat-datepicker-toggle matIconSuffix [for]="endPicker" />
            <mat-datepicker #endPicker />
            <mat-hint>Leave empty for a bill that never ends.</mat-hint>
          </mat-form-field>

          @if (form.errors?.['endBeforeStart']) {
            <p class="form-error" role="alert">The end date must not precede the start date.</p>
          }

          @if (billId()) {
            <mat-checkbox formControlName="isActive">
              Active — generate future occurrences
            </mat-checkbox>
          }

          <div class="actions">
            <a matButton routerLink="/bills">Cancel</a>
            <button matButton="filled" type="submit" [disabled]="busy()">Save</button>
          </div>
        </form>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    mat-card {
      max-width: 36rem;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 0.5rem;
      margin-top: 1rem;
    }
    .notice {
      margin: 0 0 1rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .form-error {
      margin: 0 0 1rem;
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BillFormComponent {
  private readonly fb = inject(FormBuilder);
  private readonly store = inject(BillsStore);
  protected readonly categories = inject(CategoriesStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly notifications = inject(NotificationService);

  protected readonly frequencies = BILL_FREQUENCIES;
  protected readonly maxAmount = MAX_AMOUNT;

  readonly billId = signal<string | null>(this.route.snapshot.paramMap.get('id'));
  readonly submitting = signal(false);
  readonly loading = signal(false);
  readonly busy = computed(() => this.submitting() || this.loading());
  readonly formErrors = signal<string[]>([]);

  readonly form = this.fb.nonNullable.group(
    {
      name: ['', [Validators.required, Validators.maxLength(100)]],
      defaultAmount: [0, amountValidators],
      frequency: ['MONTHLY' as BillFrequency, [Validators.required]],
      categoryId: this.fb.control<string | null>(null),
      startDate: ['', [Validators.required]],
      endDate: this.fb.control<string | null>(null),
      isActive: [true],
    },
    { validators: [endDateAfterStart] },
  );

  constructor() {
    void this.categories.load();
    const id = this.billId();
    if (id !== null) void this.loadBill(id);
  }

  protected label(frequency: BillFrequency): string {
    return FREQUENCY_LABELS[frequency];
  }

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.formErrors.set([]);

    const raw = this.form.getRawValue();
    const id = this.billId();
    const body = {
      name: raw.name,
      defaultAmount: raw.defaultAmount,
      frequency: raw.frequency,
      startDate: raw.startDate,
      endDate: raw.endDate === '' ? null : raw.endDate,
      categoryId: raw.categoryId,
    };

    const saved = id === null ? this.store.create(body) : this.store.update(id, { ...body, isActive: raw.isActive });

    saved
      .then(() => {
        this.notifications.success(id === null ? 'Bill created' : 'Bill saved');
        void this.router.navigateByUrl('/bills');
      })
      .catch((error: unknown) => {
        this.formErrors.set(applyServerErrors(this.form, error));
      })
      .finally(() => this.submitting.set(false));
  }

  private async loadBill(id: string): Promise<void> {
    this.loading.set(true);
    try {
      const bill = await this.store.get(id);
      this.form.patchValue(bill);
    } catch (error: unknown) {
      this.formErrors.set([errorMessage(error)]);
    } finally {
      this.loading.set(false);
    }
  }
}
```

- [ ] **Step 15: Register the routes**

In `apps/web/src/app/app.routes.ts`, add to the shell route's `children`,
**before** the `categories` entry so the more specific `bills/new` is
declared before `bills/:id`:

```ts
{
  path: 'bills',
  loadComponent: () => import('./bills/bills.component').then((m) => m.BillsComponent),
},
{
  path: 'bills/new',
  loadComponent: () => import('./bills/bill-form.component').then((m) => m.BillFormComponent),
},
{
  path: 'bills/:id',
  loadComponent: () => import('./bills/bill-form.component').then((m) => m.BillFormComponent),
},
```

- [ ] **Step 16: Run the tests to verify they pass**

Run: `npx nx test web`
Expected: PASS.

- [ ] **Step 17: Prove the deactivate-first dialog is tested**

Temporarily remove `alternateLabel: 'Deactivate instead'` from the dialog
data in `BillsComponent.confirmRemove`.

Run: `npx nx test web --include='**/bills.component.spec.ts'`
Expected: FAIL on "offers deactivation as the default action when
deleting" and on "deactivates rather than deleting when the alternate
action is chosen".

Restore and re-run. Expected: PASS.

- [ ] **Step 18: Commit**

```bash
git add apps/web/src/app/core/state/bills.store.ts \
        apps/web/src/app/core/state/bills.store.spec.ts \
        apps/web/src/app/bills \
        apps/web/src/app/app.routes.ts
git commit -m "feat(web): manage bill templates, with deactivate offered before delete"
```

---

## Task 11: Bill instances — the `/upcoming` screen

Spec §7.1, §7.2, §8.2, §11. The daily-use screen, and the task that
carries three of the five Review Focus items.

**The 400-day cap measures a difference, not a day count.** The API
rejects when `to > from + 400`, so a 401-day *inclusive* span is legal —
`apps/api/src/bills/bill-instances.service.ts:17` says so in as many
words. A client that counts inclusive days rejects a range the server
would have accepted, and the person sees a message about a limit that is
not real. Both sides of the boundary are tested below.

**Files:**
- Create: `apps/web/src/app/core/state/instances.store.ts` and `instances.store.spec.ts`
- Create: `apps/web/src/app/instances/upcoming.component.ts` and `upcoming.component.spec.ts`
- Create: `apps/web/src/app/instances/instance-row.component.ts`
- Modify: `apps/web/src/app/app.routes.ts`

**Interfaces:**
- Consumes: `BillInstancesApi`, `BillInstanceQuery` (Task 5); `BillsStore.mutations` (Task 10); `CalendarDate` helpers (Task 3); the shared kit (Task 7).
- Produces:
  - `MAX_RANGE_DAYS = 400`
  - `rangeError(from: CalendarDate, to: CalendarDate): string | null`
  - `InstancesStore` with `instances`, `loading`, `error`, `isEmpty`, `query: Signal<BillInstanceQuery>`, `setQuery(query): Promise<void>`, `refresh(): Promise<void>`, `patch(instance: BillInstanceResponse): void`, `reset()`
  - `UpcomingComponent` with `refreshIfDayChanged(now?: CalendarDate): void`
  - `InstanceRowComponent`

- [ ] **Step 1: Write the failing store test**

Create `apps/web/src/app/core/state/instances.store.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../auth/session.service';
import { BillsStore } from './bills.store';
import { InstancesStore, MAX_RANGE_DAYS, rangeError } from './instances.store';

let http: HttpTestingController;
let store: InstancesStore;
let bills: BillsStore;
let session: SessionService;

const instance = {
  id: 'inst-1',
  billId: 'bill-1',
  billName: 'Rent',
  categoryId: 'cat-1',
  dueDate: '2026-10-01',
  amount: 1200,
  amountPaid: 0,
  status: 'UNPAID' as const,
  isOverdue: true,
  isCustomized: false,
  paidAt: null,
  note: null,
};

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada',
  notifyEmail: true,
  notifyInApp: true,
};

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  http = TestBed.inject(HttpTestingController);
  session = TestBed.inject(SessionService);
  session.signIn({ accessToken: 'token-1', user: profile });
  bills = TestBed.inject(BillsStore);
  store = TestBed.inject(InstancesStore);
});

afterEach(() => {
  http.verify();
});

function instanceRequest() {
  return http.expectOne((r) => r.url === '/api/bill-instances');
}

describe('rangeError', () => {
  it('accepts an ordinary month', () => {
    expect(rangeError('2026-10-01', '2026-10-31')).toBeNull();
  });

  it('accepts a single day', () => {
    expect(rangeError('2026-10-01', '2026-10-01')).toBeNull();
  });

  it('accepts a difference of exactly 400 days, which is a 401-day inclusive span', () => {
    // The API compares `to` against `from + 400` days. Counting inclusive
    // days instead would reject this, and the message would describe a
    // limit the server does not enforce.
    expect(rangeError('2026-01-01', '2027-02-05')).toBeNull();
  });

  it('rejects a difference of 401 days', () => {
    expect(rangeError('2026-01-01', '2027-02-06')).toContain(String(MAX_RANGE_DAYS));
  });

  it('rejects an end date before the start', () => {
    expect(rangeError('2026-10-31', '2026-10-01')).toContain('precede');
  });

  it('rejects a malformed date', () => {
    expect(rangeError('20261001', '2026-10-31')).not.toBeNull();
    expect(rangeError('2026-02-31', '2026-10-31')).not.toBeNull();
  });
});

describe('setQuery', () => {
  it('sends the range and stores the result', async () => {
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    const req = instanceRequest();
    expect(req.request.params.get('from')).toBe('2026-10-01');
    expect(req.request.params.get('to')).toBe('2026-10-31');
    req.flush([instance]);
    await done;

    expect(store.instances()).toEqual([instance]);
    expect(store.query().from).toBe('2026-10-01');
  });

  it('refuses an over-wide range without sending anything', async () => {
    // Review Focus 2. The cap is the client's job to respect; letting the
    // request go out turns a fixable mistake into a 400.
    await store.setQuery({ from: '2026-01-01', to: '2027-06-01' });

    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
    expect(store.error()).toContain(String(MAX_RANGE_DAYS));
  });

  it('refuses a backwards range without sending anything', async () => {
    await store.setQuery({ from: '2026-10-31', to: '2026-10-01' });

    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
    expect(store.error()).toContain('precede');
  });

  it('keeps the previous rows when a new range is refused', async () => {
    const first = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush([instance]);
    await first;

    await store.setQuery({ from: '2026-01-01', to: '2027-06-01' });

    expect(store.instances()).toEqual([instance]);
  });

  it('passes the optional filters through', async () => {
    const done = store.setQuery({
      from: '2026-10-01',
      to: '2026-10-31',
      status: 'UNPAID',
      overdue: true,
      billId: 'bill-1',
    });
    const req = instanceRequest();
    expect(req.request.params.get('status')).toBe('UNPAID');
    expect(req.request.params.get('overdue')).toBe('true');
    expect(req.request.params.get('billId')).toBe('bill-1');
    req.flush([]);
    await done;
  });

  it('reports emptiness only after a load has succeeded', async () => {
    expect(store.isEmpty()).toBe(false);

    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    expect(store.isEmpty()).toBe(false);
    instanceRequest().flush([]);
    await done;

    expect(store.isEmpty()).toBe(true);
  });

  it('does not report emptiness after a failed load', async () => {
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush(null, { status: 500, statusText: 'Server Error' });
    await done;

    expect(store.isEmpty()).toBe(false);
    expect(store.error()).not.toBeNull();
  });
});

describe('patch', () => {
  it('replaces one row in place', async () => {
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush([instance]);
    await done;

    store.patch({ ...instance, status: 'PAID', amountPaid: 1200 });

    expect(store.instances()[0].status).toBe('PAID');
    expect(store.instances()).toHaveLength(1);
    // No follow-up read: the payment endpoints already returned the row.
    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
  });

  it('ignores a row that is not in the current range', async () => {
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush([instance]);
    await done;

    store.patch({ ...instance, id: 'inst-999' });

    expect(store.instances()).toHaveLength(1);
    expect(store.instances()[0].id).toBe('inst-1');
  });
});

describe('invalidation by template changes', () => {
  it('refetches when a bill is created, updated, or deleted', async () => {
    // The server generates, rewrites, and cascades. None of it is
    // predictable here, so the only correct answer is to ask again.
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush([instance]);
    await done;

    const created = bills.create({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-10-01',
    });
    http.expectOne((r) => r.url === '/api/bills').flush({
      id: 'bill-2',
      categoryId: null,
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-10-01',
      endDate: null,
      isActive: true,
    });
    await created;
    TestBed.tick();

    instanceRequest().flush([instance, { ...instance, id: 'inst-2', billName: 'Water' }]);

    // The refetch is started from inside an effect, so it settles a few
    // microtasks later than the flush.
    await vi.waitFor(() => expect(store.instances()).toHaveLength(2));
  });

  it('does not refetch before any range has been loaded', () => {
    bills.create({
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-10-01',
    });
    http.expectOne((r) => r.url === '/api/bills').flush({
      id: 'bill-2',
      categoryId: null,
      name: 'Water',
      defaultAmount: 60,
      frequency: 'MONTHLY',
      startDate: '2026-10-01',
      endDate: null,
      isActive: true,
    });
    TestBed.tick();

    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
  });
});

describe('session lifecycle', () => {
  it('empties itself when the session ends', async () => {
    const done = store.setQuery({ from: '2026-10-01', to: '2026-10-31' });
    instanceRequest().flush([instance]);
    await done;

    session.clear();
    TestBed.tick();

    expect(store.instances()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx nx test web --include='**/instances.store.spec.ts'`
Expected: FAIL — cannot resolve `./instances.store`.

- [ ] **Step 3: Write the store**

Create `apps/web/src/app/core/state/instances.store.ts`:

```ts
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { BillInstanceResponse } from '@bill-tracker/shared-types';
import { BillInstancesApi, BillInstanceQuery } from '../api/bill-instances.api';
import { errorMessage } from '../api/api-error';
import { SessionService } from '../auth/session.service';
import { BillsStore } from './bills.store';
import {
  CalendarDate,
  addDays,
  compare,
  endOfMonth,
  isCalendarDate,
  startOfMonth,
  today,
} from '../date/calendar-date';

/**
 * The API rejects when `to` is later than `from` plus this many days —
 * a *difference*, not an inclusive count, so a 401-day span is legal.
 * See `apps/api/src/bills/bill-instances.service.ts`. Measuring it as a
 * day count here would reject ranges the server accepts and explain the
 * refusal with a limit that does not exist.
 */
export const MAX_RANGE_DAYS = 400;

export function rangeError(from: CalendarDate, to: CalendarDate): string | null {
  if (!isCalendarDate(from) || !isCalendarDate(to)) {
    return 'Enter both dates as a real calendar day.';
  }
  if (compare(to, from) < 0) {
    return 'The end date must not precede the start date.';
  }
  if (compare(to, addDays(from, MAX_RANGE_DAYS)) > 0) {
    return `Choose a range of at most ${MAX_RANGE_DAYS} days.`;
  }
  return null;
}

function currentMonth(): BillInstanceQuery {
  const now = today();
  return { from: startOfMonth(now), to: endOfMonth(now) };
}

@Injectable({ providedIn: 'root' })
export class InstancesStore {
  private readonly api = inject(BillInstancesApi);
  private readonly bills = inject(BillsStore);
  private readonly session = inject(SessionService);

  private readonly items = signal<BillInstanceResponse[]>([]);
  private readonly currentQuery = signal<BillInstanceQuery>(currentMonth());
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly loaded = signal(false);

  readonly instances = this.items.asReadonly();
  readonly query = this.currentQuery.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly isEmpty = computed(() => this.loaded() && this.items().length === 0);

  constructor() {
    effect(() => {
      if (!this.session.isAuthenticated()) this.reset();
    });

    // A template change rewrites, generates, or cascades on the server by
    // rules this store cannot reproduce. Watching the counter rather than
    // having `BillsStore` call in keeps the dependency pointing one way.
    //
    // `loaded` is read untracked on purpose. Tracked, this effect would
    // also depend on it, so the first successful fetch — which sets it
    // true — would re-run the effect and immediately fetch the same range
    // again. The counter is the only thing this effect reacts to.
    effect(() => {
      this.bills.mutations();
      if (untracked(() => this.loaded())) void this.refresh();
    });
  }

  async setQuery(query: BillInstanceQuery): Promise<void> {
    const invalid = rangeError(query.from, query.to);
    if (invalid !== null) {
      // The previous rows stay. Blanking the list to explain a range the
      // person has not committed to yet loses what they were reading.
      this.errorState.set(invalid);
      return;
    }

    this.currentQuery.set(query);
    await this.fetch();
  }

  refresh(): Promise<void> {
    return this.fetch();
  }

  /**
   * Replaces one row from a response the API already returned. The payment
   * endpoints hand back the updated instance, so there is nothing to
   * refetch — and refetching would throw away the rest of the range to
   * learn one row.
   */
  patch(instance: BillInstanceResponse): void {
    this.items.update((current) =>
      current.map((item) => (item.id === instance.id ? instance : item)),
    );
  }

  reset(): void {
    this.items.set([]);
    this.currentQuery.set(currentMonth());
    this.loaded.set(false);
    this.errorState.set(null);
    this.loadingState.set(false);
  }

  private async fetch(): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);
    try {
      this.items.set(await firstValueFrom(this.api.list(this.currentQuery())));
      this.loaded.set(true);
    } catch (error: unknown) {
      this.errorState.set(errorMessage(error));
    } finally {
      this.loadingState.set(false);
    }
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx nx test web --include='**/instances.store.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Prove the 400-day boundary is tested on the correct side**

Temporarily change `rangeError` to measure an inclusive day count:

```ts
if (daysBetween(from, to) + 1 > MAX_RANGE_DAYS) {
```

Run: `npx nx test web --include='**/instances.store.spec.ts'`
Expected: FAIL on "accepts a difference of exactly 400 days".

Restore and re-run. Expected: PASS. The same off-by-one cost sub-project 2
a review round; this test is what stops it recurring.

- [ ] **Step 6: Write the failing screen test**

Create `apps/web/src/app/instances/upcoming.component.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { UpcomingComponent } from './upcoming.component';

let http: HttpTestingController;

const base = {
  id: 'inst-1',
  billId: 'bill-1',
  billName: 'Rent',
  categoryId: 'cat-1',
  dueDate: '2026-10-01',
  amount: 1200,
  amountPaid: 0,
  status: 'UNPAID' as const,
  isOverdue: false,
  isCustomized: false,
  paidAt: null,
  note: null,
};

function instancesRequest() {
  return http.expectOne((r) => r.url === '/api/bill-instances');
}

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [UpcomingComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  TestBed.inject(SessionService).signIn({
    accessToken: 'token-1',
    user: { id: 'user-1', email: 'a@b.c', name: 'Ada', notifyEmail: true, notifyInApp: true },
  });
});

afterEach(() => {
  http.verify();
});

describe('UpcomingComponent', () => {
  it('lists instances with their bill name, due date, and amount', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Rent');
    expect(text).toContain('Oct 1, 2026');
    expect(text).toContain('$1,200.00');
  });

  it('defaults to the current month', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();

    const req = instancesRequest();
    const from = req.request.params.get('from') ?? '';
    const to = req.request.params.get('to') ?? '';
    expect(from.endsWith('-01')).toBe(true);
    expect(from.slice(0, 7)).toBe(to.slice(0, 7));
    req.flush([]);
  });

  it('names the empty state rather than rendering a blank table', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([]);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Nothing due in this range');
  });

  it('shows the amount still owed on a partially paid instance', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([
      { ...base, status: 'PARTIALLY_PAID', amountPaid: 500 },
    ]);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('$700.00');
  });
});

describe('overdue comes from the server', () => {
  it('marks a row overdue when the server says so, whatever its due date', async () => {
    // Review Focus 5. `isOverdue` is derived against the server's
    // APP_TIMEZONE. A browser in UTC+14 or UTC-11 is on a different
    // calendar day, so a locally derived badge would disagree with the
    // API on exactly the rows a person cares most about.
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([{ ...base, dueDate: '2099-01-01', isOverdue: true }]);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Overdue');
  });

  it('does not mark a row overdue when the server says it is not, however old it is', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([{ ...base, dueDate: '2000-01-01', isOverdue: false }]);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).not.toContain('Overdue');
  });
});

describe('the range controls', () => {
  it('refuses an over-wide range with a message and sends nothing', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();

    fixture.componentInstance.rangeForm.setValue({ from: '2026-01-01', to: '2027-06-01' });
    await fixture.componentInstance.applyRange();
    await fixture.whenStable();

    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('400');
    expect(fixture.nativeElement.textContent).toContain('Rent');
  });

  it('applies a valid range', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([]);
    await fixture.whenStable();

    fixture.componentInstance.rangeForm.setValue({ from: '2026-11-01', to: '2026-11-30' });
    const applied = fixture.componentInstance.applyRange();
    const req = instancesRequest();
    expect(req.request.params.get('from')).toBe('2026-11-01');
    req.flush([]);
    await applied;
  });
});

describe('the day boundary', () => {
  it('refetches when the browser day has changed since the rows were rendered', async () => {
    // `isOverdue` goes stale at midnight. A tab left open overnight would
    // otherwise show yesterday's answer indefinitely.
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();

    const renderedOn = fixture.componentInstance.renderedOn();
    fixture.componentInstance.refreshIfDayChanged('2099-01-01');
    await fixture.whenStable();

    instancesRequest().flush([base]);
    expect(fixture.componentInstance.renderedOn()).toBe('2099-01-01');
    expect(renderedOn).not.toBe('2099-01-01');
  });

  it('does not refetch when the day is unchanged', async () => {
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();

    fixture.componentInstance.refreshIfDayChanged(fixture.componentInstance.renderedOn());
    await fixture.whenStable();

    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
  });
});
```

- [ ] **Step 7: Run the test to verify it fails**

Run: `npx nx test web --include='**/upcoming.component.spec.ts'`
Expected: FAIL — cannot resolve `./upcoming.component`.

- [ ] **Step 8: Write the row component**

Create `apps/web/src/app/instances/instance-row.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import type { BillInstanceResponse, BillStatus } from '@bill-tracker/shared-types';
import { CalendarDatePipe } from '../core/date/calendar-date.pipe';
import { formatMoney } from '../shared/money';

const STATUS_LABELS: Record<BillStatus, string> = {
  UNPAID: 'Unpaid',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
};

@Component({
  selector: 'app-instance-row',
  imports: [MatChipsModule, CalendarDatePipe],
  template: `
    <div class="row">
      <div class="identity">
        <span class="name">{{ instance().billName }}</span>
        <span class="due">{{ instance().dueDate | calendarDate }}</span>
      </div>

      <div class="amounts">
        <span class="owed">{{ owed() }}</span>
        @if (instance().amountPaid > 0) {
          <span class="paid">{{ paid() }} paid of {{ total() }}</span>
        }
      </div>

      <div class="badges">
        <mat-chip [class.paid-chip]="instance().status === 'PAID'">{{ statusLabel() }}</mat-chip>
        @if (instance().isOverdue) {
          <mat-chip class="overdue-chip">Overdue</mat-chip>
        }
        @if (instance().isCustomized) {
          <mat-chip class="custom-chip" title="Edited on its own; template changes leave it alone">
            Customised
          </mat-chip>
        }
      </div>

      <div class="actions">
        <ng-content />
      </div>
    </div>
  `,
  styles: `
    .row {
      display: grid;
      grid-template-columns: 1fr auto auto auto;
      align-items: center;
      gap: 1rem;
      padding: 0.75rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .identity,
    .amounts {
      display: flex;
      flex-direction: column;
    }
    .name {
      font: var(--mat-sys-title-small);
    }
    .due,
    .paid {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .badges {
      display: flex;
      gap: 0.25rem;
    }
    .overdue-chip {
      --mat-chip-elevated-container-color: var(--mat-sys-error-container);
    }
    @media (max-width: 48rem) {
      .row {
        grid-template-columns: 1fr;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class InstanceRowComponent {
  readonly instance = input.required<BillInstanceResponse>();

  /**
   * The remaining balance is shown, never submitted. "Pay in full" sends an
   * empty body and lets the server compute this figure under a row lock;
   * a client-computed one races every other writer.
   */
  readonly owed = computed(() => formatMoney(this.instance().amount - this.instance().amountPaid));
  readonly paid = computed(() => formatMoney(this.instance().amountPaid));
  readonly total = computed(() => formatMoney(this.instance().amount));
  readonly statusLabel = computed(() => STATUS_LABELS[this.instance().status]);
}
```

- [ ] **Step 9: Write the screen**

Create `apps/web/src/app/instances/upcoming.component.ts`:

```ts
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { BILL_STATUSES } from '@bill-tracker/shared-types';
import type { BillStatus } from '@bill-tracker/shared-types';
import { InstancesStore } from '../core/state/instances.store';
import { CalendarDate, today } from '../core/date/calendar-date';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { InstanceRowComponent } from './instance-row.component';

@Component({
  selector: 'app-upcoming',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDatepickerModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatSelectModule,
    EmptyStateComponent,
    InstanceRowComponent,
  ],
  template: `
    <header class="page-header">
      <h1>Upcoming</h1>
    </header>

    <form [formGroup]="rangeForm" class="range" (ngSubmit)="applyRange()">
      <mat-form-field>
        <mat-label>From</mat-label>
        <input matInput [matDatepicker]="fromPicker" formControlName="from" />
        <mat-datepicker-toggle matIconSuffix [for]="fromPicker" />
        <mat-datepicker #fromPicker />
      </mat-form-field>

      <mat-form-field>
        <mat-label>To</mat-label>
        <input matInput [matDatepicker]="toPicker" formControlName="to" />
        <mat-datepicker-toggle matIconSuffix [for]="toPicker" />
        <mat-datepicker #toPicker />
      </mat-form-field>

      <mat-form-field>
        <mat-label>Status</mat-label>
        <mat-select [value]="status()" (valueChange)="setStatus($event)">
          <mat-option [value]="null">Any</mat-option>
          @for (value of statuses; track value) {
            <mat-option [value]="value">{{ value }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field>
        <mat-label>Overdue</mat-label>
        <mat-select [value]="overdue()" (valueChange)="setOverdue($event)">
          <mat-option [value]="null">Any</mat-option>
          <mat-option [value]="true">Overdue only</mat-option>
          <mat-option [value]="false">Not overdue</mat-option>
        </mat-select>
      </mat-form-field>

      <button matButton="filled" type="submit">Apply</button>
    </form>

    @if (store.loading()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (store.error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    @if (store.isEmpty()) {
      <app-empty-state
        icon="event_available"
        title="Nothing due in this range"
        message="Widen the dates, or create a bill so occurrences can be generated."
      />
    } @else {
      @for (instance of store.instances(); track instance.id) {
        <app-instance-row [instance]="instance" />
      }
    }
  `,
  styles: `
    .range {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 0.75rem;
      margin-bottom: 1rem;
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpcomingComponent {
  protected readonly store = inject(InstancesStore);
  private readonly fb = inject(FormBuilder);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly statuses = BILL_STATUSES;

  readonly status = signal<BillStatus | null>(null);
  readonly overdue = signal<boolean | null>(null);

  /** The browser day the current rows were fetched on — see `refreshIfDayChanged`. */
  readonly renderedOn = signal<CalendarDate>(today());

  readonly rangeForm = this.fb.nonNullable.group({
    from: this.store.query().from,
    to: this.store.query().to,
  });

  constructor() {
    void this.load();

    const onFocus = (): void => this.refreshIfDayChanged();
    window.addEventListener('focus', onFocus);
    this.destroyRef.onDestroy(() => window.removeEventListener('focus', onFocus));
  }

  applyRange(): Promise<void> {
    return this.load();
  }

  setStatus(value: BillStatus | null): void {
    this.status.set(value);
  }

  setOverdue(value: boolean | null): void {
    this.overdue.set(value);
  }

  /**
   * `isOverdue` is computed against the server's `APP_TIMEZONE` at the
   * moment of the request, so it goes stale when the day turns over. A tab
   * left open overnight would otherwise show yesterday's answer until
   * someone reloaded it.
   *
   * The current day is a parameter so this is testable without stubbing
   * the clock.
   */
  refreshIfDayChanged(now: CalendarDate = today()): void {
    if (now === this.renderedOn()) return;
    this.renderedOn.set(now);
    void this.store.refresh();
  }

  private async load(): Promise<void> {
    const { from, to } = this.rangeForm.getRawValue();
    this.renderedOn.set(today());
    await this.store.setQuery({
      from,
      to,
      ...(this.status() === null ? {} : { status: this.status() as BillStatus }),
      ...(this.overdue() === null ? {} : { overdue: this.overdue() as boolean }),
    });
  }
}
```

- [ ] **Step 10: Register the route**

In `apps/web/src/app/app.routes.ts`, add to the shell route's `children`,
before the `bills` entries:

```ts
{
  path: 'upcoming',
  loadComponent: () => import('./instances/upcoming.component').then((m) => m.UpcomingComponent),
},
```

The default redirect from `''` now resolves.

- [ ] **Step 11: Run the tests to verify they pass**

Run: `npx nx test web`
Expected: PASS.

- [ ] **Step 12: Prove the overdue badge is not derived locally**

Temporarily change `InstanceRowComponent` to compute its own badge:
replace `@if (instance().isOverdue)` with
`@if (instance().status !== 'PAID' && instance().dueDate < todayValue)`,
adding `protected readonly todayValue = today();` and the import.

Run: `npx nx test web --include='**/upcoming.component.spec.ts'`
Expected: FAIL on both "overdue comes from the server" tests — the future
due date loses its badge and the ancient one gains it.

Restore and re-run. Expected: PASS.

- [ ] **Step 13: Run the suite under two extreme time zones**

Run: `TZ=Pacific/Kiritimati npx nx test web --skip-nx-cache`
Then: `TZ=Pacific/Pago_Pago npx nx test web --skip-nx-cache`

Expected: PASS in both. These are UTC+14 and UTC-11 — a 25-hour spread,
so any place the client derived a date locally shows up as a failure in
one of them.

- [ ] **Step 14: Commit**

```bash
git add apps/web/src/app/core/state/instances.store.ts \
        apps/web/src/app/core/state/instances.store.spec.ts \
        apps/web/src/app/instances \
        apps/web/src/app/app.routes.ts
git commit -m "feat(web): add the upcoming screen over a bounded date range"
```

---

## Task 12: Payments — record, reverse, and clear

Spec §9, §11, and bills spec §6. The append-only log is only useful if it
can be read, so the history is part of this task, not an extra.

**Return shapes differ and the difference matters:** `record` and
`reverse` return `PaymentResultResponse` (instance **and** payment);
`unpay` returns a bare `BillInstanceResponse`.

**Files:**
- Create: `apps/web/src/app/core/state/payments.service.ts` and `payments.service.spec.ts`
- Create: `apps/web/src/app/instances/payment-dialog.component.ts` and `payment-dialog.component.spec.ts`
- Create: `apps/web/src/app/instances/payment-history.component.ts` and `payment-history.component.spec.ts`
- Modify: `apps/web/src/app/instances/upcoming.component.ts` and `upcoming.component.spec.ts`

**Interfaces:**
- Consumes: `BillInstancesApi` (Task 5); `InstancesStore.patch` (Task 11); the shared kit (Task 7).
- Produces:
  - `PaymentsService` with `record(id, body?): Promise<PaymentResultResponse>`, `reverse(id, paymentId): Promise<PaymentResultResponse>`, `unpay(id): Promise<BillInstanceResponse>`, `history(id): Promise<PaymentLogResponse[]>`, `reload(id): Promise<BillInstanceResponse>`
  - `PaymentDialogComponent`, `PaymentDialogData`, `PaymentDialogResult`
  - `PaymentHistoryComponent`

- [ ] **Step 1: Write the failing service test**

Create `apps/web/src/app/core/state/payments.service.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../auth/session.service';
import { InstancesStore } from './instances.store';
import { PaymentsService } from './payments.service';

let http: HttpTestingController;
let payments: PaymentsService;
let instances: InstancesStore;

const instance = {
  id: 'inst-1',
  billId: 'bill-1',
  billName: 'Rent',
  categoryId: null,
  dueDate: '2026-10-01',
  amount: 1200,
  amountPaid: 0,
  status: 'UNPAID' as const,
  isOverdue: false,
  isCustomized: false,
  paidAt: null,
  note: null,
};

const payment = {
  id: 'pay-1',
  billInstanceId: 'inst-1',
  amountPaid: 1200,
  paidAt: '2026-10-01T12:00:00.000Z',
  note: null,
  reversesPaymentId: null,
};

beforeEach(async () => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  http = TestBed.inject(HttpTestingController);
  TestBed.inject(SessionService).signIn({
    accessToken: 'token-1',
    user: { id: 'user-1', email: 'a@b.c', name: 'Ada', notifyEmail: true, notifyInApp: true },
  });
  instances = TestBed.inject(InstancesStore);
  payments = TestBed.inject(PaymentsService);

  const loaded = instances.setQuery({ from: '2026-10-01', to: '2026-10-31' });
  http.expectOne((r) => r.url === '/api/bill-instances').flush([instance]);
  await loaded;
});

afterEach(() => {
  http.verify();
});

describe('record', () => {
  it('sends an empty body for a full payment and patches the row from the response', async () => {
    const done = payments.record('inst-1');
    const req = http.expectOne('/api/bill-instances/inst-1/payments');
    expect(req.request.body).toEqual({});
    req.flush({ instance: { ...instance, status: 'PAID', amountPaid: 1200 }, payment });
    await done;

    expect(instances.instances()[0].status).toBe('PAID');
    // No follow-up read — the endpoint already returned the row.
    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
  });

  it('sends a partial amount when one is given', async () => {
    const done = payments.record('inst-1', { amount: 500 });
    const req = http.expectOne('/api/bill-instances/inst-1/payments');
    expect(req.request.body).toEqual({ amount: 500 });
    req.flush({
      instance: { ...instance, status: 'PARTIALLY_PAID', amountPaid: 500 },
      payment: { ...payment, amountPaid: 500 },
    });
    await done;

    expect(instances.instances()[0].status).toBe('PARTIALLY_PAID');
    expect(instances.instances()[0].amountPaid).toBe(500);
  });

  it('leaves the row untouched when the request fails', async () => {
    const done = payments.record('inst-1', { amount: 99999 });
    http
      .expectOne('/api/bill-instances/inst-1/payments')
      .flush({ message: 'too much' }, { status: 400, statusText: 'Bad Request' });

    await expect(done).rejects.toBeDefined();
    expect(instances.instances()[0].status).toBe('UNPAID');
  });
});

describe('reverse', () => {
  it('posts to the nested path and patches the row', async () => {
    const done = payments.reverse('inst-1', 'pay-1');
    const req = http.expectOne('/api/bill-instances/inst-1/payments/pay-1/reverse');
    expect(req.request.method).toBe('POST');
    req.flush({
      instance,
      payment: { ...payment, id: 'pay-2', amountPaid: -1200, reversesPaymentId: 'pay-1' },
    });
    await done;

    expect(instances.instances()[0].status).toBe('UNPAID');
  });

  it('rejects a second reversal with the server message intact', async () => {
    // Review Focus 3. The API's partial unique index makes "reversed at
    // most once" a database guarantee, so this is a 409 and not a
    // silently ignored no-op.
    const done = payments.reverse('inst-1', 'pay-1');
    http.expectOne('/api/bill-instances/inst-1/payments/pay-1/reverse').flush(
      { message: 'This payment has already been reversed' },
      { status: 409, statusText: 'Conflict' },
    );

    await expect(done).rejects.toMatchObject({ status: 409 });
  });
});

describe('unpay', () => {
  it('patches the row from a bare instance, not a result pair', async () => {
    const done = payments.unpay('inst-1');
    const req = http.expectOne('/api/bill-instances/inst-1/unpay');
    expect(req.request.method).toBe('POST');
    req.flush(instance);
    await done;

    expect(instances.instances()[0].status).toBe('UNPAID');
    expect(instances.instances()[0].amountPaid).toBe(0);
  });
});

describe('history and reload', () => {
  it('reads the log oldest first', async () => {
    const done = payments.history('inst-1');
    const req = http.expectOne('/api/bill-instances/inst-1/payments');
    expect(req.request.method).toBe('GET');
    req.flush([payment]);

    expect(await done).toEqual([payment]);
  });

  it('reloads one instance and patches it in, for recovering from a conflict', async () => {
    const done = payments.reload('inst-1');
    http
      .expectOne('/api/bill-instances/inst-1')
      .flush({ ...instance, status: 'PAID', amountPaid: 1200 });
    await done;

    expect(instances.instances()[0].status).toBe('PAID');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx nx test web --include='**/payments.service.spec.ts'`
Expected: FAIL — cannot resolve `./payments.service`.

- [ ] **Step 3: Write the service**

Create `apps/web/src/app/core/state/payments.service.ts`:

```ts
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type {
  BillInstanceResponse,
  PaymentLogResponse,
  PaymentResultResponse,
  RecordPaymentRequest,
} from '@bill-tracker/shared-types';
import { BillInstancesApi } from '../api/bill-instances.api';
import { InstancesStore } from './instances.store';

/**
 * Payment mutations patch a single row rather than refetching a range,
 * because every one of these endpoints returns the updated instance
 * (bills spec §7.3). Refetching would throw away the rest of the range to
 * learn one row.
 *
 * Nothing here is swallowed. A 409 from a double reversal and a 400 from
 * an over-payment both reach the caller, which is what lets the screen
 * show the server's own message instead of a shrug.
 */
@Injectable({ providedIn: 'root' })
export class PaymentsService {
  private readonly api = inject(BillInstancesApi);
  private readonly instances = inject(InstancesStore);

  /** An omitted `amount` means the remaining balance, computed server-side under a row lock. */
  async record(id: string, body: RecordPaymentRequest = {}): Promise<PaymentResultResponse> {
    const result = await firstValueFrom(this.api.recordPayment(id, body));
    this.instances.patch(result.instance);
    return result;
  }

  async reverse(id: string, paymentId: string): Promise<PaymentResultResponse> {
    const result = await firstValueFrom(this.api.reversePayment(id, paymentId));
    this.instances.patch(result.instance);
    return result;
  }

  /** Returns the instance alone — `unpay` has no payment row to hand back. */
  async unpay(id: string): Promise<BillInstanceResponse> {
    const instance = await firstValueFrom(this.api.unpay(id));
    this.instances.patch(instance);
    return instance;
  }

  history(id: string): Promise<PaymentLogResponse[]> {
    return firstValueFrom(this.api.payments(id));
  }

  /**
   * Re-reads one instance. Used after a conflict, where the local row is
   * known to disagree with the server and showing the stale version
   * alongside the error would be worse than either alone.
   */
  async reload(id: string): Promise<BillInstanceResponse> {
    const instance = await firstValueFrom(this.api.get(id));
    this.instances.patch(instance);
    return instance;
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx nx test web --include='**/payments.service.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Write the failing payment-dialog test**

This is where the CDK harnesses earn their place: the test has to *operate*
a Material checkbox and a Material input, and both have internal structure
a DOM query would couple to.

Create `apps/web/src/app/instances/payment-dialog.component.spec.ts`:

```ts
import { HarnessLoader } from '@angular/cdk/testing';
import { TestbedHarnessEnvironment } from '@angular/cdk/testing/testbed';
import { provideZonelessChangeDetection } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatCheckboxHarness } from '@angular/material/checkbox/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatInputHarness } from '@angular/material/input/testing';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PaymentDialogComponent } from './payment-dialog.component';

const instance = {
  id: 'inst-1',
  billId: 'bill-1',
  billName: 'Rent',
  categoryId: null,
  dueDate: '2026-10-01',
  amount: 1200,
  amountPaid: 500,
  status: 'PARTIALLY_PAID' as const,
  isOverdue: false,
  isCustomized: false,
  paidAt: null,
  note: null,
};

const AMOUNT_FIELD = MatInputHarness.with({ selector: 'input[type=number]' });

let fixture: ComponentFixture<PaymentDialogComponent>;
let loader: HarnessLoader;
let close: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  close = vi.fn();
  TestBed.configureTestingModule({
    imports: [PaymentDialogComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      { provide: MAT_DIALOG_DATA, useValue: { instance } },
      { provide: MatDialogRef, useValue: { close } },
    ],
  });
  fixture = TestBed.createComponent(PaymentDialogComponent);
  loader = TestbedHarnessEnvironment.loader(fixture);
  await fixture.whenStable();
});

describe('PaymentDialogComponent', () => {
  it('shows what is still owed beside the full amount', () => {
    expect(fixture.nativeElement.textContent).toContain('$700.00');
    expect(fixture.nativeElement.textContent).toContain('$1,200.00');
  });

  it('defaults to paying the full remaining balance', async () => {
    expect(await (await loader.getHarness(MatCheckboxHarness)).isChecked()).toBe(true);
  });

  it('omits the amount entirely when paying in full', async () => {
    // The assertion that matters. Sending the displayed $700.00 would be
    // correct only until something else pays part of this instance between
    // the dialog opening and the request landing — which is exactly what
    // the server row lock exists to settle.
    fixture.componentInstance.save();

    expect(close).toHaveBeenCalledWith({ note: null });
    expect(close.mock.calls[0][0]).not.toHaveProperty('amount');
  });

  it('hides the amount field until paying in full is unchecked', async () => {
    expect(await loader.getHarnessOrNull(AMOUNT_FIELD)).toBeNull();

    await (await loader.getHarness(MatCheckboxHarness)).uncheck();
    await fixture.whenStable();

    expect(await loader.getHarnessOrNull(AMOUNT_FIELD)).not.toBeNull();
  });

  it('sends a typed partial amount as a number', async () => {
    await (await loader.getHarness(MatCheckboxHarness)).uncheck();
    await fixture.whenStable();

    await (await loader.getHarness(AMOUNT_FIELD)).setValue('250');
    await fixture.whenStable();

    fixture.componentInstance.save();

    expect(close).toHaveBeenCalledWith({ amount: 250, note: null });
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `npx nx test web --include='**/payment-dialog.component.spec.ts'`
Expected: FAIL — cannot resolve `./payment-dialog.component`.

- [ ] **Step 7: Write the payment dialog**

Create `apps/web/src/app/instances/payment-dialog.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { BillInstanceResponse } from '@bill-tracker/shared-types';
import { FieldErrorsComponent } from '../shared/field-errors.component';
import { MAX_AMOUNT, MIN_AMOUNT, formatMoney } from '../shared/money';

export interface PaymentDialogData {
  instance: BillInstanceResponse;
}

export interface PaymentDialogResult {
  /** Undefined means "the remaining balance" — the server computes it. */
  amount?: number;
  note?: string | null;
}

@Component({
  selector: 'app-payment-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    FieldErrorsComponent,
  ],
  template: `
    <h2 mat-dialog-title>Record a payment</h2>
    <mat-dialog-content>
      <p>
        {{ data.instance.billName }} — {{ owed }} remaining of
        {{ total }}.
      </p>

      <form [formGroup]="form" class="dialog-form">
        <mat-checkbox formControlName="payInFull" cdkFocusInitial>
          Pay the full remaining balance
        </mat-checkbox>

        @if (!form.controls.payInFull.value) {
          <mat-form-field>
            <mat-label>Amount</mat-label>
            <input
              matInput
              type="number"
              step="0.01"
              [min]="minAmount"
              [max]="maxAmount"
              formControlName="amount"
            />
            <span matTextPrefix>$&nbsp;</span>
            <app-field-errors [control]="form.controls.amount" label="Amount" />
          </mat-form-field>
        }

        <mat-form-field>
          <mat-label>Note (optional)</mat-label>
          <input matInput formControlName="note" />
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Cancel</button>
      <button matButton="filled" [disabled]="form.invalid" (click)="save()">Record</button>
    </mat-dialog-actions>
  `,
  styles: `
    .dialog-form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      min-width: 20rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentDialogComponent {
  private readonly fb = inject(FormBuilder);
  protected readonly data = inject<PaymentDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<PaymentDialogComponent, PaymentDialogResult | undefined>>(MatDialogRef);

  protected readonly minAmount = MIN_AMOUNT;
  protected readonly maxAmount = MAX_AMOUNT;
  protected readonly owed = formatMoney(this.data.instance.amount - this.data.instance.amountPaid);
  protected readonly total = formatMoney(this.data.instance.amount);

  readonly form = this.fb.nonNullable.group({
    payInFull: [true],
    amount: [
      this.data.instance.amount - this.data.instance.amountPaid,
      [Validators.min(MIN_AMOUNT), Validators.max(MAX_AMOUNT)],
    ],
    note: this.fb.control<string | null>(null),
  });

  /**
   * "Pay in full" omits `amount` entirely rather than sending the figure
   * displayed above. The displayed number is for reading; the server's,
   * computed under a row lock, is the one that is correct when something
   * else has paid part of this instance since the dialog opened.
   */
  save(): void {
    const { payInFull, amount, note } = this.form.getRawValue();
    this.dialogRef.close({
      ...(payInFull ? {} : { amount }),
      note: note === '' ? null : note,
    });
  }
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx nx test web --include='**/payment-dialog.component.spec.ts'`
Expected: PASS.

- [ ] **Step 9: Write the failing history test**

Create `apps/web/src/app/instances/payment-history.component.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { PaymentHistoryComponent } from './payment-history.component';

let http: HttpTestingController;

const paid = {
  id: 'pay-1',
  billInstanceId: 'inst-1',
  amountPaid: 1200,
  paidAt: '2026-10-01T12:00:00.000Z',
  note: 'Bank transfer',
  reversesPaymentId: null,
};

const reversal = {
  id: 'pay-2',
  billInstanceId: 'inst-1',
  amountPaid: -1200,
  paidAt: '2026-10-02T12:00:00.000Z',
  note: null,
  reversesPaymentId: 'pay-1',
};

function render() {
  const fixture = TestBed.createComponent(PaymentHistoryComponent);
  fixture.componentRef.setInput('instanceId', 'inst-1');
  return fixture;
}

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [PaymentHistoryComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  TestBed.inject(SessionService).signIn({
    accessToken: 'token-1',
    user: { id: 'user-1', email: 'a@b.c', name: 'Ada', notifyEmail: true, notifyInApp: true },
  });
});

afterEach(() => {
  http.verify();
});

describe('PaymentHistoryComponent', () => {
  it('lists a payment with its amount and note', async () => {
    const fixture = render();
    await fixture.whenStable();
    http.expectOne('/api/bill-instances/inst-1/payments').flush([paid]);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('$1,200.00');
    expect(fixture.nativeElement.textContent).toContain('Bank transfer');
  });

  it('shows a reversal as its own row rather than hiding the payment it undid', async () => {
    // The log is append-only. A history that renders a net of zero has
    // thrown away the fact that something happened and was undone.
    const fixture = render();
    await fixture.whenStable();
    http.expectOne('/api/bill-instances/inst-1/payments').flush([paid, reversal]);
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Reversal');
    expect(text).toContain('-$1,200.00');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="payment-entry"]')).toHaveLength(2);
  });

  it('offers no reverse action on a row that is itself a reversal', async () => {
    const fixture = render();
    await fixture.whenStable();
    http.expectOne('/api/bill-instances/inst-1/payments').flush([paid, reversal]);
    await fixture.whenStable();

    const buttons = fixture.nativeElement.querySelectorAll('[data-testid="reverse"]');
    expect(buttons).toHaveLength(1);
  });

  it('says so when there are no payments yet', async () => {
    const fixture = render();
    await fixture.whenStable();
    http.expectOne('/api/bill-instances/inst-1/payments').flush([]);
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('No payments recorded');
  });

  it('shows the server message when a reversal is refused as already reversed', async () => {
    const fixture = render();
    await fixture.whenStable();
    http.expectOne('/api/bill-instances/inst-1/payments').flush([paid]);
    await fixture.whenStable();

    const done = fixture.componentInstance.reverse(paid);
    http.expectOne('/api/bill-instances/inst-1/payments/pay-1/reverse').flush(
      { message: 'This payment has already been reversed' },
      { status: 409, statusText: 'Conflict' },
    );
    // The local view disagrees with the server, so both the row and the
    // log are re-read rather than left stale beside the error.
    http.expectOne('/api/bill-instances/inst-1').flush({
      id: 'inst-1',
      billId: 'bill-1',
      billName: 'Rent',
      categoryId: null,
      dueDate: '2026-10-01',
      amount: 1200,
      amountPaid: 0,
      status: 'UNPAID',
      isOverdue: false,
      isCustomized: false,
      paidAt: null,
      note: null,
    });
    http.expectOne('/api/bill-instances/inst-1/payments').flush([paid, reversal]);
    await done;
    await fixture.whenStable();

    expect(fixture.componentInstance.error()).toContain('already been reversed');
    expect(fixture.nativeElement.textContent).toContain('already been reversed');
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `npx nx test web --include='**/payment-history.component.spec.ts'`
Expected: FAIL — cannot resolve `./payment-history.component`.

- [ ] **Step 11: Write the history component**

Create `apps/web/src/app/instances/payment-history.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { PaymentLogResponse } from '@bill-tracker/shared-types';
import { errorMessage } from '../core/api/api-error';
import { PaymentsService } from '../core/state/payments.service';
import { formatMoney } from '../shared/money';

@Component({
  selector: 'app-payment-history',
  imports: [MatButtonModule, MatIconModule, MatListModule, MatProgressBarModule],
  template: `
    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    @if (entries().length === 0 && !loading()) {
      <p class="muted">No payments recorded yet.</p>
    } @else {
      <mat-list>
        @for (entry of entries(); track entry.id) {
          <mat-list-item data-testid="payment-entry">
            <span matListItemTitle>
              {{ money(entry.amountPaid) }}
              @if (entry.reversesPaymentId) {
                <span class="tag">Reversal</span>
              }
            </span>
            <span matListItemLine>{{ timestamp(entry.paidAt) }}{{ entry.note ? ' — ' + entry.note : '' }}</span>
            <span matListItemMeta>
              @if (!entry.reversesPaymentId) {
                <button
                  matIconButton
                  data-testid="reverse"
                  aria-label="Reverse this payment"
                  (click)="reverse(entry)"
                >
                  <mat-icon>undo</mat-icon>
                </button>
              }
            </span>
          </mat-list-item>
        }
      </mat-list>
    }
  `,
  styles: `
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .error {
      color: var(--mat-sys-error);
    }
    .tag {
      margin-left: 0.5rem;
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PaymentHistoryComponent {
  private readonly payments = inject(PaymentsService);

  readonly instanceId = input.required<string>();

  readonly entries = signal<PaymentLogResponse[]>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  constructor() {
    effect(() => {
      const id = this.instanceId();
      void this.load(id);
    });
  }

  /**
   * The log is append-only, so a reversal is rendered as its own negative
   * row beside the payment it undid. Netting the two to zero and showing
   * nothing would throw away the fact that something happened and was
   * corrected — which is the entire reason the log works this way.
   */
  protected money(amount: number): string {
    return amount < 0 ? `-${formatMoney(Math.abs(amount))}` : formatMoney(amount);
  }

  /** An ISO 8601 instant, not a calendar day — `Date` is correct here. */
  protected timestamp(value: string): string {
    return new Date(value).toLocaleString();
  }

  async reverse(entry: PaymentLogResponse): Promise<void> {
    this.error.set(null);
    try {
      await this.payments.reverse(this.instanceId(), entry.id);
      await this.load(this.instanceId());
    } catch (error: unknown) {
      this.error.set(errorMessage(error));
      // A conflict means the local view and the server disagree. Showing
      // the error beside a stale list is worse than either alone, so both
      // the instance and the log are re-read.
      await this.payments.reload(this.instanceId());
      await this.load(this.instanceId());
    }
  }

  async load(id: string): Promise<void> {
    this.loading.set(true);
    try {
      this.entries.set(await this.payments.history(id));
    } catch (error: unknown) {
      this.error.set(errorMessage(error));
    } finally {
      this.loading.set(false);
    }
  }
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `npx nx test web --include='**/payment-history.component.spec.ts'`
Expected: PASS.

- [ ] **Step 13: Wire the actions into the upcoming screen**

In `apps/web/src/app/instances/upcoming.component.ts`, add the imports:

```ts
import { MatExpansionModule } from '@angular/material/expansion';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import type { BillInstanceResponse } from '@bill-tracker/shared-types';
import { errorMessage } from '../core/api/api-error';
import { PaymentsService } from '../core/state/payments.service';
import { ConfirmDialogComponent, ConfirmDialogResult } from '../shared/confirm-dialog.component';
import { NotificationService } from '../shared/notification.service';
import { PaymentDialogComponent, PaymentDialogResult } from './payment-dialog.component';
import { PaymentHistoryComponent } from './payment-history.component';
```

Add `MatExpansionModule`, `MatDialogModule`, and `PaymentHistoryComponent`
to the component's `imports` array.

Replace the `@for` block inside the `@else` branch with:

```html
<mat-accordion multi>
  @for (instance of store.instances(); track instance.id) {
    <mat-expansion-panel>
      <mat-expansion-panel-header>
        <app-instance-row [instance]="instance" />
      </mat-expansion-panel-header>

      <!--
        The body is deferred behind matExpansionPanelContent on purpose.
        A panel renders its content eagerly by default, which would mount
        one app-payment-history per instance and fire a GET /payments for
        every row the moment the screen loads — thirty requests to show
        thirty collapsed rows. Deferred, the log is read when a person
        actually opens a row, which is what spec §11 describes.
      -->
      <ng-template matExpansionPanelContent>
        <div class="instance-actions">
          @if (instance.status !== 'PAID') {
            <button matButton="filled" (click)="openPayment(instance)">Record payment</button>
          }
          @if (instance.amountPaid !== 0) {
            <button matButton (click)="confirmUnpay(instance)">Clear all payments</button>
          }
        </div>

        <app-payment-history [instanceId]="instance.id" />
      </ng-template>
    </mat-expansion-panel>
  }
</mat-accordion>
```

Add to the component class:

```ts
private readonly dialog = inject(MatDialog);
private readonly payments = inject(PaymentsService);
private readonly notifications = inject(NotificationService);

readonly actionError = signal<string | null>(null);

async openPayment(instance: BillInstanceResponse): Promise<void> {
  const result = await firstValueFrom(
    this.dialog
      .open<PaymentDialogComponent, unknown, PaymentDialogResult | undefined>(
        PaymentDialogComponent,
        { data: { instance } },
      )
      .afterClosed(),
  );
  if (!result) return;

  try {
    const { instance: updated } = await this.payments.record(instance.id, result);
    this.actionError.set(null);
    this.notifications.success(
      updated.status === 'PAID' ? `${updated.billName} is paid` : `Recorded a payment for ${updated.billName}`,
    );
  } catch (error: unknown) {
    this.actionError.set(errorMessage(error));
  }
}

/**
 * `unpay` writes reversals for every live payment rather than deleting
 * rows, so the history survives. The dialog says so, because "clear"
 * otherwise sounds like it erases the record.
 */
async confirmUnpay(instance: BillInstanceResponse): Promise<void> {
  const choice = await firstValueFrom(
    this.dialog
      .open<ConfirmDialogComponent, unknown, ConfirmDialogResult>(ConfirmDialogComponent, {
        data: {
          title: `Clear payments for ${instance.billName}?`,
          message:
            'This records a reversal for each payment. The original entries stay in the history.',
          confirmLabel: 'Clear payments',
        },
      })
      .afterClosed(),
  );
  if (choice !== 'confirm') return;

  try {
    await this.payments.unpay(instance.id);
    this.actionError.set(null);
  } catch (error: unknown) {
    this.actionError.set(errorMessage(error));
  }
}
```

Add below the existing error paragraph in the template:

```html
@if (actionError(); as message) {
  <p class="error" role="alert">{{ message }}</p>
}
```

Add to the styles block:

```css
.instance-actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}
```

- [ ] **Step 14: Extend the upcoming test**

Append to `apps/web/src/app/instances/upcoming.component.spec.ts`:

```ts
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { vi } from 'vitest';

function dialogReturning(value: unknown) {
  return vi
    .spyOn(TestBed.inject(MatDialog), 'open')
    .mockReturnValue({ afterClosed: () => of(value) } as never);
}

const payment = {
  id: 'pay-1',
  billInstanceId: 'inst-1',
  amountPaid: 1200,
  paidAt: '2026-10-01T12:00:00.000Z',
  note: null,
  reversesPaymentId: null,
};

describe('payment actions', () => {
  it('records a payment and patches the row from the response', async () => {
    dialogReturning({ note: null });
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();

    const done = fixture.componentInstance.openPayment(base);
    const req = http.expectOne('/api/bill-instances/inst-1/payments');
    expect(req.request.body).toEqual({ note: null });
    req.flush({ instance: { ...base, status: 'PAID', amountPaid: 1200 }, payment });
    await done;
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('Paid');
  });

  it('shows a failed payment without changing the row', async () => {
    dialogReturning({ note: null });
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();

    const done = fixture.componentInstance.openPayment(base);
    http
      .expectOne('/api/bill-instances/inst-1/payments')
      .flush({ message: 'Amount exceeds the balance' }, { status: 400, statusText: 'Bad Request' });
    await done;
    await fixture.whenStable();

    expect(fixture.componentInstance.actionError()).toContain('Amount exceeds the balance');
    expect(fixture.nativeElement.textContent).toContain('Unpaid');
  });

  it('sends nothing when the dialog is dismissed', async () => {
    dialogReturning(undefined);
    const fixture = TestBed.createComponent(UpcomingComponent);
    await fixture.whenStable();
    instancesRequest().flush([base]);
    await fixture.whenStable();

    await fixture.componentInstance.openPayment(base);

    expect(http.match('/api/bill-instances/inst-1/payments')).toHaveLength(0);
  });
});
```

Move the three imports at the top of that block up into the file's existing
import block rather than leaving them mid-file.

The buttons these actions sit behind are inside the deferred panel body, so
they do not exist until a row is expanded — which is why these tests drive
`openPayment` directly rather than clicking. Expansion itself is covered by
the Playwright journeys in Task 15.

- [ ] **Step 15: Run the whole suite**

Run: `npx nx run-many -t lint typecheck test --skip-nx-cache`
Expected: all green.

- [ ] **Step 16: Prove the empty-body contract is tested**

Temporarily change `PaymentDialogComponent.save()` to always send the
amount:

```ts
this.dialogRef.close({ amount, note: note === '' ? null : note });
```

and change `PaymentsService.record` to compute the balance itself. Run:

`npx nx test web --include='**/payments.service.spec.ts'`

Expected: FAIL on "sends an empty body for a full payment and patches the
row from the response".

Restore both and re-run. Expected: PASS. A client-computed balance is
correct until something else pays part of the instance between the dialog
opening and the request landing, which is exactly the case the row lock
exists for.

- [ ] **Step 17: Commit**

```bash
git add apps/web/src/app/core/state/payments.service.ts \
        apps/web/src/app/core/state/payments.service.spec.ts \
        apps/web/src/app/instances
git commit -m "feat(web): record, reverse, and clear payments against an append-only log"
```

---

## Task 13: Settings

Spec §6.4, §11. The smallest screen, and the one to cut if the plan runs
long. It carries one behaviour nothing else does: a password change
revokes every refresh token, so the client signs out deliberately rather
than letting the session die fifteen minutes later with no explanation.

**Files:**
- Create: `apps/web/src/app/settings/settings.component.ts` and `settings.component.spec.ts`
- Modify: `apps/web/src/app/app.routes.ts`

**Interfaces:**
- Consumes: `UsersApi` (Task 5); `SessionService` (Task 6); `maxBytesValidator`, `applyServerErrors`, `FieldErrorsComponent`, `NotificationService` (Tasks 7, 8).
- Produces: `SettingsComponent`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/settings/settings.component.spec.ts`:

```ts
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { SettingsComponent } from './settings.component';

let http: HttpTestingController;
let session: SessionService;
let router: Router;

const profile = {
  id: 'user-1',
  email: 'a@b.c',
  name: 'Ada',
  notifyEmail: true,
  notifyInApp: false,
};

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [SettingsComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  session = TestBed.inject(SessionService);
  router = TestBed.inject(Router);
  session.signIn({ accessToken: 'token-1', user: profile });
});

afterEach(() => {
  http.verify();
  vi.restoreAllMocks();
});

describe('the profile form', () => {
  it('starts from the signed-in user', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    expect(fixture.componentInstance.profileForm.getRawValue()).toEqual({
      name: 'Ada',
      notifyEmail: true,
      notifyInApp: false,
    });
  });

  it('saves and refreshes the session user', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    fixture.componentInstance.profileForm.patchValue({ name: 'Ada Lovelace' });
    fixture.componentInstance.saveProfile();

    const req = http.expectOne('/api/users/me');
    expect(req.request.method).toBe('PATCH');
    req.flush({ ...profile, name: 'Ada Lovelace' });
    await fixture.whenStable();

    expect(session.user()?.name).toBe('Ada Lovelace');
  });

  it('attaches a server field error to its control', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    fixture.componentInstance.profileForm.patchValue({ name: 'A' });
    fixture.componentInstance.saveProfile();

    http.expectOne('/api/users/me').flush(
      { message: ['name is too short'], errors: { name: ['name is too short'] } },
      { status: 400, statusText: 'Bad Request' },
    );
    await fixture.whenStable();

    expect(fixture.componentInstance.profileForm.controls.name.errors).toMatchObject({
      server: 'name is too short',
    });
  });
});

describe('the password form', () => {
  it('rejects a new password over 72 bytes before sending', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    fixture.componentInstance.passwordForm.setValue({
      currentPassword: 'hunter22',
      newPassword: '😀'.repeat(25),
    });
    fixture.componentInstance.changePassword();

    expect(http.match('/api/users/me/password')).toHaveLength(0);
  });

  it('signs out and sends the person to the login screen on success', async () => {
    // Changing a password revokes every refresh token. Leaving the
    // session alive means it dies fifteen minutes later with no
    // explanation; signing out now is the honest version of what already
    // happened.
    const navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    fixture.componentInstance.passwordForm.setValue({
      currentPassword: 'hunter22',
      newPassword: 'hunter33x',
    });
    const done = fixture.componentInstance.changePassword();

    http.expectOne('/api/users/me/password').flush(null);
    http.expectOne('/api/auth/logout').flush(null);
    await done;

    expect(session.isAuthenticated()).toBe(false);
    expect(navigate).toHaveBeenCalledWith('/login');
  });

  it('keeps the session when the current password is wrong', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.whenStable();

    fixture.componentInstance.passwordForm.setValue({
      currentPassword: 'wrong-one',
      newPassword: 'hunter33x',
    });
    const done = fixture.componentInstance.changePassword();

    http
      .expectOne('/api/users/me/password')
      .flush({ message: 'Current password is incorrect' }, { status: 401, statusText: 'Unauthorized' });
    await done;
    await fixture.whenStable();

    expect(session.isAuthenticated()).toBe(true);
    expect(fixture.nativeElement.textContent).toContain('Current password is incorrect');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx nx test web --include='**/settings.component.spec.ts'`
Expected: FAIL — cannot resolve `./settings.component`.

- [ ] **Step 3: Write the screen**

Create `apps/web/src/app/settings/settings.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { UsersApi } from '../core/api/users.api';
import { SessionService } from '../core/auth/session.service';
import { FieldErrorsComponent } from '../shared/field-errors.component';
import { NotificationService } from '../shared/notification.service';
import { maxBytesValidator } from '../shared/password-validators';
import { applyServerErrors } from '../shared/server-errors';

@Component({
  selector: 'app-settings',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    FieldErrorsComponent,
  ],
  template: `
    <h1>Settings</h1>

    <mat-card>
      <mat-card-header><mat-card-title>Profile</mat-card-title></mat-card-header>
      <mat-card-content>
        @for (message of profileErrors(); track message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        <form [formGroup]="profileForm" (ngSubmit)="saveProfile()">
          <mat-form-field>
            <mat-label>Name</mat-label>
            <input matInput formControlName="name" />
            <app-field-errors [control]="profileForm.controls.name" label="Name" />
          </mat-form-field>

          <mat-checkbox formControlName="notifyEmail">Email me about due bills</mat-checkbox>
          <mat-checkbox formControlName="notifyInApp">Notify me in the app</mat-checkbox>

          <button matButton="filled" type="submit">Save profile</button>
        </form>
      </mat-card-content>
    </mat-card>

    <mat-card>
      <mat-card-header><mat-card-title>Password</mat-card-title></mat-card-header>
      <mat-card-content>
        <p class="muted">
          Changing your password signs you out everywhere, including here.
        </p>
        @for (message of passwordErrors(); track message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        <form [formGroup]="passwordForm" (ngSubmit)="changePassword()">
          <mat-form-field>
            <mat-label>Current password</mat-label>
            <input
              matInput
              type="password"
              formControlName="currentPassword"
              autocomplete="current-password"
            />
            <app-field-errors
              [control]="passwordForm.controls.currentPassword"
              label="Current password"
            />
          </mat-form-field>

          <mat-form-field>
            <mat-label>New password</mat-label>
            <input
              matInput
              type="password"
              formControlName="newPassword"
              autocomplete="new-password"
            />
            <app-field-errors [control]="passwordForm.controls.newPassword" label="New password" />
          </mat-form-field>

          <button matButton="filled" type="submit">Change password</button>
        </form>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    mat-card {
      max-width: 36rem;
      margin-bottom: 1.5rem;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      align-items: flex-start;
    }
    mat-form-field {
      width: 100%;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .form-error {
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly usersApi = inject(UsersApi);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  readonly profileErrors = signal<string[]>([]);
  readonly passwordErrors = signal<string[]>([]);

  readonly profileForm = this.fb.nonNullable.group({
    name: [this.session.user()?.name ?? '', [Validators.required, Validators.maxLength(100)]],
    notifyEmail: [this.session.user()?.notifyEmail ?? true],
    notifyInApp: [this.session.user()?.notifyInApp ?? true],
  });

  readonly passwordForm = this.fb.nonNullable.group({
    currentPassword: ['', [Validators.required]],
    newPassword: ['', [Validators.required, Validators.minLength(8), maxBytesValidator(72)]],
  });

  saveProfile(): void {
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }
    this.profileErrors.set([]);

    this.usersApi.updateProfile(this.profileForm.getRawValue()).subscribe({
      next: (profile) => {
        this.session.setUser(profile);
        this.notifications.success('Profile saved');
      },
      error: (error: unknown) => {
        this.profileErrors.set(applyServerErrors(this.profileForm, error));
      },
    });
  }

  /**
   * The API revokes every refresh token on success, so this session is
   * already dead — it just has up to fifteen minutes of access token left
   * to discover that. Signing out here makes the consequence visible at
   * the moment it is caused, instead of as an unexplained logout later.
   */
  async changePassword(): Promise<void> {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    this.passwordErrors.set([]);

    try {
      await firstValueFrom(this.usersApi.changePassword(this.passwordForm.getRawValue()));
    } catch (error: unknown) {
      this.passwordErrors.set(applyServerErrors(this.passwordForm, error));
      return;
    }

    await this.session.signOut();
    this.notifications.success('Password changed. Please sign in again.');
    void this.router.navigateByUrl('/login');
  }
}
```

- [ ] **Step 4: Register the route**

In `apps/web/src/app/app.routes.ts`, add to the shell route's `children`:

```ts
{
  path: 'settings',
  loadComponent: () => import('./settings/settings.component').then((m) => m.SettingsComponent),
},
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx nx test web --include='**/settings.component.spec.ts'`
Expected: PASS.

- [ ] **Step 6: Verify the whole workspace**

Run: `npx nx run-many -t lint typecheck test build --skip-nx-cache`
Expected: all green across `api`, `shared-types`, and `web`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/settings apps/web/src/app/app.routes.ts
git commit -m "feat(web): edit the profile and change the password"
```

---

## Task 14: The Playwright harness

Spec §12.2, §13. Sub-project 2 lost a review round to a flaky build gate,
so this task proves the harness green with **one trivial journey** before
Task 15 adds the real three. If something about booting two servers and a
database is wrong, it surfaces here with nothing else in the way.

**Ports are deliberately not 3000 and 4200.** A dev server on those ports
points at the `bills` development database, and a reused server would mean
end-to-end tests registering users into real data. Dedicated ports plus
`reuseExistingServer: false` make that impossible: Playwright starts both
servers itself and stops both when it finishes, which also satisfies the
rule that no task leaves a server process running.

**Files:**
- Create: `apps/web/proxy.e2e.conf.json`
- Modify: `apps/web-e2e/playwright.config.ts` (generated in Task 2)
- Create: `apps/web-e2e/src/global-setup.ts`
- Create: `apps/web-e2e/src/support/accounts.ts`
- Create: `apps/web-e2e/src/smoke.spec.ts`
- Delete: any example spec the generator created

**Interfaces:**
- Consumes: the built `api` and `web` projects.
- Produces: `newAccount(): TestAccount` from `src/support/accounts.ts`; a working `nx e2e web-e2e` target.

- [ ] **Step 1: Write the e2e proxy configuration**

Create `apps/web/proxy.e2e.conf.json`:

```json
{
  "/api": {
    "target": "http://localhost:3100",
    "secure": false
  }
}
```

The development proxy at `proxy.conf.json` stays pointed at 3000 and is
not touched.

- [ ] **Step 2: Write the database bootstrap**

Create `apps/web-e2e/src/global-setup.ts`:

```ts
import 'reflect-metadata';
import { execFileSync } from 'node:child_process';
import { workspaceRoot } from '@nx/devkit';
import { DataSource } from 'typeorm';

/**
 * Creates the end-to-end database if it is absent and brings it up to the
 * current migration.
 *
 * It is deliberately a **different database** from the `bills_test` one
 * `nx test-e2e api` truncates between its own tests. Sharing it would let
 * either suite delete the other's fixtures mid-run, and the failure would
 * look like a product bug rather than a harness collision.
 *
 * Nothing here drops a database or a volume. The database is created once
 * and reused; journeys isolate themselves by registering unique accounts,
 * so no run destroys another run's data.
 */
export default async function globalSetup(): Promise<void> {
  const url = process.env.E2E_DATABASE_URL;
  if (!url) {
    throw new Error(
      'E2E_DATABASE_URL is not set. playwright.config.ts defines it; this ' +
        'almost certainly means global setup was invoked outside that config.',
    );
  }

  const target = new URL(url);
  const databaseName = target.pathname.slice(1);

  const adminUrl = new URL(target.toString());
  adminUrl.pathname = '/postgres';

  const admin = new DataSource({ type: 'postgres', url: adminUrl.toString() });
  await admin.initialize();
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [
    databaseName,
  ]);
  if (existing.length === 0) {
    await admin.query(`CREATE DATABASE "${databaseName}"`);
  }
  await admin.destroy();

  // Migrations run through the workspace's own script rather than by
  // importing the API's data source. A cross-project `.js` specifier
  // resolves to a `.ts` file under Vitest but not reliably under
  // Playwright's loader, and `npm run migration:run` is a path the
  // repository already exercises. `data-source.ts` reads
  // `process.env.DATABASE_URL` directly, and dotenv leaves an existing
  // value alone, so this override is what it sees.
  execFileSync('npm', ['run', 'migration:run'], {
    cwd: workspaceRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  });
}
```

- [ ] **Step 3: Write the Playwright configuration**

Replace `apps/web-e2e/playwright.config.ts` with:

```ts
import { defineConfig, devices } from '@playwright/test';
import { workspaceRoot } from '@nx/devkit';

const API_PORT = 3100;
const WEB_PORT = 4300;
const DATABASE_URL = 'postgres://don:super@localhost:5432/bills_web_e2e';

/**
 * Every value the API needs, passed directly rather than through a file.
 * `@nestjs/config` leaves an existing `process.env` entry alone, so these
 * win over whatever `.env` sits in the API's working directory — which is
 * the point: an end-to-end run must never reach the development database.
 *
 * The secret is a test fixture, not a credential. It guards nothing but a
 * throwaway local database, and it is long enough to satisfy the schema's
 * 32-character floor.
 */
const apiEnv = {
  NODE_ENV: 'test',
  PORT: String(API_PORT),
  DATABASE_URL,
  E2E_DATABASE_URL: DATABASE_URL,
  DB_SSL: 'false',
  JWT_ACCESS_SECRET: 'playwright-e2e-only-not-a-real-secret-0123456789',
  JWT_ACCESS_TTL: '15m',
  REFRESH_TTL_DAYS: '30',
  BCRYPT_COST: '10',
  WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
  APP_TIMEZONE: 'UTC',
};

// Global setup runs in the Playwright process, not the server's, so it
// needs the URL on its own environment.
process.env.E2E_DATABASE_URL = DATABASE_URL;

export default defineConfig({
  testDir: './src',
  globalSetup: require.resolve('./src/global-setup.ts'),
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'npx nx run api:serve:development',
      url: `http://localhost:${API_PORT}/api/health`,
      cwd: workspaceRoot,
      // Never reuse. A server already listening on this port is not one
      // this config started, so its database and secrets are unknown.
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: apiEnv,
    },
    {
      command: `npx nx run web:serve --port=${WEB_PORT} --proxy-config=apps/web/proxy.e2e.conf.json`,
      url: `http://localhost:${WEB_PORT}`,
      cwd: workspaceRoot,
      reuseExistingServer: false,
      timeout: 180_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
```

If `--proxy-config` is not accepted by the generated `serve` target, add a
second configuration to that target in `apps/web/package.json` carrying
`proxyConfig` and invoke it by name instead. Record which was needed in
the task report.

- [ ] **Step 4: Write the account helper**

Create `apps/web-e2e/src/support/accounts.ts`:

```ts
import { randomUUID } from 'node:crypto';

export interface TestAccount {
  email: string;
  name: string;
  password: string;
}

/**
 * A fresh account per journey.
 *
 * Journeys isolate themselves by registering rather than by truncating, so
 * no run can destroy another run's data and the suite never needs a
 * destructive database operation.
 */
export function newAccount(): TestAccount {
  return {
    email: `e2e-${randomUUID()}@example.test`,
    name: 'Playwright Tester',
    password: 'hunter22-e2e',
  };
}
```

- [ ] **Step 5: Write the smoke journey**

Delete whatever example spec the generator wrote, then create
`apps/web-e2e/src/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { newAccount } from './support/accounts';

test('an anonymous visitor lands on the sign-in screen', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('registering signs the visitor in and shows the upcoming screen', async ({ page }) => {
  const account = newAccount();

  await page.goto('/register');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Name').fill(account.name);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/upcoming/);
  await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible();
});
```

- [ ] **Step 6: Run the harness**

Run: `npx nx e2e web-e2e`
Expected: both journeys pass, both servers start and stop, and
`bills_web_e2e` exists afterwards.

If the run fails, fix the harness here rather than carrying the problem
into Task 15. Record in the task report what the first green run required.

- [ ] **Step 7: Confirm nothing is left running**

Run: `lsof -nP -iTCP:3100 -sTCP:LISTEN; lsof -nP -iTCP:4300 -sTCP:LISTEN`
Expected: no output. Playwright owns both processes and stops them.

Do **not** run `docker compose down -v`; that volume holds the development
database.

- [ ] **Step 8: Commit**

```bash
git add apps/web-e2e apps/web/proxy.e2e.conf.json
git commit -m "test(web): stand up the Playwright harness against its own database"
```

---

## Task 15: The three journeys

Spec §12.2. Journey 2 is the one no unit test can replace, and its
assertion is a **count**, not a success.

**Journey 2 forces the 401 rather than waiting for a real expiry.** The
spec's original approach — booting the API with a two-second
`JWT_ACCESS_TTL` — was replaced during planning: it made every other
journey race the clock, and it put a timing knob in configuration that
must never reach development. Intercepting the first response to each of
three endpoints and returning 401 is deterministic, needs no waiting, and
exercises exactly the client behaviour under test. The refresh and the
retries still go to the real server.

**Files:**
- Create: `apps/web-e2e/src/support/flows.ts`
- Create: `apps/web-e2e/src/journey-payments.spec.ts`
- Create: `apps/web-e2e/src/journey-refresh.spec.ts`
- Create: `apps/web-e2e/src/journey-reversal.spec.ts`

**Interfaces:**
- Consumes: `newAccount()` (Task 14).
- Produces: `registerAndSignIn(page, account)`, `createBill(page, bill)`, `startOfThisMonth()` from `src/support/flows.ts`.

- [ ] **Step 1: Write the shared flows**

Create `apps/web-e2e/src/support/flows.ts`:

```ts
import { Page, expect } from '@playwright/test';
import { TestAccount } from './accounts';

export async function registerAndSignIn(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Name').fill(account.name);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/upcoming/);
}

/**
 * The first of the current month, as a bare `YYYY-MM-DD`.
 *
 * The API generates occurrences from the current period forward, so a bill
 * starting here produces an instance the default range already shows. The
 * server runs in UTC under this harness (`APP_TIMEZONE=UTC` in
 * `playwright.config.ts`), so `toISOString` agrees with it.
 */
export function startOfThisMonth(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

export interface BillInput {
  name: string;
  amount: string;
  startDate: string;
}

export async function createBill(page: Page, bill: BillInput): Promise<void> {
  await page.goto('/bills/new');
  await page.getByLabel('Name').fill(bill.name);
  await page.getByLabel('Amount').fill(bill.amount);
  await page.getByLabel('Starts').fill(bill.startDate);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(page.getByText(bill.name)).toBeVisible();
}
```

- [ ] **Step 2: Write journey 1 — the working path**

Create `apps/web-e2e/src/journey-payments.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { newAccount } from './support/accounts';
import { createBill, registerAndSignIn, startOfThisMonth } from './support/flows';

test('a bill becomes partly paid and then paid', async ({ page }) => {
  const account = newAccount();
  await registerAndSignIn(page, account);

  await createBill(page, { name: 'Rent', amount: '1200', startDate: startOfThisMonth() });

  await page.goto('/upcoming');
  await expect(page.getByText('Rent').first()).toBeVisible();
  await expect(page.getByText('Unpaid').first()).toBeVisible();

  await page.getByText('Rent').first().click();

  // A partial payment: the amount is typed, so the server is told what it is.
  await page.getByRole('button', { name: 'Record payment' }).first().click();
  await page.getByLabel('Pay the full remaining balance').uncheck();
  await page.getByLabel('Amount').fill('500');
  await page.getByRole('button', { name: 'Record' }).click();

  await expect(page.getByText('Partly paid').first()).toBeVisible();
  await expect(page.getByText('$700.00').first()).toBeVisible();

  // The rest, as a full payment: no amount is sent at all, and the server
  // computes the balance under its row lock.
  await page.getByRole('button', { name: 'Record payment' }).first().click();
  await expect(page.getByLabel('Pay the full remaining balance')).toBeChecked();
  await page.getByRole('button', { name: 'Record' }).click();

  await expect(page.getByText('Paid').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
});
```

- [ ] **Step 3: Write journey 2 — silent refresh**

Create `apps/web-e2e/src/journey-refresh.spec.ts`:

```ts
import { Request, expect, test } from '@playwright/test';
import { newAccount } from './support/accounts';
import { registerAndSignIn } from './support/flows';

test('several requests failing at once produce exactly one refresh', async ({ page }) => {
  const account = newAccount();
  await registerAndSignIn(page, account);

  // Reject the next response from each of these endpoints with a 401,
  // exactly as an expired access token would. Doing it this way rather
  // than by shortening JWT_ACCESS_TTL keeps the test deterministic and
  // keeps a timing knob out of the API's configuration.
  const alreadyRejected = new Set<string>();
  await page.route(/\/api\/(bills|categories|bill-instances)/, async (route) => {
    const key = new URL(route.request().url()).pathname;
    if (alreadyRejected.has(key)) {
      await route.continue();
      return;
    }
    alreadyRejected.add(key);
    await route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({ statusCode: 401, message: 'Unauthorized' }),
    });
  });

  let refreshCount = 0;
  const countRefreshes = (request: Request): void => {
    if (request.url().includes('/api/auth/refresh') && request.method() === 'POST') {
      refreshCount += 1;
    }
  };
  page.on('request', countRefreshes);

  // A screen that loads several resources at once, so several 401s land
  // together and the single-flight path is the one under test.
  await page.goto('/bills');
  await expect(page.getByRole('heading', { name: 'Bills' })).toBeVisible();
  await expect(page.getByText('No bills yet')).toBeVisible();

  page.off('request', countRefreshes);

  // The assertion this design exists for. Passing with three refreshes
  // would mean the application works and single-flighting is broken.
  expect(refreshCount).toBe(1);

  // And the session survived: the shell still knows who this is.
  await expect(page.getByText(account.name)).toBeVisible();
});

test('a visitor whose refresh fails is told why', async ({ page }) => {
  const account = newAccount();
  await registerAndSignIn(page, account);

  const unauthorized = {
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ statusCode: 401, message: 'Unauthorized' }),
  };

  await page.route(/\/api\/bills(\?|$)/, (route) => route.fulfill(unauthorized));
  await page.route(/\/api\/auth\/refresh/, (route) => route.fulfill(unauthorized));

  await page.goto('/bills');

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText('Your session expired')).toBeVisible();
});
```

- [ ] **Step 4: Write journey 3 — reversal**

Create `apps/web-e2e/src/journey-reversal.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { newAccount } from './support/accounts';
import { createBill, registerAndSignIn, startOfThisMonth } from './support/flows';

test('a reversed payment leaves both entries in the history', async ({ page }) => {
  const account = newAccount();
  await registerAndSignIn(page, account);

  await createBill(page, { name: 'Water', amount: '60', startDate: startOfThisMonth() });

  await page.goto('/upcoming');
  await page.getByText('Water').first().click();

  await page.getByRole('button', { name: 'Record payment' }).first().click();
  await page.getByRole('button', { name: 'Record' }).click();
  await expect(page.getByText('Paid').first()).toBeVisible();

  await page.getByRole('button', { name: 'Reverse this payment' }).first().click();

  // The instance is unpaid again...
  await expect(page.getByText('Unpaid').first()).toBeVisible();

  // ...and both rows are still there. The log is append-only; a history
  // that netted to nothing would have discarded the fact that something
  // happened and was undone, which is the whole reason it works this way.
  await expect(page.getByTestId('payment-entry')).toHaveCount(2);
  await expect(page.getByText('Reversal')).toBeVisible();
  await expect(page.getByText('-$60.00')).toBeVisible();
});
```

- [ ] **Step 5: Run the journeys**

Run: `npx nx e2e web-e2e`
Expected: six tests pass — the two smoke tests plus these four.

- [ ] **Step 6: Run them twice more, to catch order dependence**

Run: `npx nx e2e web-e2e --skip-nx-cache`, twice.
Expected: green each time. Each journey registers its own account, so
nothing should depend on run order. If a run is red, fix the cause rather
than adding a retry.

- [ ] **Step 7: Prove the refresh count can fail**

Temporarily remove the single-flight cache from `SessionService.refresh()`
again, as in Task 6 Step 9 — delete the early return and the assignment.

Run: `npx nx e2e web-e2e -- journey-refresh`
Expected: FAIL, with `expect(refreshCount).toBe(1)` receiving 3.

Restore and re-run. Expected: PASS. A journey that only asserted the page
rendered would have passed in both states.

- [ ] **Step 8: Run the whole workspace one last time**

```bash
npx nx run-many -t lint typecheck test build --skip-nx-cache
npx nx test-e2e api --skip-nx-cache
npx nx e2e web-e2e --skip-nx-cache
npm audit --omit=dev
```

Expected: every target green, the API's own end-to-end suite still fully
passing, and no production vulnerabilities.

- [ ] **Step 9: Confirm nothing is left running**

Run: `lsof -nP -iTCP:3100 -sTCP:LISTEN; lsof -nP -iTCP:4300 -sTCP:LISTEN`
Expected: no output.

- [ ] **Step 10: Commit**

```bash
git add apps/web-e2e
git commit -m "test(web): add the payment, silent-refresh, and reversal journeys

The refresh journey asserts a count rather than a success: one
POST /api/auth/refresh for three simultaneous 401s. A journey that only
checked the page rendered would pass against a stampede."
```
