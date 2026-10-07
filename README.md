# Bill Organization Tracker — API

Backend foundation for a bill management application: an Nx monorepo, a
PostgreSQL schema, cookie/JWT authentication with rotating refresh
tokens, and the user and category resources everything else depends on.

## Prerequisites

- Node.js ≥ 24.11
- Docker (for PostgreSQL via Docker Compose)

## Running the whole stack

`docker compose` brings up everything — Postgres, the API, the Angular
client behind nginx, and a mail catcher — with no Node toolchain needed:

```bash
echo "JWT_ACCESS_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env
docker compose up -d --build --wait
```

| | |
|---|---|
| Application | <http://localhost:8080> |
| Reminder digests | <http://localhost:8025> (Mailpit) |
| API, for `curl` | <http://localhost:3000/api> |

`JWT_ACCESS_SECRET` has no default anywhere, compose included — the file
references it as `${JWT_ACCESS_SECRET:?...}`, so compose refuses to start
rather than signing tokens with a value committed to source control.

Three things worth knowing about how this is wired:

- **nginx proxies `/api` to the API** rather than the browser talking to
  port 3000 directly. The client requests the relative path `/api`, baked
  into the bundle at build time, so it goes wherever the bundle was served
  from. Proxying also keeps the refresh cookie first-party — the same
  arrangement `apps/web/proxy.conf.json` makes in development, and what
  the auth design assumes when it sets `SameSite=Lax`.
- **A one-shot `migrate` service applies the schema** before the API
  starts, via `depends_on: service_completed_successfully`. A failed
  migration holds the API back instead of letting it serve against a
  schema that was never applied. `docker compose logs migrate` names
  each migration it applied.
- **Code changes need `--build`.** These are production images, not bind
  mounts; `npx nx serve` below remains the fast edit loop.

`docker compose down` stops everything and keeps your data. Adding `-v`
would delete the Postgres volume.

## Setup for local development

1. Start just the database:

   ```bash
   docker compose up -d --wait postgres
   ```

2. Install dependencies:

   ```bash
   npm install
   ```

   `@nx/nest@23.2.0` peer-requires `@nestjs/common`/`@nestjs/core`
   `>=10.0.0 <12.0.0`, but this project runs NestJS **12.1.2**, per the
   design spec's stack table and `@nestjs/testing@12.1.2`'s own peer
   requirements. The root `.npmrc` sets `legacy-peer-deps=true` so a
   plain `npm install` resolves without extra flags — remove it once
   `@nx/nest` declares support for NestJS 12.

3. Copy the environment template and fill in a real secret:

   ```bash
   cp .env.example .env
   ```

   Generate a `JWT_ACCESS_SECRET` (32+ random characters — no default is
   provided, deliberately, so a convenient dev value never ends up
   signing tokens in production):

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

   Paste the output into `.env` as `JWT_ACCESS_SECRET`.

4. Apply the database schema:

   ```bash
   npm run migration:run
   ```

   `npm run migration:revert` reverses the most recently applied
   migration.

5. Run the API:

   ```bash
   npx nx serve api
   ```

   The server listens on `PORT` (default `3000`) under the `/api`
   prefix. `GET /api/health` reports database connectivity and requires
   no authentication.

## Environment variables

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `development` \| `test` \| `production` |
| `PORT` | `3000` | HTTP port |
| `DATABASE_URL` | — | Postgres connection string |
| `DB_SSL` | `false` | `true` to require SSL on the database connection |
| `JWT_ACCESS_SECRET` | — | 32+ random characters; no default, deliberately — see setup step 3 |
| `JWT_ACCESS_TTL` | `15m` | access token lifetime |
| `REFRESH_TTL_DAYS` | `30` | refresh token lifetime |
| `BCRYPT_COST` | `12` | bcrypt cost factor for password hashing |
| `WEB_ORIGIN` | — | the origin CORS is configured to allow |
| `APP_TIMEZONE` | `UTC` | IANA timezone (e.g. `America/New_York`) governing every date the API computes — due dates, overdue derivation, and the nightly horizon roll |
| `SMTP_URL` | — | optional; absent selects the logging transport, so reminder digests go to the application log. Set it and mail is sent for real. May carry a password, so it has no default |
| `MAIL_FROM` | — | required *only* when `SMTP_URL` is set; the sender address on reminder digests |

## Testing and linting

```bash
npx nx test api       # unit tests
npx nx test-e2e api   # integration + end-to-end tests (requires the database)
npx nx lint api       # oxlint
```

Unit and e2e tests use separate environment files (`.env` is not read
by tests): the e2e suite points at a dedicated `bills_test` database via
`apps/api/.env.test` and creates/migrates it automatically on first run
(the e2e suite's `globalSetup` does this for you — the note below is
only for migrating it by hand).

### Migrating the test database by hand

`npm run migration:run` resolves `.env` from the repo root, so it only
ever targets the dev `bills` database — running it does nothing to
`bills_test`, however stale that database's schema is. To run a
migration against the test database directly, point it at
`apps/api/.env.test` instead:

```bash
ENV_FILE=apps/api/.env.test npm run migration:run
```

The same applies to `migration:revert`. This is only needed for manual
operation — the e2e suite's `globalSetup` migrates `bills_test` to head
automatically, so day-to-day test runs never require it.

### Dependency audit triage

`npm audit` reports high-severity advisories (as of 2026-10-04: 22
vulnerabilities, 20 high / 2 moderate). Every one is a dev-only Nx
toolchain transitive (webpack-dev-server's chokidar/http-proxy-middleware
chain, smol-toml, sockjs's uuid), most with no fix available short of a
breaking Nx major bump:

```bash
npm audit --omit=dev   # 0 vulnerabilities
```

Nothing in the production dependency graph is affected. Re-run the
`--omit=dev` command above rather than re-litigating the full report —
it's the one that reflects what actually ships.

## API surface

All routes sit under a global `/api` prefix. There is no URL
versioning; the only consumer is controlled by the same repository.

### Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/api/auth/register` | `{email, name, password}` | `201 {accessToken, user}` + `Set-Cookie` |
| POST | `/api/auth/login` | `{email, password}` | `200 {accessToken, user}` + `Set-Cookie` |
| POST | `/api/auth/refresh` | (cookie only) | `200 {accessToken}` + rotated cookie |
| POST | `/api/auth/logout` | — | `204`, revokes and clears the cookie |

Register, login, and refresh are public. Logout requires a bearer
access token.

### Users

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/users/me` | — | profile |
| PATCH | `/api/users/me` | `{name?, notifyEmail?, notifyInApp?}` | updated profile |
| PATCH | `/api/users/me/password` | `{currentPassword, newPassword}` | `204`, revokes every session |

There is no `/api/users/:id` route. Every operation is scoped to the
authenticated caller, which makes horizontal privilege escalation
structurally impossible rather than dependent on a guard being correct.

### Categories

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/api/categories` | — | the caller's categories |
| POST | `/api/categories` | `{name, color?}` | `201` |
| PATCH | `/api/categories/:id` | `{name?, color?}` | updated category |
| DELETE | `/api/categories/:id` | — | `204`, or `409` while a bill references the category |

Every query is filtered by `user_id` in the service layer; a path
parameter is never trusted as proof of ownership. `DELETE` returns
**409** while any bill still references the category, naming how many
in the error message, counted among the caller's own bills only — it
closes once every referencing bill is reassigned or deleted.

### Bills

| Method | Path | Notes |
|---|---|---|
| GET | `/api/bills` | `?isActive=` optional; ordered by name |
| POST | `/api/bills` | `201`; generates instances synchronously |
| GET | `/api/bills/:id` | 404 if not owned |
| PATCH | `/api/bills/:id` | rewrites future instances |
| DELETE | `/api/bills/:id` | `204`; cascades instances and logs — see "Delete versus deactivate" below |

Validation: `name` 1–100 chars; `defaultAmount` `> 0` and
`<= 9999999999.99` (the column's capacity); `frequency` one of
`ONE_TIME`, `WEEKLY`, `MONTHLY`, `ANNUALLY`; `startDate` a valid
`YYYY-MM-DD`; `endDate` null or `>= startDate`; `categoryId` null or a
category owned by the same user, `400` otherwise.

### Bill instances

| Method | Path | Notes |
|---|---|---|
| GET | `/api/bill-instances` | requires `from`/`to`; see below |
| GET | `/api/bill-instances/:id` | |
| PATCH | `/api/bill-instances/:id` | `amount`, `note`; sets `isCustomized` |
| GET | `/api/bill-instances/:id/payments` | oldest first |

`GET /api/bill-instances` requires `from` and `to`, both `YYYY-MM-DD`,
with `to >= from` and `to - from <= 400` days — the bounded range is
the pagination; there is no cursor. Concretely, `from=X&to=X+400` is
the widest accepted span. Optional filters:
`status=UNPAID|PARTIALLY_PAID|PAID`, `overdue=true|false` (`false`
means `status = 'PAID' OR due_date >= today`), `billId=<uuid>`. Ordered
by `due_date`, then `id`.

`PATCH` accepts `amount` and `note` only — `dueDate` is not editable
(move the occurrence by editing the template instead). `amount` must
stay `> 0` and `>= amountPaid`. Any successful `PATCH` sets
`isCustomized = true` and recomputes `status` — **including an empty
`PATCH {}`**, which changes nothing else but still permanently opts
that occurrence out of future template rewrites (spec §5.4). Clients
should not send empty PATCHes.

### Payments

| Method | Path | Notes |
|---|---|---|
| POST | `/api/bill-instances/:id/payments` | `201`; `{amount?, paidAt?, note?}` |
| POST | `/api/bill-instances/:id/payments/:paymentId/reverse` | `201` |
| POST | `/api/bill-instances/:id/unpay` | `200`; returns the instance |

All three return the updated instance alongside the log row, so a
client never needs a follow-up read to refresh its row. `payment_logs`
is append-only: a reversal records the exact negation of a payment
rather than deleting it, so "I mis-clicked" stays visible in the log.

### Delete versus deactivate

Two different ways to stop a bill, with very different blast radii:

- **`DELETE /api/bills/:id`** destroys the template itself, every one
  of its materialized instances, and their entire payment history.
  There is no undo.
- **`PATCH /api/bills/:id { "isActive": false }`** stops future
  instance generation and removes future instances that are unpaid,
  carry no payments, and are uncustomized. Everything else survives
  untouched: past (already-due) instances, anything paid or partially
  paid, anything customized, and any instance with payment history at
  all — including one that was paid and then fully reversed back to
  `UNPAID`/`0`, since reversing a payment does not erase its log rows.

Reach for `PATCH { isActive: false }` whenever the bill merely ended
(a subscription cancelled, a loan paid off) and the history should
survive; reach for `DELETE` only when the bill was created in error
and should never have existed.

## Token model

Authentication issues two tokens with deliberately different
lifetimes and storage. The **access token** is a short-lived (15
minute default) JWT carrying `{sub, email}`, kept in memory by the
client and never written to `localStorage`, so it can't be exfiltrated
by XSS into a durable credential. The **refresh token** is an opaque
32-byte random value stored in an `httpOnly`, `SameSite=Lax` cookie
scoped to `Path=/api/auth`; the server never sees the raw value again
after issuing it — only its SHA-256 hash, held in the `refresh_tokens`
table. `POST /api/auth/refresh` looks the hash up, and rotation is
where the security model lives: presenting an **already-revoked**
token outside a 30-second grace window is read as token theft and
revokes every refresh token the user holds, logging out all of their
sessions at once. Inside the grace window it's treated as the
ordinary double-refresh race a browser produces when two API calls
both receive a 401 at once — the chain is walked forward to its live
tip and that token is rotated instead. Changing a password, like a
detected theft, revokes every outstanding session.

## Project layout

```
apps/api/            NestJS application
  src/
    app/              AppModule wiring
    config/           Zod-validated environment schema
    database/         TypeORM data source and migrations
    auth/             AuthModule, TokenService, JWT strategy and guard
    users/            UsersModule — profile and password management
    categories/       CategoriesModule — ownership-scoped CRUD
    bills/            BillsModule — bills, instances, payments, generation
    health/           /api/health (Terminus)
    common/           shared filters, decorators, validators
  test/               integration (*.int-spec.ts) and e2e (*.e2e-spec.ts) specs
libs/shared-types/    TypeScript interfaces shared between API and (future) web app
docs/                 design specs and plans
```
