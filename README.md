# Bill Organization Tracker — API

Backend foundation for a bill management application: an Nx monorepo, a
PostgreSQL schema, cookie/JWT authentication with rotating refresh
tokens, and the user and category resources everything else depends on.

## Prerequisites

- Node.js ≥ 24.11
- Docker (for PostgreSQL via Docker Compose)

## Setup

1. Start the database:

   ```bash
   docker compose up -d --wait
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

## Testing and linting

```bash
npx nx test api       # unit tests
npx nx test-e2e api   # integration + end-to-end tests (requires the database)
npx nx lint api       # oxlint
```

Unit and e2e tests use separate environment files (`.env` is not read
by tests): the e2e suite points at a dedicated `bills_test` database via
`apps/api/.env.test` and creates/migrates it automatically on first run.

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
| DELETE | `/api/categories/:id` | — | `204` |

Every query is filtered by `user_id` in the service layer; a path
parameter is never trusted as proof of ownership.

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
    health/           /api/health (Terminus)
    common/           shared filters, decorators, validators
  test/               integration (*.int-spec.ts) and e2e (*.e2e-spec.ts) specs
libs/shared-types/    TypeScript interfaces shared between API and (future) web app
docs/                 design specs and plans
```
