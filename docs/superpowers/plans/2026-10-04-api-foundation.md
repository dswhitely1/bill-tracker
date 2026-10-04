# API Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Nx monorepo containing a NestJS API with a PostgreSQL schema, JWT authentication using rotating opaque refresh tokens, and user and category resources.

**Architecture:** A single Nx workspace holds `apps/api` (NestJS) and `libs/shared-types` (framework-free TypeScript contracts). Authentication splits into three services with separate concerns — `UsersService` owns persistence and hashing, `AuthService` owns credential verification, `TokenService` owns the token lifecycle. A globally registered guard protects every route unless explicitly marked `@Public()`. All schema change flows through TypeORM migrations; `synchronize` is never enabled.

**Tech Stack:** Nx 23.2.1, NestJS 12.1.2, TypeORM 1.1.1, PostgreSQL 17, Node 24.14.1, Vitest 5.0.3, Zod 4.6.5, oxlint 1.86.0, Prettier.

**Spec:** `docs/superpowers/specs/2026-10-04-api-foundation-design.md`

## Global Constraints

- `synchronize: false` in every environment, including development. All schema change flows through migration files.
- No secret has a fallback default. `JWT_ACCESS_SECRET` must be at least 32 characters; the application refuses to boot without it.
- Services inject the typed config object. `process.env` is never read outside `apps/api/src/config/`.
- Access tokens are JWTs, 15-minute lifetime, held in memory by clients. Refresh tokens are opaque 32-byte random values, stored only as SHA-256 hashes, 30-day lifetime, delivered in an httpOnly cookie.
- Every query in a service filters by the authenticated `user_id`. A path parameter is never accepted as proof of ownership.
- Money is `numeric(12,2)`. `due_date` is `date`. Enums are `varchar` plus a `CHECK` constraint.
- Linting is oxlint; formatting is Prettier; testing is Vitest. Never Jest, never ESLint.
- Node engine floor is 24.11.0 (TypeORM 1.1.1 requirement).
- `BillFrequency` is `ONE_TIME | WEEKLY | MONTHLY | ANNUALLY`. `BillStatus` is `UNPAID | PAID | OVERDUE`.
- Bcrypt cost is 12. Passwords are 8 characters minimum and **72 bytes** maximum.

## Review Focus

These are the failure modes the spec implies but does not assign tests to. Each line names the input and the behavior a reasonable person expects. Each has a test placed in the task that owns the code.

1. **Two concurrent refresh requests with the same cookie** must both succeed and must not log the user out. The reuse-detection rule creates this hazard; the 30-second grace window resolves it. → Task 7.
2. **A password whose character count is under the limit but whose byte length exceeds 72** (multibyte characters) must be rejected, not silently truncated by bcrypt. `MaxLength` counts characters, not bytes. → Task 6.
3. **An email differing only in case or surrounding whitespace** must resolve to the same account at both register and login, so `" Don@Example.com "` cannot create a second account. → Task 6.
4. **A field value longer than its column** must return 400 with field detail, not a 500 from PostgreSQL error `22001`. Every DTO length limit must match its column width. → Task 5.
5. **A missing, empty, or malformed refresh cookie** must return 401, not a 500 from hashing `undefined`. → Task 8.

---

## File Structure

| Path | Responsibility |
|---|---|
| `libs/shared-types/src/lib/enums.ts` | `BillFrequency`, `BillStatus` unions |
| `libs/shared-types/src/lib/auth.contracts.ts` | Register/login/refresh request and response shapes |
| `libs/shared-types/src/lib/user.contracts.ts` | Profile and update shapes |
| `libs/shared-types/src/lib/category.contracts.ts` | Category shapes |
| `apps/api/src/config/env.schema.ts` | Zod schema, `validateEnv` |
| `apps/api/src/config/config.module.ts` | `ConfigModule.forRoot` wiring |
| `apps/api/src/database/data-source.ts` | TypeORM `DataSource` for CLI and app |
| `apps/api/src/database/database.module.ts` | `TypeOrmModule.forRootAsync` |
| `apps/api/src/database/migrations/*.ts` | Schema history |
| `apps/api/src/common/filters/all-exceptions.filter.ts` | Error normalization, 23505 → 409, 22001 → 400 |
| `apps/api/src/common/decorators/public.decorator.ts` | `@Public()` |
| `apps/api/src/common/decorators/current-user.decorator.ts` | `@CurrentUser()` |
| `apps/api/src/common/validators/max-bytes.validator.ts` | `@MaxBytes(n)` |
| `apps/api/src/health/health.controller.ts` | `/api/health` with DB ping |
| `apps/api/src/users/user.entity.ts` | `users` table |
| `apps/api/src/users/users.service.ts` | Persistence, hashing, email normalization |
| `apps/api/src/users/users.controller.ts` | `/api/users/me` routes |
| `apps/api/src/auth/refresh-token.entity.ts` | `refresh_tokens` table |
| `apps/api/src/auth/token.service.ts` | Mint, rotate, revoke, reuse detection |
| `apps/api/src/auth/auth.service.ts` | Register, login orchestration |
| `apps/api/src/auth/auth.controller.ts` | `/api/auth/*` routes, cookie handling |
| `apps/api/src/auth/jwt.strategy.ts` | Passport JWT extraction |
| `apps/api/src/auth/jwt-auth.guard.ts` | Global guard honoring `@Public()` |
| `apps/api/src/categories/category.entity.ts` | `categories` table |
| `apps/api/src/categories/categories.service.ts` | Ownership-scoped CRUD |
| `apps/api/src/categories/categories.controller.ts` | `/api/categories` routes |
| `apps/api/vitest.config.ts` | Unit tests, no database |
| `apps/api/vitest.config.e2e.ts` | Integration and e2e, real database |
| `apps/api/test/setup-e2e.ts` | Migrations once, truncate helper |

---

## Task 1: Nx workspace bootstrap

**Files:**
- Create: `nx.json`, `package.json`, `tsconfig.base.json`, `.prettierrc`, `.npmrc`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces: a working `npx nx` CLI at the repository root, with `apps/` and `libs/` directories.

`create-nx-workspace` always creates its own subdirectory, so it is run in a temporary location and its contents are moved into this existing repository.

- [ ] **Step 1: Generate the workspace in a temporary directory**

```bash
cd /Users/dswhitely1/Projects/bill-organization-tracker
TMP=$(mktemp -d)
cd "$TMP"
npx --yes create-nx-workspace@23.2.1 bill-tracker \
  --preset=apps \
  --packageManager=npm \
  --nxCloud=skip \
  --skipGit \
  --interactive=false
```

Expected: `$TMP/bill-tracker/` contains `nx.json`, `package.json`, `tsconfig.base.json`.

- [ ] **Step 2: Move it into the repository, preserving the existing `.gitignore`**

```bash
cd /Users/dswhitely1/Projects/bill-organization-tracker
rsync -a --exclude='.git' --exclude='.gitignore' "$TMP/bill-tracker/" ./
cat "$TMP/bill-tracker/.gitignore" >> .gitignore
rm -rf "$TMP"
```

The existing `.gitignore` already carries the Node and JetBrains rules and must not be replaced. Nx's additions (`.nx/`, `dist`, `node_modules`) are appended.

- [ ] **Step 3: Verify the CLI works and reports the expected version**

```bash
npx nx report
```

Expected: output includes `nx : 23.2.1`. If it reports a different version, stop — the rest of the plan's generator flags assume 23.2.1.

- [ ] **Step 4: Pin the Node engine floor**

Add to `package.json`:

```json
"engines": { "node": ">=24.11.0" }
```

TypeORM 1.1.1 declares `^20.19.0 || ^22.13.0 || >=24.11.0`. Recording the floor here makes a mismatched Node version a clear install-time error rather than a confusing runtime one.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: bootstrap Nx 23 workspace"
```

---

## Task 2: shared-types library

**Files:**
- Create: `libs/shared-types/src/lib/enums.ts`, `auth.contracts.ts`, `user.contracts.ts`, `category.contracts.ts`
- Modify: `libs/shared-types/src/index.ts`
- Test: `libs/shared-types/src/lib/enums.spec.ts`

**Interfaces:**
- Consumes: Task 1's workspace.
- Produces: import path `@bill-tracker/shared-types` exporting `BillFrequency`, `BillStatus`, `BILL_FREQUENCIES`, `BILL_STATUSES`, `RegisterRequest`, `LoginRequest`, `AuthResponse`, `UserProfile`, `UpdateProfileRequest`, `ChangePasswordRequest`, `CategoryResponse`, `CreateCategoryRequest`, `UpdateCategoryRequest`.

- [ ] **Step 1: Generate the library**

```bash
npx nx g @nx/js:library shared-types \
  --directory=libs/shared-types \
  --importPath=@bill-tracker/shared-types \
  --unitTestRunner=vitest \
  --bundler=none \
  --linter=oxlint \
  --formatter=prettier \
  --no-interactive
```

This also establishes the Vitest unit-test setup used by later tasks.

- [ ] **Step 2: Write the failing test**

Create `libs/shared-types/src/lib/enums.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BILL_FREQUENCIES, BILL_STATUSES } from './enums';

describe('bill enums', () => {
  it('exposes exactly the four frequencies the schema CHECK allows', () => {
    expect(BILL_FREQUENCIES).toEqual(['ONE_TIME', 'WEEKLY', 'MONTHLY', 'ANNUALLY']);
  });

  it('exposes exactly the three statuses the schema CHECK allows', () => {
    expect(BILL_STATUSES).toEqual(['UNPAID', 'PAID', 'OVERDUE']);
  });
});
```

These values are duplicated into a database `CHECK` constraint in Task 4. The test exists so renaming a member here fails loudly instead of drifting away from the constraint.

- [ ] **Step 3: Run the test to verify it fails**

```bash
npx nx test shared-types
```

Expected: FAIL — `Cannot find module './enums'`.

- [ ] **Step 4: Write the implementation**

Create `libs/shared-types/src/lib/enums.ts`:

```ts
export const BILL_FREQUENCIES = ['ONE_TIME', 'WEEKLY', 'MONTHLY', 'ANNUALLY'] as const;
export type BillFrequency = (typeof BILL_FREQUENCIES)[number];

export const BILL_STATUSES = ['UNPAID', 'PAID', 'OVERDUE'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];
```

Create `libs/shared-types/src/lib/auth.contracts.ts`:

```ts
import type { UserProfile } from './user.contracts';

export interface RegisterRequest {
  email: string;
  name: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  user: UserProfile;
}

export interface RefreshResponse {
  accessToken: string;
}
```

Create `libs/shared-types/src/lib/user.contracts.ts`:

```ts
export interface UserProfile {
  id: string;
  email: string;
  name: string;
  notifyEmail: boolean;
  notifyInApp: boolean;
}

export interface UpdateProfileRequest {
  name?: string;
  notifyEmail?: boolean;
  notifyInApp?: boolean;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
```

Create `libs/shared-types/src/lib/category.contracts.ts`:

```ts
export interface CategoryResponse {
  id: string;
  name: string;
  color: string | null;
}

export interface CreateCategoryRequest {
  name: string;
  color?: string | null;
}

export interface UpdateCategoryRequest {
  name?: string;
  color?: string | null;
}
```

Replace `libs/shared-types/src/index.ts`:

```ts
export * from './lib/enums';
export * from './lib/auth.contracts';
export * from './lib/user.contracts';
export * from './lib/category.contracts';
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx nx test shared-types
```

Expected: PASS, 2 tests.

- [ ] **Step 6: Commit**

```bash
git add libs/shared-types tsconfig.base.json package.json
git commit -m "feat(shared-types): add bill enums and API contracts"
```

---

## Task 3: API application and typed configuration

**Files:**
- Create: `apps/api/src/config/env.schema.ts`, `apps/api/src/config/config.module.ts`, `.env.example`, `.env`
- Modify: `apps/api/src/main.ts`, `apps/api/src/app/app.module.ts`, `apps/api/vitest.config.ts`
- Test: `apps/api/src/config/env.schema.spec.ts`

**Interfaces:**
- Consumes: `@bill-tracker/shared-types` from Task 2.
- Produces: `validateEnv(raw: Record<string, unknown>): Env` and the `Env` type, whose fields are `NODE_ENV`, `PORT`, `DATABASE_URL`, `DB_SSL`, `JWT_ACCESS_SECRET`, `JWT_ACCESS_TTL`, `REFRESH_TTL_DAYS`, `BCRYPT_COST`, `WEB_ORIGIN`. Later tasks read these through `ConfigService<Env, true>`.

- [ ] **Step 1: Generate the NestJS application**

```bash
npx nx g @nx/nest:application api \
  --directory=apps/api \
  --unitTestRunner=vitest \
  --e2eTestRunner=none \
  --linter=oxlint \
  --formatter=prettier \
  --strict \
  --no-interactive
```

`--e2eTestRunner=none` is deliberate: the generator only offers `jest` for e2e, and this project uses Vitest throughout. The e2e harness is built by hand in Task 4.

- [ ] **Step 2: Install runtime dependencies**

```bash
npm install @nestjs/config@12.0.1 @nestjs/typeorm@12.0.2 @nestjs/jwt@12.0.2 \
  @nestjs/passport@12.0.0 @nestjs/terminus@12.1.0 \
  typeorm@1.1.1 pg@8.23.1 bcrypt@6.0.0 passport-jwt@4.0.1 \
  cookie-parser@1.4.7 zod@4.6.5 class-validator class-transformer reflect-metadata
npm install -D @types/bcrypt @types/passport-jwt @types/cookie-parser \
  @types/supertest supertest@7.3.1 @nestjs/testing@12.1.2 \
  unplugin-swc@2.0.0 @swc/core@1.16.13 ts-node@10.9.2
```

- [ ] **Step 3: Make Vitest emit decorator metadata**

Vitest transforms with esbuild, which does not implement `emitDecoratorMetadata`. Without this, every NestJS constructor parameter resolves to `undefined` and dependency injection fails with errors that look unrelated to the test.

Replace `apps/api/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    root: __dirname,
  },
});
```

Also confirm `apps/api/tsconfig.app.json` (or `tsconfig.json`) sets `"experimentalDecorators": true` and `"emitDecoratorMetadata": true`; add them if the generator did not.

- [ ] **Step 4: Write the failing test**

Create `apps/api/src/config/env.schema.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema';

const valid = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgres://don:super@localhost:5432/bills_test',
  DB_SSL: 'false',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  REFRESH_TTL_DAYS: '30',
  BCRYPT_COST: '12',
  WEB_ORIGIN: 'http://localhost:4200',
};

describe('validateEnv', () => {
  it('coerces numeric strings and booleans into real types', () => {
    const env = validateEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.REFRESH_TTL_DAYS).toBe(30);
    expect(env.DB_SSL).toBe(false);
  });

  it('refuses to start when JWT_ACCESS_SECRET is absent', () => {
    const { JWT_ACCESS_SECRET, ...without } = valid;
    expect(() => validateEnv(without)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses a JWT_ACCESS_SECRET shorter than 32 characters', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('names every invalid variable at once rather than failing on the first', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'nope', WEB_ORIGIN: 'nope' })).toThrow(
      /DATABASE_URL[\s\S]*WEB_ORIGIN/,
    );
  });

  it('provides no default for any secret', () => {
    const { JWT_ACCESS_SECRET, ...without } = valid;
    let message = '';
    try {
      validateEnv(without);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toMatch(/changeme|secret123|default/i);
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
npx nx test api
```

Expected: FAIL — `Cannot find module './env.schema'`.

- [ ] **Step 6: Write the implementation**

Create `apps/api/src/config/env.schema.ts`:

```ts
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  DB_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),
  WEB_ORIGIN: z.url(),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  return result.data;
}
```

Note `z.url()`, not the deprecated `z.string().url()` — Zod 4 moved these to top level.

Create `apps/api/src/config/config.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';

@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      validate: validateEnv,
      envFilePath: ['.env'],
    }),
  ],
})
export class ConfigModule {}
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
npx nx test api
```

Expected: PASS, 5 tests.

- [ ] **Step 8: Create the environment files**

Create `.env.example`:

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgres://don:super@localhost:5432/bills
DB_SSL=false
JWT_ACCESS_SECRET=replace-me-with-at-least-32-random-characters
JWT_ACCESS_TTL=15m
REFRESH_TTL_DAYS=30
BCRYPT_COST=12
WEB_ORIGIN=http://localhost:4200
```

Create a local `.env` with a real secret:

```bash
cp .env.example .env
SECRET=$(openssl rand -hex 32)
sed -i '' "s|^JWT_ACCESS_SECRET=.*|JWT_ACCESS_SECRET=$SECRET|" .env
grep -q '^\.env$' .gitignore || echo '.env' >> .gitignore
```

- [ ] **Step 9: Verify `.env` is not tracked**

```bash
git check-ignore -v .env
```

Expected: a line naming `.gitignore`. If the command exits non-zero, `.env` would be committed — fix `.gitignore` before continuing.

- [ ] **Step 10: Commit**

```bash
git add apps/api .env.example .gitignore package.json package-lock.json
git commit -m "feat(api): scaffold NestJS app with validated typed config"
```

---

## Task 4: Database, entities, first migration, and the e2e harness

**Files:**
- Create: `apps/api/src/users/user.entity.ts`, `apps/api/src/auth/refresh-token.entity.ts`, `apps/api/src/categories/category.entity.ts`, `apps/api/src/database/data-source.ts`, `apps/api/src/database/database.module.ts`, `apps/api/src/database/migrations/1759536000000-InitialSchema.ts`, `apps/api/vitest.config.e2e.ts`, `apps/api/test/global-setup.ts`, `apps/api/test/db.ts`, `.env.test`
- Modify: `package.json` (migration scripts), `apps/api/project.json` (test-e2e target), `apps/api/src/app/app.module.ts`
- Test: `apps/api/test/schema.int-spec.ts`

**Interfaces:**
- Consumes: `Env` and `validateEnv` from Task 3.
- Produces: entities `User`, `RefreshToken`, `Category` with the column names below; `AppDataSource` from `data-source.ts`; `DatabaseModule`; and the test helpers `getTestDataSource(): Promise<DataSource>` and `truncateAll(ds: DataSource): Promise<void>` from `apps/api/test/db.ts`.

Property-to-column mapping that later tasks depend on:

| Entity | Property | Column |
|---|---|---|
| `User` | `id`, `email`, `passwordHash`, `name`, `notifyEmail`, `notifyInApp`, `createdAt`, `updatedAt` | `id`, `email`, `password_hash`, `name`, `notify_email`, `notify_in_app`, `created_at`, `updated_at` |
| `RefreshToken` | `id`, `userId`, `tokenHash`, `expiresAt`, `revokedAt`, `replacedBy`, `createdAt` | `id`, `user_id`, `token_hash`, `expires_at`, `revoked_at`, `replaced_by`, `created_at` |
| `Category` | `id`, `userId`, `name`, `color`, `createdAt`, `updatedAt` | `id`, `user_id`, `name`, `color`, `created_at`, `updated_at` |

- [ ] **Step 1: Install the migration CLI dependency**

```bash
npm install -D dotenv
```

- [ ] **Step 2: Write the entities**

Create `apps/api/src/users/user.entity.ts`:

```ts
import {
  Column, CreateDateColumn, Entity, PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  email!: string;

  @Column({ name: 'password_hash', type: 'varchar', length: 60 })
  passwordHash!: string;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({ name: 'notify_email', type: 'boolean', default: true })
  notifyEmail!: boolean;

  @Column({ name: 'notify_in_app', type: 'boolean', default: true })
  notifyInApp!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
```

Create `apps/api/src/auth/refresh-token.entity.ts`:

```ts
import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('refresh_tokens')
@Index(['userId'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'token_hash', type: 'varchar', length: 64, unique: true })
  tokenHash!: string;

  @Column({ name: 'expires_at', type: 'timestamptz' })
  expiresAt!: Date;

  @Column({ name: 'revoked_at', type: 'timestamptz', nullable: true })
  revokedAt!: Date | null;

  @Column({ name: 'replaced_by', type: 'uuid', nullable: true })
  replacedBy!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

Create `apps/api/src/categories/category.entity.ts`:

```ts
import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import { User } from '../users/user.entity';

@Entity('categories')
@Index(['userId'])
export class Category {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ type: 'varchar', length: 50 })
  name!: string;

  @Column({ type: 'char', length: 7, nullable: true })
  color!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
```

- [ ] **Step 3: Write the DataSource**

Create `apps/api/src/database/data-source.ts`:

```ts
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config as loadEnv } from 'dotenv';

loadEnv({ path: process.env.ENV_FILE ?? '.env' });

export const AppDataSource = new DataSource({
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: true } : false,
  synchronize: false,
  logging: false,
  entities: [__dirname + '/../**/*.entity.{ts,js}'],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
});

export default AppDataSource;
```

This file is the only place reading `process.env` outside the config module, because the TypeORM CLI loads it directly with no Nest container available.

- [ ] **Step 4: Write the migration by hand**

Generated migrations cannot express a functional unique index, which the case-insensitive category constraint requires.

Create `apps/api/src/database/migrations/1759536000000-InitialSchema.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1759536000000 implements MigrationInterface {
  name = 'InitialSchema1759536000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "email" varchar(255) NOT NULL,
        "password_hash" varchar(60) NOT NULL,
        "name" varchar(100) NOT NULL,
        "notify_email" boolean NOT NULL DEFAULT true,
        "notify_in_app" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_users_email" UNIQUE ("email")
      )`);

    await q.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "token_hash" varchar(64) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "revoked_at" timestamptz,
        "replaced_by" uuid REFERENCES "refresh_tokens"("id") ON DELETE SET NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_refresh_tokens_token_hash" UNIQUE ("token_hash")
      )`);
    await q.query(`CREATE INDEX "IDX_refresh_tokens_user_id" ON "refresh_tokens" ("user_id")`);

    await q.query(`
      CREATE TABLE "categories" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "name" varchar(50) NOT NULL,
        "color" char(7),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    await q.query(`CREATE INDEX "IDX_categories_user_id" ON "categories" ("user_id")`);
    await q.query(`
      CREATE UNIQUE INDEX "UQ_categories_user_lower_name"
      ON "categories" ("user_id", lower("name"))`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "categories"`);
    await q.query(`DROP TABLE "refresh_tokens"`);
    await q.query(`DROP TABLE "users"`);
  }
}
```

- [ ] **Step 5: Add migration scripts**

Add to the root `package.json` `scripts`:

```json
"typeorm": "typeorm-ts-node-commonjs -d apps/api/src/database/data-source.ts",
"migration:run": "npm run typeorm -- migration:run",
"migration:revert": "npm run typeorm -- migration:revert",
"migration:show": "npm run typeorm -- migration:show"
```

- [ ] **Step 6: Run the migration against the development database**

```bash
docker compose up -d --wait
npm run migration:run
npm run migration:show
```

Expected: `migration:show` lists `[X] InitialSchema1759536000000`.

- [ ] **Step 7: Build the e2e harness**

Create `.env.test`:

```
NODE_ENV=test
PORT=3001
DATABASE_URL=postgres://don:super@localhost:5432/bills_test
DB_SSL=false
JWT_ACCESS_SECRET=test-secret-at-least-thirty-two-chars-long
JWT_ACCESS_TTL=1s
REFRESH_TTL_DAYS=30
BCRYPT_COST=10
WEB_ORIGIN=http://localhost:4200
```

`JWT_ACCESS_TTL=1s` lets the e2e journey reach a genuinely expired token without waiting or mocking the clock. `BCRYPT_COST=10` keeps the suite fast while staying a real bcrypt hash.

Create `apps/api/test/global-setup.ts`:

```ts
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { config as loadEnv } from 'dotenv';

export default async function globalSetup() {
  loadEnv({ path: '.env.test', override: true });

  const url = new URL(process.env.DATABASE_URL as string);
  const testDbName = url.pathname.slice(1);

  const adminUrl = new URL(url.toString());
  adminUrl.pathname = '/postgres';

  const admin = new DataSource({ type: 'postgres', url: adminUrl.toString() });
  await admin.initialize();
  const existing = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [testDbName]);
  if (existing.length === 0) {
    await admin.query(`CREATE DATABASE "${testDbName}"`);
  }
  await admin.destroy();

  process.env.ENV_FILE = '.env.test';
  const { AppDataSource } = await import('../src/database/data-source');
  await AppDataSource.initialize();
  await AppDataSource.runMigrations();
  await AppDataSource.destroy();
}
```

Create `apps/api/test/db.ts`:

```ts
import { DataSource } from 'typeorm';

let ds: DataSource | null = null;

export async function getTestDataSource(): Promise<DataSource> {
  if (ds?.isInitialized) return ds;
  process.env.ENV_FILE = '.env.test';
  const { AppDataSource } = await import('../src/database/data-source');
  ds = AppDataSource;
  if (!ds.isInitialized) await ds.initialize();
  return ds;
}

export async function truncateAll(dataSource: DataSource): Promise<void> {
  await dataSource.query(
    'TRUNCATE TABLE "refresh_tokens", "categories", "users" RESTART IDENTITY CASCADE',
  );
}
```

Create `apps/api/vitest.config.e2e.ts`:

```ts
import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineConfig({
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        target: 'es2022',
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    root: __dirname,
    include: ['test/**/*.int-spec.ts', 'test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/global-setup.ts'],
    hookTimeout: 30_000,
    testTimeout: 30_000,
    poolOptions: { threads: { singleThread: true } },
  },
});
```

`singleThread` is required: these tests share one database and truncate between cases, so parallel files would delete each other's rows.

Add a `test-e2e` target to `apps/api/project.json`:

```json
"test-e2e": {
  "executor": "@nx/vite:test",
  "options": { "configFile": "apps/api/vitest.config.e2e.ts" }
}
```

- [ ] **Step 8: Write the failing schema test**

Create `apps/api/test/schema.int-spec.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { getTestDataSource } from './db';

let ds: DataSource;

beforeAll(async () => { ds = await getTestDataSource(); });
afterAll(async () => { if (ds?.isInitialized) await ds.destroy(); });

const columnsOf = (table: string) =>
  ds.query(
    `SELECT column_name, data_type, character_maximum_length, is_nullable
     FROM information_schema.columns WHERE table_name = $1 ORDER BY column_name`,
    [table],
  );

describe('initial schema', () => {
  it('creates all three tables', async () => {
    const rows = await ds.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name IN ('users','refresh_tokens','categories')`,
    );
    expect(rows.map((r: { table_name: string }) => r.table_name).sort()).toEqual(
      ['categories', 'refresh_tokens', 'users'],
    );
  });

  it('sizes password_hash for a bcrypt digest', async () => {
    const cols = await columnsOf('users');
    const hash = cols.find((c: { column_name: string }) => c.column_name === 'password_hash');
    expect(hash.character_maximum_length).toBe(60);
  });

  it('sizes token_hash for a sha256 hex digest', async () => {
    const cols = await columnsOf('refresh_tokens');
    const hash = cols.find((c: { column_name: string }) => c.column_name === 'token_hash');
    expect(hash.character_maximum_length).toBe(64);
  });

  it('enforces category name uniqueness case-insensitively per user', async () => {
    const [user] = await ds.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ('schema@test.dev', 'x', 'Schema') RETURNING id`,
    );
    await ds.query(`INSERT INTO categories (user_id, name) VALUES ($1, 'Utilities')`, [user.id]);
    await expect(
      ds.query(`INSERT INTO categories (user_id, name) VALUES ($1, 'UTILITIES')`, [user.id]),
    ).rejects.toThrow();
    await ds.query(`DELETE FROM users WHERE id = $1`, [user.id]);
  });

  it('cascades category and token deletion when a user is removed', async () => {
    const [user] = await ds.query(
      `INSERT INTO users (email, password_hash, name)
       VALUES ('cascade@test.dev', 'x', 'Cascade') RETURNING id`,
    );
    await ds.query(`INSERT INTO categories (user_id, name) VALUES ($1, 'Housing')`, [user.id]);
    await ds.query(`DELETE FROM users WHERE id = $1`, [user.id]);
    const left = await ds.query(`SELECT 1 FROM categories WHERE user_id = $1`, [user.id]);
    expect(left).toHaveLength(0);
  });
});
```

- [ ] **Step 9: Run the test to verify it fails, then passes**

```bash
docker compose up -d --wait
npx nx test-e2e api
```

Expected on first run: PASS once the migration applies. If it fails with "relation does not exist", `global-setup.ts` did not run migrations — fix that before continuing, since every later task depends on this harness.

- [ ] **Step 10: Wire the DatabaseModule**

Create `apps/api/src/database/database.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { Env } from '../config/env.schema';
import { User } from '../users/user.entity';
import { RefreshToken } from '../auth/refresh-token.entity';
import { Category } from '../categories/category.entity';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        type: 'postgres' as const,
        url: config.get('DATABASE_URL', { infer: true }),
        ssl: config.get('DB_SSL', { infer: true }) ? { rejectUnauthorized: true } : false,
        entities: [User, RefreshToken, Category],
        synchronize: false,
        migrationsRun: false,
      }),
    }),
  ],
})
export class DatabaseModule {}
```

Entities are listed explicitly rather than glob-matched, so a bundled build cannot silently drop one.

- [ ] **Step 11: Commit**

```bash
git add apps/api .env.test package.json package-lock.json
git commit -m "feat(api): add entities, initial migration, and e2e test harness"
```

---

## Task 5: Common layer — errors, decorators, validation, health

**Files:**
- Create: `apps/api/src/common/filters/all-exceptions.filter.ts`, `apps/api/src/common/decorators/public.decorator.ts`, `apps/api/src/common/decorators/current-user.decorator.ts`, `apps/api/src/common/validators/max-bytes.validator.ts`, `apps/api/src/health/health.module.ts`, `apps/api/src/health/health.controller.ts`
- Modify: `apps/api/src/main.ts`, `apps/api/src/app/app.module.ts`
- Test: `apps/api/src/common/filters/all-exceptions.filter.spec.ts`, `apps/api/test/errors.int-spec.ts`

**Interfaces:**
- Consumes: `Env` from Task 3.
- Produces: `AllExceptionsFilter`, `Public()` (metadata key `isPublic`), `CurrentUser()` (returns `req.user.userId`), `MaxBytes(limit: number)`, and `GET /api/health`.

**Review Focus item 4 is implemented here:** an over-length value must produce 400, never a 500 from PostgreSQL error `22001`.

- [ ] **Step 1: Write the failing unit test**

Create `apps/api/src/common/filters/all-exceptions.filter.spec.ts`:

```ts
import { ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter';

function hostFor(path = '/api/test') {
  const json = vi.fn();
  const status = vi.fn(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url: path }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  it('maps a unique violation to 409 without leaking the constraint name', () => {
    const { host, status, json } = hostFor('/api/auth/register');
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'UQ_users_email',
      detail: 'Key (email)=(a@b.c) already exists.',
    });

    new AllExceptionsFilter().catch(pgError, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe('Resource already exists');
    expect(JSON.stringify(body)).not.toContain('UQ_users_email');
    expect(JSON.stringify(body)).not.toContain('a@b.c');
  });

  it('maps a string-too-long error to 400', () => {
    const { host, status } = hostFor();
    const pgError = Object.assign(new Error('value too long'), { code: '22001' });

    new AllExceptionsFilter().catch(pgError, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
  });

  it('preserves an explicit HttpException status and message', () => {
    const { host, status, json } = hostFor();
    new AllExceptionsFilter().catch(new HttpException('Nope', HttpStatus.FORBIDDEN), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(json.mock.calls[0][0].message).toBe('Nope');
  });

  it('never puts a stack trace in the response body', () => {
    const { host, json } = hostFor();
    new AllExceptionsFilter().catch(new Error('boom with secrets'), host);

    const body = JSON.stringify(json.mock.calls[0][0]);
    expect(body).not.toContain('boom with secrets');
    expect(body).not.toContain('at ');
  });

  it('includes path and an ISO timestamp on every response', () => {
    const { host, json } = hostFor('/api/users/me');
    new AllExceptionsFilter().catch(new Error('x'), host);

    const body = json.mock.calls[0][0];
    expect(body.path).toBe('/api/users/me');
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx nx test api
```

Expected: FAIL — `Cannot find module './all-exceptions.filter'`.

- [ ] **Step 3: Write the filter**

Create `apps/api/src/common/filters/all-exceptions.filter.ts`:

```ts
import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';

const PG_UNIQUE_VIOLATION = '23505';
const PG_STRING_TOO_LONG = '22001';
const PG_NOT_NULL_VIOLATION = '23502';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse();
    const request = http.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      message =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);
    } else {
      const code = (exception as { code?: string })?.code;
      if (code === PG_UNIQUE_VIOLATION) {
        status = HttpStatus.CONFLICT;
        message = 'Resource already exists';
      } else if (code === PG_STRING_TOO_LONG || code === PG_NOT_NULL_VIOLATION) {
        status = HttpStatus.BAD_REQUEST;
        message = 'Invalid request payload';
      }
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method ?? 'UNKNOWN'} ${request.url} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
```

The unique-violation branch returns a fixed string. Echoing the constraint detail would disclose that a given email is registered, undoing the enumeration protection Task 8 builds into login.

- [ ] **Step 4: Write the decorators and the byte validator**

Create `apps/api/src/common/decorators/public.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

Create `apps/api/src/common/decorators/current-user.decorator.ts`:

```ts
import { ExecutionContext, createParamDecorator } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string =>
    ctx.switchToHttp().getRequest().user.userId,
);
```

Create `apps/api/src/common/validators/max-bytes.validator.ts`:

```ts
import {
  ValidationArguments, ValidationOptions, registerDecorator,
} from 'class-validator';

export function MaxBytes(limit: number, options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'maxBytes',
      target: object.constructor,
      propertyName,
      constraints: [limit],
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (typeof value !== 'string') return false;
          return Buffer.byteLength(value, 'utf8') <= (args.constraints[0] as number);
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} must not exceed ${args.constraints[0]} bytes`;
        },
      },
    });
  };
}
```

- [ ] **Step 5: Write the health module**

Create `apps/api/src/health/health.controller.ts`:

```ts
import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck, HealthCheckService, TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { Public } from '../common/decorators/public.decorator';

@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  @Public()
  @Get()
  @HealthCheck()
  check() {
    return this.health.check([() => this.db.pingCheck('database', { timeout: 2000 })]);
  }
}
```

Create `apps/api/src/health/health.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HealthController } from './health.controller';

@Module({ imports: [TerminusModule], controllers: [HealthController] })
export class HealthModule {}
```

- [ ] **Step 6: Wire the global pipeline**

Replace `apps/api/src/main.ts`:

```ts
import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import cookieParser from 'cookie-parser';
import { AppModule } from './app/app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import type { Env } from './config/env.schema';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService<Env, true>);

  app.setGlobalPrefix('api');
  app.use(cookieParser());
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
  Logger.log(`API listening on http://localhost:${port}/api`);
}

void bootstrap();
```

- [ ] **Step 7: Run the unit tests to verify they pass**

```bash
npx nx test api
```

Expected: PASS, all filter tests green.

- [ ] **Step 8: Commit**

```bash
git add apps/api
git commit -m "feat(api): add exception filter, decorators, byte validator, health check"
```

---

## Task 6: UsersService — hashing, normalization, password policy

**Files:**
- Create: `apps/api/src/users/users.service.ts`, `apps/api/src/users/password.policy.ts`, `apps/api/src/users/users.module.ts`
- Test: `apps/api/src/users/password.policy.spec.ts`, `apps/api/src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: `User` entity (Task 4), `Env` (Task 3).
- Produces: `normalizeEmail(raw: string): string`; `assertPasswordPolicy(plain: string): void`; `MIN_PASSWORD_LENGTH = 8`; `MAX_PASSWORD_BYTES = 72`; and `UsersService` with `createUser(input: { email: string; name: string; password: string }, manager?: EntityManager): Promise<User>`, `findByEmail(email: string): Promise<User | null>`, `findById(id: string): Promise<User | null>`, `verifyPassword(plain: string, hash: string): Promise<boolean>`, `verifyAgainstDummyHash(plain: string): Promise<void>`, `updateProfile(id, patch): Promise<User>`, `changePassword(id, current, next): Promise<void>`.

**Review Focus items 2 and 3 are implemented here.**

- [ ] **Step 1: Write the failing password-policy test**

Create `apps/api/src/users/password.policy.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { assertPasswordPolicy, normalizeEmail } from './password.policy';

describe('assertPasswordPolicy', () => {
  it('accepts an ordinary 8-character password', () => {
    expect(() => assertPasswordPolicy('hunter22')).not.toThrow();
  });

  it('rejects a 7-character password', () => {
    expect(() => assertPasswordPolicy('hunter2')).toThrow(/8/);
  });

  it('rejects a password over 72 BYTES even when its character count is legal', () => {
    // 25 four-byte emoji = 100 bytes, but only 25 JS code points.
    const emojiPassword = '\u{1F512}'.repeat(25);
    expect(emojiPassword.length).toBeLessThan(72);
    expect(Buffer.byteLength(emojiPassword, 'utf8')).toBeGreaterThan(72);
    expect(() => assertPasswordPolicy(emojiPassword)).toThrow(/72 bytes/);
  });

  it('accepts a password of exactly 72 bytes', () => {
    expect(() => assertPasswordPolicy('a'.repeat(72))).not.toThrow();
  });

  it('rejects a password of 73 bytes', () => {
    expect(() => assertPasswordPolicy('a'.repeat(73))).toThrow(/72 bytes/);
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims so case and padding cannot create a second account', () => {
    expect(normalizeEmail('  Don@Example.COM  ')).toBe('don@example.com');
  });

  it('is idempotent', () => {
    expect(normalizeEmail(normalizeEmail(' A@B.Co '))).toBe('a@b.co');
  });
});
```

Without the byte check, bcrypt truncates silently: a 100-byte password and its first 72 bytes would authenticate the same account, and nobody would be told.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx nx test api
```

Expected: FAIL — `Cannot find module './password.policy'`.

- [ ] **Step 3: Write the policy module**

Create `apps/api/src/users/password.policy.ts`:

```ts
import { BadRequestException } from '@nestjs/common';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function assertPasswordPolicy(plain: string): void {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new BadRequestException(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
  if (Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new BadRequestException(
      `Password must not exceed ${MAX_PASSWORD_BYTES} bytes`,
    );
  }
}
```

- [ ] **Step 4: Write the failing UsersService test**

Create `apps/api/src/users/users.service.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UsersService } from './users.service';

const config = { get: (k: string) => (k === 'BCRYPT_COST' ? 10 : undefined) };

function serviceWith(repo: Partial<Record<string, unknown>>) {
  return new UsersService(repo as never, config as never);
}

describe('UsersService', () => {
  let findOne: ReturnType<typeof vi.fn>;

  beforeEach(() => { findOne = vi.fn().mockResolvedValue(null); });

  it('normalizes the email before looking a user up', async () => {
    const service = serviceWith({ findOne });
    await service.findByEmail('  Don@Example.COM ');
    expect(findOne).toHaveBeenCalledWith({ where: { email: 'don@example.com' } });
  });

  it('stores a bcrypt hash, never the plaintext password', async () => {
    const save = vi.fn(async (u: unknown) => u);
    const create = vi.fn((u: unknown) => u);
    const service = serviceWith({ findOne, save, create });

    const user = await service.createUser({
      email: 'A@B.co', name: 'Don', password: 'hunter22',
    });

    expect(user.passwordHash).not.toBe('hunter22');
    expect(user.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(user.email).toBe('a@b.co');
  });

  it('produces a hash that fits the 60-character column', async () => {
    const service = serviceWith({ findOne, save: async (u: unknown) => u, create: (u: unknown) => u });
    const user = await service.createUser({ email: 'a@b.co', name: 'D', password: 'hunter22' });
    expect(user.passwordHash).toHaveLength(60);
  });

  it('verifies a correct password and rejects a wrong one', async () => {
    const service = serviceWith({ findOne, save: async (u: unknown) => u, create: (u: unknown) => u });
    const user = await service.createUser({ email: 'a@b.co', name: 'D', password: 'hunter22' });

    await expect(service.verifyPassword('hunter22', user.passwordHash)).resolves.toBe(true);
    await expect(service.verifyPassword('wrong-one', user.passwordHash)).resolves.toBe(false);
  });

  it('rejects an over-byte password before bcrypt can truncate it', async () => {
    const save = vi.fn();
    const service = serviceWith({ findOne, save, create: (u: unknown) => u });

    await expect(
      service.createUser({ email: 'a@b.co', name: 'D', password: '\u{1F512}'.repeat(25) }),
    ).rejects.toThrow(/72 bytes/);
    expect(save).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: Run the test to verify it fails**

```bash
npx nx test api
```

Expected: FAIL — `Cannot find module './users.service'`.

- [ ] **Step 6: Write UsersService**

Create `apps/api/src/users/users.service.ts`:

```ts
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from './user.entity';
import type { Env } from '../config/env.schema';
import { assertPasswordPolicy, normalizeEmail } from './password.policy';

/** A real bcrypt hash of a value nothing can match. Used to equalize login timing. */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO3Ym6xCBOgN0Eq9dPuxjVYlWBBbLvQ6W';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private get cost(): number {
    return this.config.get('BCRYPT_COST', { infer: true });
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.findOne({ where: { email: normalizeEmail(email) } });
  }

  async findById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id } });
  }

  async createUser(
    input: { email: string; name: string; password: string },
    manager?: EntityManager,
  ): Promise<User> {
    assertPasswordPolicy(input.password);

    const user = this.users.create({
      email: normalizeEmail(input.email),
      name: input.name.trim(),
      passwordHash: await bcrypt.hash(input.password, this.cost),
    });

    return manager ? manager.save(User, user) : this.users.save(user);
  }

  async verifyPassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  /** Burns the same time a real comparison would, so a missing user is indistinguishable. */
  async verifyAgainstDummyHash(plain: string): Promise<void> {
    await bcrypt.compare(plain, DUMMY_HASH);
  }

  async updateProfile(
    id: string,
    patch: { name?: string; notifyEmail?: boolean; notifyInApp?: boolean },
  ): Promise<User> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    if (patch.name !== undefined) user.name = patch.name.trim();
    if (patch.notifyEmail !== undefined) user.notifyEmail = patch.notifyEmail;
    if (patch.notifyInApp !== undefined) user.notifyInApp = patch.notifyInApp;
    return this.users.save(user);
  }

  async changePassword(id: string, current: string, next: string): Promise<void> {
    const user = await this.findById(id);
    if (!user) throw new NotFoundException('User not found');
    if (!(await this.verifyPassword(current, user.passwordHash))) {
      throw new BadRequestException('Current password is incorrect');
    }
    assertPasswordPolicy(next);
    user.passwordHash = await bcrypt.hash(next, this.cost);
    await this.users.save(user);
  }
}
```

If the `DUMMY_HASH` constant ever fails to load as a valid bcrypt digest, replace it with the output of `node -e "console.log(require('bcrypt').hashSync('x',12))"` — its only requirement is being a well-formed hash nothing legitimately matches.

Create `apps/api/src/users/users.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User])],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
npx nx test api
```

Expected: PASS, 11 new tests.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/users
git commit -m "feat(api): add UsersService with byte-safe password policy"
```

---

## Task 7: TokenService — rotation, reuse detection, grace window

**Files:**
- Create: `apps/api/src/auth/token.service.ts`
- Test: `apps/api/test/token.int-spec.ts`

**Interfaces:**
- Consumes: `RefreshToken` and `User` entities (Task 4), `UsersService` (Task 6), `Env` (Task 3).
- Produces: `TokenService` with `issueAccessToken(user: Pick<User,'id'|'email'>): string`, `issueRefreshToken(userId: string): Promise<{ token: string; expiresAt: Date }>`, `rotate(presented: string): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date }>`, `revokeAllForUser(userId: string): Promise<void>`, `revoke(presented: string): Promise<void>`, and the exported constant `REFRESH_GRACE_MS = 30_000`.

**Review Focus item 1 is implemented here.** These tests use the real database because the rotation logic is a sequence of conditional writes; mocking the repository would test the mock.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/token.int-spec.ts`:

```ts
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { DataSource } from 'typeorm';
import { TokenService, REFRESH_GRACE_MS } from '../src/auth/token.service';
import { RefreshToken } from '../src/auth/refresh-token.entity';
import { User } from '../src/users/user.entity';
import { UsersModule } from '../src/users/users.module';
import { validateEnv } from '../src/config/env.schema';
import { getTestDataSource, truncateAll } from './db';

let ds: DataSource;
let tokens: TokenService;
let userId: string;

beforeEach(async () => {
  ds = await getTestDataSource();
  await truncateAll(ds);

  const moduleRef = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env.test'] }),
      TypeOrmModule.forRoot({
        type: 'postgres',
        url: process.env.DATABASE_URL,
        entities: [User, RefreshToken],
        synchronize: false,
      }),
      TypeOrmModule.forFeature([RefreshToken]),
      JwtModule.register({ secret: process.env.JWT_ACCESS_SECRET }),
      UsersModule,
    ],
    providers: [TokenService],
  }).compile();

  tokens = moduleRef.get(TokenService);

  const [row] = await ds.query(
    `INSERT INTO users (email, password_hash, name)
     VALUES ('tok@test.dev', '$2b$10$abcdefghijklmnopqrstuv', 'Tok') RETURNING id`,
  );
  userId = row.id;
});

afterAll(async () => { if (ds?.isInitialized) await ds.destroy(); });

describe('TokenService.rotate', () => {
  it('stores only a hash — the plaintext token never reaches the database', async () => {
    const { token } = await tokens.issueRefreshToken(userId);
    const rows = await ds.query(`SELECT token_hash FROM refresh_tokens`);
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('rotates a valid token and revokes the predecessor', async () => {
    const first = await tokens.issueRefreshToken(userId);
    const next = await tokens.rotate(first.token);

    expect(next.refreshToken).not.toBe(first.token);
    const rows = await ds.query(
      `SELECT revoked_at, replaced_by FROM refresh_tokens WHERE revoked_at IS NOT NULL`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].replaced_by).not.toBeNull();
  });

  it('rejects an unknown token without touching the user’s other sessions', async () => {
    await tokens.issueRefreshToken(userId);
    await expect(tokens.rotate('not-a-real-token')).rejects.toThrow();
    const live = await ds.query(`SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL`);
    expect(live).toHaveLength(1);
  });

  it('rejects an expired token', async () => {
    const { token } = await tokens.issueRefreshToken(userId);
    await ds.query(`UPDATE refresh_tokens SET expires_at = now() - interval '1 day'`);
    await expect(tokens.rotate(token)).rejects.toThrow();
  });

  // --- Review Focus item 1 ---
  it('lets two concurrent refreshes with the same cookie both succeed', async () => {
    const first = await tokens.issueRefreshToken(userId);

    const a = await tokens.rotate(first.token);
    const b = await tokens.rotate(first.token); // the racing second request

    expect(a.accessToken).toBeTruthy();
    expect(b.accessToken).toBeTruthy();

    const live = await ds.query(`SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL`);
    expect(live.length).toBeGreaterThan(0); // the user is NOT logged out
  });

  it('revokes the whole chain when a token is replayed after the grace window', async () => {
    const first = await tokens.issueRefreshToken(userId);
    await tokens.rotate(first.token);

    await ds.query(
      `UPDATE refresh_tokens SET revoked_at = now() - interval '${REFRESH_GRACE_MS + 60_000} milliseconds'
       WHERE revoked_at IS NOT NULL`,
    );

    await expect(tokens.rotate(first.token)).rejects.toThrow(/reuse/i);

    const live = await ds.query(`SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL`);
    expect(live).toHaveLength(0); // every session killed
  });

  it('revokes the whole chain when the successor is itself already revoked', async () => {
    const first = await tokens.issueRefreshToken(userId);
    const second = await tokens.rotate(first.token);
    await tokens.revokeAllForUser(userId);

    await expect(tokens.rotate(first.token)).rejects.toThrow();
    expect(second.refreshToken).toBeTruthy();
  });

  it('revokes every session for the user on demand', async () => {
    await tokens.issueRefreshToken(userId);
    await tokens.issueRefreshToken(userId);
    await tokens.revokeAllForUser(userId);

    const live = await ds.query(`SELECT 1 FROM refresh_tokens WHERE revoked_at IS NULL`);
    expect(live).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
docker compose up -d --wait
npx nx test-e2e api
```

Expected: FAIL — `Cannot find module '../src/auth/token.service'`.

- [ ] **Step 3: Write TokenService**

Create `apps/api/src/auth/token.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import { createHash, randomBytes } from 'node:crypto';
import { RefreshToken } from './refresh-token.entity';
import { UsersService } from '../users/users.service';
import type { User } from '../users/user.entity';
import type { Env } from '../config/env.schema';

export const REFRESH_GRACE_MS = 30_000;

@Injectable()
export class TokenService {
  constructor(
    @InjectRepository(RefreshToken) private readonly tokens: Repository<RefreshToken>,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private hash(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  issueAccessToken(user: Pick<User, 'id' | 'email'>): string {
    return this.jwt.sign(
      { sub: user.id, email: user.email },
      {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: this.config.get('JWT_ACCESS_TTL', { infer: true }),
      },
    );
  }

  async issueRefreshToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = randomBytes(32).toString('base64url');
    const days = this.config.get('REFRESH_TTL_DAYS', { infer: true });
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

    await this.tokens.save(
      this.tokens.create({
        userId,
        tokenHash: this.hash(token),
        expiresAt,
        revokedAt: null,
        replacedBy: null,
      }),
    );

    return { token, expiresAt };
  }

  async rotate(presented: string) {
    if (!presented || typeof presented !== 'string') {
      throw new UnauthorizedException('Invalid refresh token');
    }

    const row = await this.tokens.findOne({ where: { tokenHash: this.hash(presented) } });
    if (!row) throw new UnauthorizedException('Invalid refresh token');
    if (row.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    if (row.revokedAt) {
      const successor = row.replacedBy
        ? await this.tokens.findOne({ where: { id: row.replacedBy } })
        : null;
      const withinGrace = Date.now() - row.revokedAt.getTime() <= REFRESH_GRACE_MS;

      if (withinGrace && successor && !successor.revokedAt) {
        // A benign double refresh from one browser: both requests carried the same
        // cookie because neither response had landed yet. Rotate the successor and
        // let the newer Set-Cookie win in the shared cookie jar.
        return this.rotateRow(successor);
      }

      await this.revokeAllForUser(row.userId);
      throw new UnauthorizedException('Refresh token reuse detected');
    }

    return this.rotateRow(row);
  }

  private async rotateRow(row: RefreshToken) {
    const user = await this.users.findById(row.userId);
    if (!user) throw new UnauthorizedException('Invalid refresh token');

    const next = await this.issueRefreshToken(row.userId);
    const nextRow = await this.tokens.findOne({
      where: { tokenHash: this.hash(next.token) },
    });

    row.revokedAt = new Date();
    row.replacedBy = nextRow?.id ?? null;
    await this.tokens.save(row);

    return {
      accessToken: this.issueAccessToken(user),
      refreshToken: next.token,
      expiresAt: next.expiresAt,
    };
  }

  async revoke(presented: string): Promise<void> {
    if (!presented) return;
    await this.tokens.update(
      { tokenHash: this.hash(presented), revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.tokens.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx nx test-e2e api
```

Expected: PASS, 8 tests. The concurrent-refresh test is the one that matters — if it fails, the grace window is wrong and every user of the finished application will be randomly logged out.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/auth apps/api/test/token.int-spec.ts
git commit -m "feat(api): add TokenService with rotation, reuse detection, grace window"
```

---

## Task 8: Auth module — register, login, refresh, logout, global guard

**Files:**
- Create: `apps/api/src/auth/dto/register.dto.ts`, `login.dto.ts`, `apps/api/src/auth/auth.service.ts`, `auth.controller.ts`, `jwt.strategy.ts`, `jwt-auth.guard.ts`, `auth.module.ts`, `apps/api/src/categories/default-categories.ts`
- Modify: `apps/api/src/app/app.module.ts`
- Test: `apps/api/test/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `UsersService` (Task 6), `TokenService` (Task 7), `Category` entity (Task 4), `Public`/`CurrentUser` (Task 5).
- Produces: `AuthService.register(input): Promise<{ user: User; accessToken: string; refreshToken: string }>`, `AuthService.login(email, password)` with the same return shape, `JwtAuthGuard`, `REFRESH_COOKIE = 'refresh_token'`, and `DEFAULT_CATEGORIES: readonly string[]`.

**Review Focus item 5 is implemented here.**

- [ ] **Step 1: Write the failing e2e test**

Create `apps/api/test/auth.e2e-spec.ts`:

```ts
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
    await request(app.getHttpServer()).get('/api/users/me').expect(401);
  });

  it('allows the public health route', async () => {
    await request(app.getHttpServer()).get('/api/health').expect(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx nx test-e2e api
```

Expected: FAIL — auth routes do not exist.

- [ ] **Step 3: Write the DTOs**

Create `apps/api/src/auth/dto/register.dto.ts`:

```ts
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { RegisterRequest } from '@bill-tracker/shared-types';
import { MaxBytes } from '../../common/validators/max-bytes.validator';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from '../../users/password.policy';

export class RegisterDto implements RegisterRequest {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxBytes(MAX_PASSWORD_BYTES)
  password!: string;
}
```

Every `MaxLength` here matches its column width exactly — 255 for `email`, 100 for `name`. That alignment is what keeps an over-length value a 400 instead of a PostgreSQL `22001` surfacing as 500.

Create `apps/api/src/auth/dto/login.dto.ts`:

```ts
import { IsEmail, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { LoginRequest } from '@bill-tracker/shared-types';

export class LoginDto implements LoginRequest {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @IsString()
  @MaxLength(200)
  password!: string;
}
```

Login deliberately omits the minimum-length and byte rules. Applying registration policy at login would return 400 for a malformed password instead of 401, turning the login endpoint into an oracle for what passwords are possible.

- [ ] **Step 4: Write the default category list**

Create `apps/api/src/categories/default-categories.ts`:

```ts
export const DEFAULT_CATEGORIES = [
  'Utilities',
  'Subscriptions',
  'Housing',
  'Credit Cards',
] as const;
```

- [ ] **Step 5: Write AuthService**

Create `apps/api/src/auth/auth.service.ts`:

```ts
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { UsersService } from '../users/users.service';
import { TokenService } from './token.service';
import { Category } from '../categories/category.entity';
import { DEFAULT_CATEGORIES } from '../categories/default-categories';
import type { User } from '../users/user.entity';

export interface AuthResult {
  user: User;
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async register(input: { email: string; name: string; password: string }): Promise<AuthResult> {
    const user = await this.dataSource.transaction(async (manager) => {
      const created = await this.users.createUser(input, manager);
      await this.seedDefaultCategories(created.id, manager);
      return created;
    });

    return this.issueFor(user);
  }

  /** Separate method so a test can force it to fail and prove the transaction rolls back. */
  private async seedDefaultCategories(userId: string, manager: EntityManager): Promise<void> {
    await manager.save(
      Category,
      DEFAULT_CATEGORIES.map((name) => manager.create(Category, { userId, name })),
    );
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.users.findByEmail(email);

    if (!user) {
      // Burn equivalent time so a missing account is indistinguishable from a bad password.
      await this.users.verifyAgainstDummyHash(password);
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!(await this.users.verifyPassword(password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueFor(user);
  }

  private async issueFor(user: User): Promise<AuthResult> {
    const refresh = await this.tokens.issueRefreshToken(user.id);
    return {
      user,
      accessToken: this.tokens.issueAccessToken(user),
      refreshToken: refresh.token,
    };
  }
}
```

- [ ] **Step 6: Write the strategy and guard**

Create `apps/api/src/auth/jwt.strategy.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Env } from '../config/env.schema';

export interface JwtPayload { sub: string; email: string }

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<Env, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  validate(payload: JwtPayload) {
    return { userId: payload.sub, email: payload.email };
  }
}
```

Create `apps/api/src/auth/jwt-auth.guard.ts`:

```ts
import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) { super(); }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    return isPublic ? true : super.canActivate(context);
  }
}
```

- [ ] **Step 7: Write AuthController**

Create `apps/api/src/auth/auth.controller.ts`:

```ts
import {
  Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from '../common/decorators/public.decorator';
import type { Env } from '../config/env.schema';
import type { User } from '../users/user.entity';

export const REFRESH_COOKIE = 'refresh_token';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.config.get('NODE_ENV', { infer: true }) === 'production',
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: this.config.get('REFRESH_TTL_DAYS', { infer: true }) * 24 * 60 * 60 * 1000,
    });
  }

  private profileOf(user: User) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      notifyEmail: user.notifyEmail,
      notifyInApp: user.notifyInApp,
    };
  }

  @Public()
  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.register(dto);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: this.profileOf(result.user) };
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.auth.login(dto.email, dto.password);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken, user: this.profileOf(result.user) };
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const presented = req.cookies?.[REFRESH_COOKIE];
    if (typeof presented !== 'string' || presented.length === 0) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    const result = await this.tokens.rotate(presented);
    this.setRefreshCookie(res, result.refreshToken);
    return { accessToken: result.accessToken };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.tokens.revoke(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }
}
```

The explicit cookie check before `rotate` is Review Focus item 5: without it, a missing cookie reaches `createHash().update(undefined)` and throws a `TypeError`, which the filter reports as 500.

- [ ] **Step 8: Write AuthModule and wire the global guard**

Create `apps/api/src/auth/auth.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { JwtStrategy } from './jwt.strategy';
import { RefreshToken } from './refresh-token.entity';
import { UsersModule } from '../users/users.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([RefreshToken]),
    PassportModule,
    JwtModule.register({}),
    UsersModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, TokenService, JwtStrategy],
  exports: [TokenService],
})
export class AuthModule {}
```

Replace `apps/api/src/app/app.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '../config/config.module';
import { DatabaseModule } from '../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { CategoriesModule } from '../categories/categories.module';
import { HealthModule } from '../health/health.module';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    AuthModule,
    UsersModule,
    CategoriesModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: JwtAuthGuard }],
})
export class AppModule {}
```

`CategoriesModule` is imported here but created in Task 10. Create a minimal empty module now so the application compiles, and fill it in there:

```ts
// apps/api/src/categories/categories.module.ts
import { Module } from '@nestjs/common';

@Module({})
export class CategoriesModule {}
```

- [ ] **Step 9: Run the tests to verify they pass**

```bash
npx nx test-e2e api
```

Expected: PASS. The `GET /api/users/me` guard test will 404 rather than 401 until Task 9 adds the route — temporarily assert `[401, 404]` and tighten it to `401` in Task 9.

- [ ] **Step 10: Commit**

```bash
git add apps/api
git commit -m "feat(api): add auth module with register, login, refresh, logout"
```

---

## Task 9: Users controller

**Files:**
- Create: `apps/api/src/users/dto/update-profile.dto.ts`, `change-password.dto.ts`, `apps/api/src/users/users.controller.ts`
- Modify: `apps/api/src/users/users.module.ts`
- Test: `apps/api/test/users.e2e-spec.ts`

**Interfaces:**
- Consumes: `UsersService` (Task 6), `TokenService` (Task 7), `CurrentUser` (Task 5).
- Produces: `GET /api/users/me`, `PATCH /api/users/me`, `PATCH /api/users/me/password`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/users.e2e-spec.ts` using the same `beforeAll`/`beforeEach` bootstrap as `auth.e2e-spec.ts` (repeat it — do not import across spec files), then:

```ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx nx test-e2e api
```

Expected: FAIL — 404 on `/api/users/me`.

- [ ] **Step 3: Write the DTOs**

Create `apps/api/src/users/dto/update-profile.dto.ts`:

```ts
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { UpdateProfileRequest } from '@bill-tracker/shared-types';

export class UpdateProfileDto implements UpdateProfileRequest {
  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional() @IsBoolean() notifyEmail?: boolean;
  @IsOptional() @IsBoolean() notifyInApp?: boolean;
}
```

Create `apps/api/src/users/dto/change-password.dto.ts`:

```ts
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { ChangePasswordRequest } from '@bill-tracker/shared-types';
import { MaxBytes } from '../../common/validators/max-bytes.validator';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from '../password.policy';

export class ChangePasswordDto implements ChangePasswordRequest {
  @IsString() @MaxLength(200) currentPassword!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxBytes(MAX_PASSWORD_BYTES)
  newPassword!: string;
}
```

- [ ] **Step 4: Write the controller**

Create `apps/api/src/users/users.controller.ts`:

```ts
import {
  Body, Controller, Get, HttpCode, HttpStatus, NotFoundException, Patch,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { TokenService } from '../auth/token.service';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import type { User } from './user.entity';
import type { UserProfile } from '@bill-tracker/shared-types';

const toProfile = (user: User): UserProfile => ({
  id: user.id,
  email: user.email,
  name: user.name,
  notifyEmail: user.notifyEmail,
  notifyInApp: user.notifyInApp,
});

@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
  ) {}

  @Get('me')
  async me(@CurrentUser() userId: string): Promise<UserProfile> {
    const user = await this.users.findById(userId);
    if (!user) throw new NotFoundException('User not found');
    return toProfile(user);
  }

  @Patch('me')
  async update(
    @CurrentUser() userId: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<UserProfile> {
    return toProfile(await this.users.updateProfile(userId, dto));
  }

  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  async changePassword(
    @CurrentUser() userId: string,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.users.changePassword(userId, dto.currentPassword, dto.newPassword);
    await this.tokens.revokeAllForUser(userId);
  }
}
```

There is no route accepting a user id. Every handler reads `@CurrentUser()`, so one user cannot address another's record regardless of guard behavior.

- [ ] **Step 5: Register the controller**

Modify `apps/api/src/users/users.module.ts` to import `AuthModule` with `forwardRef` if a circular import appears, add `UsersController` to `controllers`, and keep `UsersService` exported.

```ts
import { Module, forwardRef } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [TypeOrmModule.forFeature([User]), forwardRef(() => AuthModule)],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
export class UsersModule {}
```

`AuthModule` imports `UsersModule` and `UsersModule` now needs `TokenService` from `AuthModule`, so both sides use `forwardRef`. Add `forwardRef(() => UsersModule)` to `AuthModule`'s imports as well.

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx nx test-e2e api
```

Expected: PASS. Now tighten the Task 8 guard assertion from `[401, 404]` to `401`.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add users controller with profile and password routes"
```

---

## Task 10: Categories module

**Files:**
- Create: `apps/api/src/categories/dto/create-category.dto.ts`, `update-category.dto.ts`, `apps/api/src/categories/categories.service.ts`, `categories.controller.ts`
- Modify: `apps/api/src/categories/categories.module.ts`
- Test: `apps/api/test/categories.e2e-spec.ts`

**Interfaces:**
- Consumes: `Category` entity (Task 4), `CurrentUser` (Task 5).
- Produces: `CategoriesService` with `findAll(userId)`, `create(userId, dto)`, `update(userId, id, dto)`, `remove(userId, id)`; routes `GET`, `POST`, `PATCH /:id`, `DELETE /:id` under `/api/categories`.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/categories.e2e-spec.ts` with the same bootstrap as the other spec files, plus a helper that registers two separate users, then:

```ts
describe('categories', () => {
  it('lists the four seeded defaults for a new user', async () => {
    const { token } = await registerAs('a@example.com');
    const res = await request(app.getHttpServer())
      .get('/api/categories').set('Authorization', `Bearer ${token}`).expect(200);
    expect(res.body).toHaveLength(4);
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
  });

  it('rejects a non-uuid id with 400 rather than a database error', async () => {
    const { token } = await registerAs('a@example.com');
    await request(app.getHttpServer())
      .delete('/api/categories/not-a-uuid').set('Authorization', `Bearer ${token}`).expect(400);
  });
});
```

Bob receives 404, not 403. Telling him the id exists but belongs to someone else would leak the existence of another user's record.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx nx test-e2e api
```

Expected: FAIL — 404 on every category route.

- [ ] **Step 3: Write the DTOs**

Create `apps/api/src/categories/dto/create-category.dto.ts`:

```ts
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { CreateCategoryRequest } from '@bill-tracker/shared-types';

export class CreateCategoryDto implements CreateCategoryRequest {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @IsOptional()
  @IsString()
  @Matches(/^#[0-9a-fA-F]{6}$/, { message: 'color must be a #rrggbb hex value' })
  color?: string | null;
}
```

Create `apps/api/src/categories/dto/update-category.dto.ts`:

```ts
import { PartialType } from '@nestjs/mapped-types';
import { CreateCategoryDto } from './create-category.dto';

export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}
```

Install `@nestjs/mapped-types` if it is not already present: `npm install @nestjs/mapped-types`.

- [ ] **Step 4: Write the service**

Create `apps/api/src/categories/categories.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './category.entity';
import type {
  CategoryResponse, CreateCategoryRequest, UpdateCategoryRequest,
} from '@bill-tracker/shared-types';

const toResponse = (c: Category): CategoryResponse => ({
  id: c.id, name: c.name, color: c.color,
});

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category) private readonly categories: Repository<Category>,
  ) {}

  async findAll(userId: string): Promise<CategoryResponse[]> {
    const rows = await this.categories.find({ where: { userId }, order: { name: 'ASC' } });
    return rows.map(toResponse);
  }

  async create(userId: string, dto: CreateCategoryRequest): Promise<CategoryResponse> {
    const saved = await this.categories.save(
      this.categories.create({ userId, name: dto.name, color: dto.color ?? null }),
    );
    return toResponse(saved);
  }

  async update(
    userId: string, id: string, dto: UpdateCategoryRequest,
  ): Promise<CategoryResponse> {
    const existing = await this.categories.findOne({ where: { id, userId } });
    if (!existing) throw new NotFoundException('Category not found');
    if (dto.name !== undefined) existing.name = dto.name;
    if (dto.color !== undefined) existing.color = dto.color ?? null;
    return toResponse(await this.categories.save(existing));
  }

  async remove(userId: string, id: string): Promise<void> {
    const result = await this.categories.delete({ id, userId });
    if (!result.affected) throw new NotFoundException('Category not found');
  }
}
```

Every method takes `userId` as its first argument and includes it in the `where` clause. Ownership is part of the query, not a separate check that could be forgotten.

- [ ] **Step 5: Write the controller and module**

Create `apps/api/src/categories/categories.controller.ts`:

```ts
import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  findAll(@CurrentUser() userId: string) {
    return this.categories.findAll(userId);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateCategoryDto) {
    return this.categories.create(userId, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    return this.categories.update(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.categories.remove(userId, id);
  }
}
```

`ParseUUIDPipe` turns a malformed id into a 400 before it reaches PostgreSQL, where it would raise error `22P02` and surface as a 500.

Replace `apps/api/src/categories/categories.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from './category.entity';
import { CategoriesService } from './categories.service';
import { CategoriesController } from './categories.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Category])],
  controllers: [CategoriesController],
  providers: [CategoriesService],
  exports: [CategoriesService],
})
export class CategoriesModule {}
```

- [ ] **Step 6: Run the tests to verify they pass**

```bash
npx nx test-e2e api
```

Expected: PASS, 7 tests.

- [ ] **Step 7: Commit**

```bash
git add apps/api
git commit -m "feat(api): add ownership-scoped categories CRUD"
```

---

## Task 11: Full token-lifecycle journey, documentation, and final verification

**Files:**
- Create: `apps/api/test/journey.e2e-spec.ts`, `README.md`
- Test: the journey spec plus a full-suite run

**Interfaces:**
- Consumes: everything built in Tasks 1 through 10.
- Produces: no new source interfaces.

- [ ] **Step 1: Write the journey test**

Create `apps/api/test/journey.e2e-spec.ts` with the same bootstrap as the other spec files, then:

```ts
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
```

- [ ] **Step 2: Run the journey test**

```bash
npx nx test-e2e api
```

Expected: PASS.

- [ ] **Step 3: Write the README**

Create `README.md` covering: prerequisites (Node ≥ 24.11, Docker), `docker compose up -d --wait`, `npm install`, `cp .env.example .env` plus generating a real `JWT_ACCESS_SECRET`, `npm run migration:run`, `npx nx serve api`, and the commands `npx nx test api` / `npx nx test-e2e api` / `npx nx lint api`. Include the endpoint table from spec section 8 and a one-paragraph explanation of the token model, since that is the part a reader will not infer from the code.

- [ ] **Step 4: Run every check**

```bash
docker compose up -d --wait
npx nx run-many -t lint test --all
npx nx test-e2e api
npx nx build api
```

Expected: all green. Record the actual test counts; do not claim completion without this output.

- [ ] **Step 5: Verify the application boots and serves**

```bash
npx nx serve api &
sleep 5
curl -s localhost:3000/api/health | head -5
curl -s -o /dev/null -w '%{http_code}\n' localhost:3000/api/users/me
kill %1
```

Expected: health returns `{"status":"ok",...}` with a `database` entry; `/api/users/me` returns `401`. The second check proves the global guard is active in the real server, not just under test.

- [ ] **Step 6: Confirm no secret was committed**

```bash
git ls-files | grep -E '^\.env$' && echo "FAIL: .env is tracked" || echo "OK: .env untracked"
git grep -nE "JWT_ACCESS_SECRET=[A-Za-z0-9]{16,}" -- ':!*.example' ':!.env.test' || echo "OK: no secret literals"
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/test/journey.e2e-spec.ts README.md
git commit -m "test(api): add full token-lifecycle journey and project README"
```

---

## Definition of Done

- `npx nx run-many -t lint test --all` passes.
- `npx nx test-e2e api` passes, including the concurrent-refresh and post-grace-replay cases.
- `npx nx build api` succeeds.
- `npm run migration:run` applies cleanly to an empty database, and `migration:revert` reverses it.
- `/api/health` reports the database as up; `/api/users/me` returns 401 without a token.
- `.env` is untracked and no secret literal appears in the repository.
