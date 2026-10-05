# Design: API Foundation (Sub-project 1)

**Date:** 2026-10-04
**Status:** Approved
**Sub-project:** 1 of 5

## 1. Purpose

Build the backend foundation for a bill management application: an Nx
monorepo, a PostgreSQL schema, authentication, and the user and category
resources that everything else depends on.

The application serves two goals at once. It is a real tool its author
will use to track household bills, and it is a showcase of Angular +
NestJS + PostgreSQL work. Both goals set the bar: the functionality must
actually work, and the code must survive review.

### Success criteria

- `docker compose up` plus one migration command yields a working database.
- A user can register, log in, read and update their profile, and manage
  their categories through the HTTP API.
- Access tokens expire and refresh silently; a replayed refresh token
  locks the session chain.
- Every service has unit tests; every auth flow has an integration test;
  one end-to-end journey covers the full token lifecycle.

### Non-goals

Bills, bill instances, payment logs, notifications, and the Angular
application. Each belongs to a later sub-project.

## 2. Context: decomposition

The source PRD spans four phases and is too large for one specification.
It is divided into five sub-projects, each with its own spec, plan, and
build cycle:

| # | Sub-project | Covers |
|---|---|---|
| **1** | **API foundation** | Nx workspace, schema, migrations, auth, users, categories |
| 2 | Bills API | Templates, instance generator, CRUD, status toggle, payment logs |
| 3 | Angular shell | Routing, auth interceptor, login/register, bill list and form |
| 4 | Views | Dashboard summary cards, calendar view, filtering and sorting |
| 5 | Notifications | `@nestjs/schedule` reminders at T-3 and T-1 days |

This document specifies sub-project 1. It also fixes the complete data
model, including tables that sub-project 2 will migrate, so later work
inherits a consistent model instead of re-deriving one.

## 3. Stack

Versions verified against the npm registry on 2026-10-04.

| Component | Version |
|---|---|
| Nx | 23.2.1 |
| NestJS | 12.1.2 |
| TypeORM | 1.1.1 |
| `@nestjs/typeorm` | 12.0.2 (peer-accepts TypeORM 1.x) |
| PostgreSQL | 17 (alpine, via Docker Compose) |
| Node | 24.14.1 |
| Angular | 22.2.1 (sub-project 3) |

Testing uses Vitest with supertest. Linting uses oxlint; formatting uses
Prettier. These follow the author's earlier scaffold rather than Nx
defaults, which would have selected Jest and ESLint.

## 4. Workspace layout

```
bill-tracker/
├── apps/
│   ├── api/                      NestJS
│   │   └── src/
│   │       ├── main.ts
│   │       ├── app/app.module.ts
│   │       ├── config/           typed env loading, boot-time validation
│   │       ├── database/         data-source.ts, migrations/
│   │       ├── common/           exception filter, @CurrentUser, @Public
│   │       ├── auth/             credentials, tokens, guards, strategies
│   │       ├── users/            profile and persistence
│   │       └── categories/       per-user categories
│   └── api-e2e/                  supertest against a real PostgreSQL
├── libs/
│   └── shared-types/             pure TypeScript: enums, DTO contracts
├── docs/superpowers/specs/
├── docker-compose.yml
└── nx.json
```

`apps/web` is generated in sub-project 3. Scaffolding an Angular
application two milestones before it is touched adds weight to every
`nx affected` run for no benefit.

`libs/shared-types` contains only interfaces and enums, with no NestJS or
Angular imports, so both applications can depend on it without pulling in
a runtime.

## 5. Module responsibilities

Authentication splits across three small units rather than one service,
so each can be tested with the others mocked:

- **`UsersService`** — persistence and password-hash storage. Knows
  bcrypt; knows nothing about tokens.
- **`AuthService`** — verifies credentials and orchestrates register and
  login. Knows nothing about storage details.
- **`TokenService`** — mints access JWTs; issues, rotates, and revokes
  refresh tokens. Knows nothing about passwords.

**`CategoriesService`** owns category CRUD, filtering every query by the
owning user.

### Two global decisions

**`JwtAuthGuard` is registered globally** through `APP_GUARD`, with an
explicit `@Public()` decorator to opt out. A newly added controller is
therefore protected by default rather than protected if the author
remembered a decorator. Exactly four routes are public: register, login,
refresh, and health.

**`ValidationPipe` is global** with `whitelist: true` and
`transform: true`, so unknown request properties are stripped rather than
silently accepted.

## 6. Data model

### Migration timing

Migrations land per sub-project: `users`, `refresh_tokens`, and
`categories` in this one; `bills`, `bill_instances`, and `payment_logs` in
sub-project 2. This departs from the PRD, which initializes all tables in
phase 1. The reason is that a migration for a table no code reads cannot
be verified by a test, so it would ship unverified. The full schema is
specified below regardless.

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()`, built into PostgreSQL 17 |
| `email` | `varchar(255)` UNIQUE | lowercased in the application layer |
| `password_hash` | `varchar(60)` | bcrypt, cost 12 |
| `name` | `varchar(100)` | |
| `notify_email` | `boolean` | default `true` |
| `notify_in_app` | `boolean` | default `true` |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

Email is lowercased in the application rather than stored as `citext`,
avoiding a PostgreSQL extension dependency.

Notification preferences are two boolean columns, not a JSON blob or a
preferences table. The PRD requires reminders at T-3 and T-1 days on
fixed channels; anything more general is speculation.

### `refresh_tokens`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → `users` | `ON DELETE CASCADE` |
| `token_hash` | `varchar(64)` UNIQUE | SHA-256 of an opaque 32-byte token |
| `expires_at` | `timestamptz` | |
| `revoked_at` | `timestamptz` NULL | |
| `replaced_by` | `uuid` NULL FK → `refresh_tokens` | set on rotation |
| `created_at` | `timestamptz` | |

Index on `user_id`. `replaced_by` links a rotated token to its successor
and exists to resolve the concurrent-refresh race described in §7.

The refresh token is opaque and stored hashed, not as a JWT. A revocable
JWT requires a blocklist table, which is this table with extra
indirection. Storing only the hash means a database dump does not yield
live sessions.

### `categories`

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | |
| `user_id` | `uuid` FK → `users` | `ON DELETE CASCADE` |
| `name` | `varchar(50)` | UNIQUE `(user_id, lower(name))` |
| `color` | `char(7)` NULL | hex, for the calendar and dashboard in #4 |
| `created_at` | `timestamptz` | |
| `updated_at` | `timestamptz` | |

Categories are per-user, seeded on registration with the PRD's four
defaults: Utilities, Subscriptions, Housing, Credit Cards. A global
lookup table would need an ownership exception that nothing else in the
schema has.

### Forward schema (migrated in sub-project 2)

A recurring bill is modeled as a **template plus generated instances**.
The template holds the definition; each occurrence is its own row with
its own due date, amount, and status. This keeps history accurate, lets
the calendar show arbitrarily many future occurrences, makes overdue
detection a single indexed query, and allows the per-period amount to
vary — which utility bills do.

**`bills`** (template) — `id`, `user_id`, `category_id`, `name`,
`default_amount numeric(12,2)`, `frequency`, `start_date date`,
`end_date date NULL`, `is_active boolean`, timestamps.

**`bill_instances`** — `id`, `bill_id`, `user_id`, `due_date date`,
`amount numeric(12,2)`, `status`, `paid_at timestamptz NULL`.

- **`UNIQUE (bill_id, due_date)`** makes the horizon generator idempotent.
  Re-running it is a no-op rather than a source of duplicate rows.
- `user_id` is **deliberately denormalized** so ownership checks and
  dashboard queries need no join through `bills`. This is a conscious
  normalization trade-off, not an oversight.
- Indexes: `(user_id, due_date)` and `(user_id, status, due_date)`.

**`payment_logs`** — `id`, `bill_instance_id`, `user_id`,
`amount_paid numeric(12,2)`, `paid_at timestamptz`,
`note varchar(255) NULL`, `created_at`.

The instance holds mutable current state; the log is append-only history.
If a bill is un-paid and re-paid, or paid for an amount other than the
one billed, the log still records what happened. A mutable `paid_at`
column is not a historical record.

### Instance generation (sub-project 2, decided here)

Instances are materialized **eagerly to a rolling 12-month horizon** by a
startup task and a nightly `@Cron` job. Every read — list, calendar,
dashboard, overdue sweep — is then a plain indexed range query with no
recurrence arithmetic at query time. Overdue marking is one
`UPDATE ... WHERE due_date < CURRENT_DATE AND status = 'UNPAID'`.

Lazy on-read expansion was rejected: it pushes recurrence logic into
every read path, where sorting, filtering, and paginating a mixed set of
persisted and computed rows is substantially harder to get right and to
test. A hybrid was rejected as requiring both mechanisms plus dedupe
rules between them.

The consequence to handle in sub-project 2: editing a template needs
explicit semantics for whether the change applies to existing unpaid
future instances.

### Type decisions

- **Money is `numeric(12,2)`** with an explicit TypeORM numeric
  transformer to `number`. Not floating point. Not integer cents, which
  would impose a ×100 convention on every DTO and template for no
  benefit at household amounts.
- **`due_date` is `date`, not `timestamptz`.** A bill is due on a
  calendar day. Representing it as an instant invents a timezone
  question that then corrupts overdue arithmetic and the calendar grid.
- **Enums are `varchar` with a `CHECK` constraint**, not native
  PostgreSQL enums. The TypeScript union in `libs/shared-types` is the
  single source of truth, and adding a value stays a trivial migration.
  The two enumerations, fixed here so sub-project 2 does not re-invent
  them:
  - `BillFrequency`: `ONE_TIME` | `WEEKLY` | `MONTHLY` | `ANNUALLY`
  - `BillStatus`: `UNPAID` | `PAID` | `OVERDUE`

## 7. Authentication

### Register

`POST /api/auth/register` runs in a single transaction: validate and
lowercase the email, hash the password with bcrypt at cost 12, insert the
user, insert the four default categories, commit, then issue a token
pair. If category seeding fails, no half-created user remains.

### Login

Credentials are compared with bcrypt. When the email does not exist, the
service still performs a bcrypt comparison against a fixed dummy hash
before returning 401. Without it, response latency reveals which emails
are registered. The error message is identical in both cases.

### Token pair

| | Access token | Refresh token |
|---|---|---|
| Form | JWT, HS256 | opaque 32 random bytes, base64url |
| Lifetime | 15 minutes | 30 days |
| Payload | `{ sub, email }` | none — it is a lookup key |
| Client storage | Angular service, in memory | httpOnly cookie |
| Server storage | not stored | SHA-256 hash in `refresh_tokens` |

The access token is never written to `localStorage` or
`sessionStorage`, so cross-site scripting cannot exfiltrate a durable
credential.

### Rotation and reuse detection

`POST /api/auth/refresh` reads the cookie, hashes it, and looks up the
row. If the token is valid, it is revoked and a fresh pair is issued. If
the row exists but is **already revoked**, that is a replay of a stolen
token: every refresh token for that user is revoked and the request
returns 401.

This rule is what makes rotation a containment mechanism rather than a
formality, and it is the design's primary security property.

### The concurrent-refresh race

Strict reuse detection breaks a legitimate case. When two API calls are
in flight and both receive 401, the client issues two refresh requests
carrying the same cookie. The first rotates successfully; the second
presents a token revoked microseconds earlier and, under the rule above,
logs the user out of a working session. This is ordinary behavior for a
single-page application, not an attack.

Resolution: a rotated token remains redeemable for a **30-second grace
window**. When a revoked token is presented:

1. If `revoked_at` is **outside** the window, treat it as replay and
   revoke the user's entire chain.
2. Inside the window, walk `replaced_by` **forward to the newest link in
   the chain**, and rotate that link if it is still live.
3. Inside the window with no live link — the chain ends revoked — reject
   the request with 401 but do **not** revoke the chain. That is a logout
   race, not a theft signal.

**Following the chain to its tip, rather than checking only the immediate
successor, is required.** A single hop tolerates exactly two concurrent
refreshes. With three — an ordinary dashboard loading three resources that
all return 401 — the first rotates `T`→`A`, the second graces to `A` and
issues `B`, and the third still points at `A`, which is now revoked. It
would fall through to chain revocation and log the user out: precisely the
false positive this mechanism exists to prevent, one request later. The
walk is bounded (16 hops) so corrupt data cannot loop.

**Revocation is checked before expiry.** A token that is both expired and
revoked must still trigger replay handling. Checking expiry first would
return a bland "expired" and discard the theft signal — and because every
rotation issues a fresh `expires_at`, a chain outlives any single stolen
token, so an attacker who sits on a stolen token past its expiry would
escape detection entirely.

**Rotation is serialized.** The read-check-write runs in one transaction
holding a `SELECT ... FOR UPDATE` lock on the presented row. Without it,
two genuinely simultaneous requests can both observe the token as live and
both rotate it, issuing two successors and orphaning one. The grace window
handles requests that arrive sequentially; the lock handles those that
arrive at the same instant.

The window is deliberately short. A stolen token is valuable for days;
confining the ambiguity to 30 seconds preserves the security property
while eliminating the false positive. Clients should still single-flight
their refresh calls; this makes correctness independent of whether they
do.

### Cookie attributes

`httpOnly`, `Secure` in production, `SameSite=Lax`, `Path=/api/auth`.

`SameSite=Lax` suffices for `localhost:4200 → localhost:3000` because
SameSite keys on site, not origin, and the port does not change the site.
If the API is ever hosted on a different registrable domain from the web
application, this must become `SameSite=None; Secure`.

### Password policy

Minimum 8 characters, no composition rules, maximum 72 bytes.

Composition rules are omitted deliberately, following NIST guidance;
mandatory symbol classes reliably produce weaker passwords. The 72-byte
maximum is not arbitrary: bcrypt silently truncates input beyond 72
bytes, so without an explicit limit a longer password and its 72-byte
prefix authenticate identically and no one is informed.

Changing a password revokes every refresh token for that user.

## 8. API surface

All routes sit under a global `/api` prefix. There is no URL versioning;
the only consumer is controlled by the same repository.

### Auth

```
POST   /api/auth/register   {email,name,password} → 201 {accessToken, user} + Set-Cookie
POST   /api/auth/login      {email,password}      → 200 {accessToken, user} + Set-Cookie
POST   /api/auth/refresh    (cookie only)         → 200 {accessToken}       + rotated cookie
POST   /api/auth/logout                           → 204, revoke and clear cookie
```

Register, login, and refresh are `@Public()`. Logout is authenticated.

### Users

```
GET    /api/users/me          → profile
PATCH  /api/users/me          {name?, notifyEmail?, notifyInApp?}
PATCH  /api/users/me/password {currentPassword, newPassword} → 204, revoke all sessions
```

There is no `/api/users/:id` route. Scoping every operation to the
authenticated caller makes horizontal privilege escalation structurally
impossible rather than dependent on a guard being correct.

### Categories

```
GET    /api/categories
POST   /api/categories      {name, color?} → 201
PATCH  /api/categories/:id  {name?, color?}
DELETE /api/categories/:id  → 204
```

Every query is filtered by `user_id` in the service layer; a path
parameter is never trusted as proof of ownership.

`DELETE` is unconditional in this sub-project. In sub-project 2 it gains
a `409 Conflict` when bills reference the category.

Request and response shapes are declared as interfaces in
`libs/shared-types`, with `class-validator` DTOs in the API implementing
them. Contract drift between Angular and NestJS therefore becomes a
compile error in sub-project 3.

## 9. Configuration and secrets

`@nestjs/config` loads environment variables and validates them against a
Zod schema in `config/env.schema.ts` at boot. The application refuses to
start on a missing or malformed variable rather than failing later on
first use. Services inject a typed configuration object and never read
`process.env` directly.

```
NODE_ENV           development | test | production
PORT               3000
DATABASE_URL       postgres://don:super@localhost:5432/bills
DB_SSL             false locally, true in production
JWT_ACCESS_SECRET  minimum 32 characters, no default
JWT_ACCESS_TTL     15m
REFRESH_TTL_DAYS   30
BCRYPT_COST        12
WEB_ORIGIN         http://localhost:4200  (CORS allowlist, credentials: true)
```

`.env.example` is committed with placeholder values; `.env` is ignored.

**No secret has a fallback default.** A development default for
`JWT_ACCESS_SECRET` is precisely the kind of value that reaches
production and signs real tokens.

`DB_SSL` satisfies the PRD's encrypted-database-connection requirement:
disabled against local Docker, TLS with `rejectUnauthorized` in
production.

### Migrations

**`synchronize: false` in every environment, including development.**
TypeORM's auto-synchronization silently drops columns to match entities.
All schema change flows through migration files under
`apps/api/src/database/migrations/`, executed by an Nx target. The
migration files are consequently the authoritative schema history.

## 10. Error handling

A global exception filter normalizes every failure to one shape:

```json
{
  "statusCode": 409,
  "error": "Conflict",
  "message": "Email already registered",
  "path": "/api/auth/register",
  "timestamp": "2026-10-04T12:00:00.000Z"
}
```

Three mappings matter because the defaults leak:

- **PostgreSQL error `23505`** (unique violation) maps to
  `409 Conflict`. The default behavior produces a 500 whose message
  contains the constraint name and sometimes the originating SQL — a bad
  API response and an information disclosure.
- **`ValidationPipe` failures** map to `400` with per-field detail, so
  the Angular reactive forms in sub-project 3 can attach errors to
  individual controls instead of displaying one opaque string.
- **Unhandled exceptions** map to a generic `500`. The real stack is
  logged server-side against a request identifier. Stack traces never
  cross the wire in production.

`GET /api/health` uses `@nestjs/terminus` with a live database ping, so
process liveness and database reachability are distinguishable.

## 11. Testing strategy

Development follows test-driven development: a failing test precedes
implementation for every unit described here.

**Unit tests** (Vitest, repositories mocked) cover `UsersService`,
`AuthService`, `TokenService`, and `CategoriesService`. No database, so
they run on every save.

**Integration and end-to-end tests** (Vitest with supertest) run against
a dedicated `bills_test` database on the existing Docker instance. A
global setup runs migrations once; a `TRUNCATE ... CASCADE` helper resets
state between tests.

Testcontainers was considered and deferred. It offers stronger isolation
and better CI portability at the cost of an added dependency and several
seconds per run. The test database is the starting point; Testcontainers
is the answer if CI requires it.

### Required auth test cases

These branches are the ones most often skipped and are where the defects
concentrate:

- register with a duplicate email returns 409, not 500
- register either creates the user and all four categories or neither
  (transaction rollback)
- login with a wrong password returns 401
- login with an unknown email returns a byte-identical response to a
  wrong password
- the 72-byte password cap is enforced before bcrypt receives the input
- a valid refresh rotates the token and marks the previous hash revoked
- replaying a revoked refresh token revokes the user's entire token chain
- an expired refresh token returns 401
- two concurrent refreshes with the same cookie both succeed, and the
  user is not logged out
- **three** concurrent refreshes with the same cookie all succeed, and the
  user is not logged out — the single-hop version of this design fails here
- a revoked token with no live successor, presented inside the window,
  returns 401 without revoking the chain (logout race)
- a token that is both expired and revoked triggers replay handling, not
  an expiry error
- a revoked token presented outside the 30-second grace window revokes
  the chain
- a controller without `@Public()` rejects an anonymous request, proving
  the global guard fails closed
- changing a password invalidates every previously issued refresh token

### End-to-end journey

One test drives the full HTTP stack with a cookie jar: register, make an
authenticated request, allow the access token to expire, refresh
silently, replay the previous refresh token, confirm the resulting
lockout, and log out.

Expiry is reached by setting `JWT_ACCESS_TTL=1s` in the test
environment, not by waiting fifteen minutes and not by mocking the
clock. The token is genuinely expired, and the suite stays fast. This is
why `JWT_ACCESS_TTL` is a configuration variable rather than a
constant.

## 12. Resolved infrastructure defect

The pre-existing `docker-compose.yml` set
`PGDATA=/var/lib/postgresql/pgdata` while mounting the named volume at
`/varlib/postgresql/data` — a missing slash, and a path that would not
have matched `PGDATA` even when corrected. PostgreSQL data did not
survive `docker compose down`.

Fixed by removing the custom `PGDATA` and mounting the volume at the
conventional `/var/lib/postgresql/data`. Verified by writing a row,
stopping the stack, restarting it, and confirming the row survived.

## 13. Open items for later sub-projects

- Template edits versus existing future instances: "this occurrence" or
  "all future occurrences" semantics (sub-project 2).
- `DELETE /api/categories/:id` gains a 409 when bills reference the
  category (sub-project 2).
- Angular UI component strategy, not yet decided (sub-project 3).
- Notification delivery channel — real email provider or in-app only —
  not yet decided (sub-project 5).
