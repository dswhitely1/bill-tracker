# Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver T-3 and T-1 reminders for unpaid bills to an in-app bell and, when mail is configured, to the user's inbox as one daily digest.

**Architecture:** A `notifications` table is the system of record, holding only a pointer to the bill instance — every label is joined at read time. One `INSERT … SELECT … ON CONFLICT DO NOTHING RETURNING` statement both selects what qualifies and deduplicates it, so repeated runs are safe and `RETURNING` names exactly what is new to email. Email is one abstract `MailTransport` with a logging default and an SMTP implementation selected by configuration.

**Tech Stack:** NestJS 12, `@nestjs/schedule` 12 (already installed), TypeORM 1.1.1, PostgreSQL 17, `nodemailer` 10.0.16, Angular 22 (zoneless, standalone, signals), Angular Material 22, Vitest 4.1, Playwright, oxlint, Prettier, TypeScript ~6.0.3.

**Spec:** `docs/superpowers/specs/2026-10-07-notifications-design.md`

## Global Constraints

- `synchronize: false` in every environment. Schema changes arrive only via a migration file.
- `asOf` comes from `BillGeneratorService.today()`, never Postgres `CURRENT_DATE`. There is exactly one place the application asks what day it is.
- No `YYYY-MM-DD` string is ever passed to `new Date()` in the client. Carried forward from sub-projects 3 and 4 unchanged.
- No secret gets a fallback default. `SMTP_URL` may carry a password; its absence selects a different mode rather than supplying a value.
- `process.env` is read only inside `apps/api/src/config/`, plus the sanctioned bootstrap exceptions `apps/api/src/database/data-source.ts` and `apps/api/test/**`.
- `.env` is gitignored and must never be committed. `.env.example` documents new variables as commented-out lines.
- The access token lives in memory only — never `localStorage`, `sessionStorage`, or a client-written cookie.
- Every API statement is scoped by `user_id` from the token. A join through `bill_instances` is not a substitute for the predicate.
- `numeric` and `COUNT(*)` arrive from a raw query as strings. Every money and count figure passes through `Number(...)` before it leaves the service.
- Dates in contracts are `YYYY-MM-DD` strings. Money is a `number`.
- `NODE_ENV === 'test'` means the scheduler neither runs nor registers anything.
- Never run `docker compose down -v`, never run `git clean` in any form, and never drop or recreate a database. Do not leave a server process running.
- `apps/web/.oxlintrc.json` does **not** extend `vitest/expect-expect`'s `assertFunctionNames`, so in **web** tests `http.expectOne(...)` / `expectNone(...)` do not count as assertions — every web test needs at least one literal `expect(...)`. The API config does extend it.
- `TZ` is not part of the Nx cache key. Timezone-varied runs need `--skip-nx-cache`.

## Review Focus

Five conditions the spec implies that no task's happy path exercises, each with the test that pins it named in the owning task:

1. **A notification whose bill is paid after the reminder fired.** The spec never says. A badge counting a reminder for an already-paid bill is an unread count that means nothing. Decided here: the row stays (it is history), carries `isResolved: true`, and is excluded from `unreadCount` — so paying a bill clears its badge. Pinned in Task 8 (`excludes a resolved notification from the unread count`).
2. **`POST /api/notifications/:id/read` with a non-UUID id.** Must be a 400 from `ParseUUIDPipe`, not a 500 from Postgres rejecting the cast. Pinned in Task 8.
3. **An account with no notifications at all.** Must return `{ items: [], unreadCount: 0 }` — never `null` items or a `null` count from a `COUNT` over zero rows. Pinned in Task 8.
4. **Both kinds existing for the same instance.** `DUE_IN_3_DAYS` and `DUE_TOMORROW` are two independent rows about one bill; marking one read must not mark the other. Pinned in Task 8.
5. **`visibilitychange` firing as the tab becomes *hidden*.** The listener must fetch only when `visibilityState === 'visible'`, or every tab switch away costs a request. Pinned in Task 10.

---

## File Structure

**New — API**

| File | Responsibility |
|---|---|
| `apps/api/src/database/migrations/1759795200000-AddNotifications.ts` | the table, its constraints, its indexes |
| `apps/api/src/notifications/notification.entity.ts` | TypeORM mapping for `notifications` |
| `apps/api/src/notifications/mail/mail-transport.ts` | `MailMessage`, abstract `MailTransport` |
| `apps/api/src/notifications/mail/log-mail.transport.ts` | the default: log the rendered message |
| `apps/api/src/notifications/mail/smtp-mail.transport.ts` | nodemailer wrapper |
| `apps/api/src/notifications/mail/mail-transport.provider.ts` | factory choosing between the two |
| `apps/api/src/notifications/digest.ts` | `DigestItem`, `renderDigest` — pure |
| `apps/api/src/notifications/reminders.service.ts` | `scan()` (the statement) and `run()` (scan + deliver) |
| `apps/api/src/notifications/reminder.scheduler.ts` | startup run, then the 08:00 cron |
| `apps/api/src/notifications/notifications.service.ts` | list, mark one read, mark all read |
| `apps/api/src/notifications/notifications.controller.ts` | the three routes |
| `apps/api/src/notifications/notifications.module.ts` | wiring |

**New — shared**

| File | Responsibility |
|---|---|
| `libs/shared-types/src/lib/notification.contracts.ts` | `NOTIFICATION_KINDS`, `NotificationKind`, `NotificationItem`, `NotificationListResponse`, `MarkAllReadResponse` |

**New — web**

| File | Responsibility |
|---|---|
| `apps/web/src/app/core/api/notifications.api.ts` | the three HTTP calls |
| `apps/web/src/app/core/state/notifications.store.ts` | signal store: items, unread count, refresh triggers |
| `apps/web/src/app/notifications/notification-text.ts` | `kindLabel`, `notificationLink` — pure, shared by bell and page |
| `apps/web/src/app/notifications/notifications.component.ts` | the `/notifications` page |
| `apps/web/src/app/shell/notification-bell.component.ts` | the toolbar bell and its menu |

**New — e2e**

| File | Responsibility |
|---|---|
| `apps/web-e2e/src/support/seed.ts` | `seedNotification` — the one thing a journey cannot do through the UI |
| `apps/web-e2e/src/journey-notifications.spec.ts` | badge → bell → click-through → mark read |

**Modified**

| File | Change |
|---|---|
| `libs/shared-types/src/index.ts` | export the new contracts |
| `apps/api/src/config/env.schema.ts` | `SMTP_URL`, `MAIL_FROM`, conditional requirement |
| `apps/api/src/app/app.module.ts` | import `NotificationsModule` |
| `apps/api/test/db.ts` | add `"notifications"` to the truncate list |
| `.env.example` | document the two mail variables, commented out |
| `package.json` | add `nodemailer` |
| `apps/web/src/app/core/state/summary.store.ts` | last-seen counter refactor |
| `apps/web/src/app/core/state/instances.store.ts` | last-seen counter refactor |
| `apps/web/src/app/shell/shell.component.ts` | render the bell |
| `apps/web/src/app/app.routes.ts` | lazy `notifications` child route |
| `apps/web-e2e/src/support/flows.ts` | `daysFromToday(n)` helper |

**Task map**

| # | Task | Deliverable |
|---|---|---|
| 1 | Contracts, migration, entity | the table exists and is typed |
| 2 | Mail configuration | `SMTP_URL`/`MAIL_FROM` validated together |
| 3 | `MailTransport` and its two implementations | mail can be sent or logged |
| 4 | Digest rendering | a pure function producing the message |
| 5 | `RemindersService.scan()` | the idempotent statement |
| 6 | `RemindersService.run()` | scan plus delivery, failures isolated |
| 7 | `ReminderScheduler` | startup run and the 08:00 cron |
| 8 | `NotificationsService` + controller + module | the three routes, live |
| 9 | Store first-flush refactor | invalidation that a mutation can break |
| 10 | `NotificationsApi` + `NotificationsStore` | client state |
| 11 | `/notifications` page | the full list |
| 12 | The toolbar bell | badge, menu, click-through |
| 13 | Playwright journey | the loop proven end to end |

---

### Task 1: Contracts, migration, and entity

**Files:**
- Create: `libs/shared-types/src/lib/notification.contracts.ts`
- Create: `apps/api/src/database/migrations/1759795200000-AddNotifications.ts`
- Create: `apps/api/src/notifications/notification.entity.ts`
- Modify: `libs/shared-types/src/index.ts`
- Modify: `apps/api/test/db.ts`
- Test: `apps/api/test/schema.int-spec.ts` (append a `describe`)

**Interfaces:**
- Consumes: nothing.
- Produces: `NOTIFICATION_KINDS`, `NotificationKind`, `NotificationItem`, `NotificationListResponse`, `MarkAllReadResponse` from `@bill-tracker/shared-types`; the `Notification` entity class from `apps/api/src/notifications/notification.entity.ts`.

- [ ] **Step 1: Write the contracts**

`libs/shared-types/src/lib/notification.contracts.ts`:

```ts
export const NOTIFICATION_KINDS = ['DUE_IN_3_DAYS', 'DUE_TOMORROW'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Dates are `YYYY-MM-DD`. Money is a `number`. */
export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  isRead: boolean;
  /** ISO 8601 instant, not a calendar day. */
  createdAt: string;
  billInstanceId: string;
  billId: string;
  billName: string;
  dueDate: string;
  /** The outstanding balance now — `amount - amount_paid`, not the face amount. */
  amountDue: number;
  /**
   * The bill has since been paid in full, so the reminder no longer asks
   * for anything. Resolved notifications stay in the list as history but
   * are excluded from `unreadCount`: a badge that counts a bill you have
   * already paid is a number that means nothing.
   */
  isResolved: boolean;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  /** Unread AND unresolved, counted over the whole table, not the capped page. */
  unreadCount: number;
  /**
   * True when `items` was truncated by the server's cap, so the page can
   * say so rather than implying this is everything.
   */
  truncated: boolean;
}

export interface MarkAllReadResponse {
  updated: number;
}
```

Add to `libs/shared-types/src/index.ts`, after the `summary.contracts.js` line:

```ts
export * from './lib/notification.contracts.js';
```

- [ ] **Step 2: Write the failing schema test**

Append to `apps/api/test/schema.int-spec.ts`:

```ts
describe('notifications table', () => {
  const seedInstance = async (): Promise<{ userId: string; instanceId: string }> => {
    const [user] = await ds.query(
      `INSERT INTO "users" ("email","password_hash","name")
       VALUES ($1,$2,'U') RETURNING "id"`,
      [`n${Math.random()}@example.com`, 'x'.repeat(60)],
    );
    const [bill] = await ds.query(
      `INSERT INTO "bills" ("user_id","name","default_amount","frequency","start_date")
       VALUES ($1,'Rent',100,'MONTHLY','2026-01-01') RETURNING "id"`,
      [user.id],
    );
    const [instance] = await ds.query(
      `INSERT INTO "bill_instances" ("bill_id","user_id","due_date","amount")
       VALUES ($1,$2,'2026-06-01',100) RETURNING "id"`,
      [bill.id, user.id],
    );
    return { userId: user.id, instanceId: instance.id };
  };

  it('records a reminder at most once per instance and kind', async () => {
    const { userId, instanceId } = await seedInstance();
    await ds.query(
      `INSERT INTO "notifications" ("user_id","bill_instance_id","kind")
       VALUES ($1,$2,'DUE_IN_3_DAYS')`,
      [userId, instanceId],
    );

    // The same (instance, kind) again must be refused by the database, not
    // merely avoided by the service. This constraint is the whole
    // idempotency story for the reminder run (spec §4.3).
    await expect(
      ds.query(
        `INSERT INTO "notifications" ("user_id","bill_instance_id","kind")
         VALUES ($1,$2,'DUE_IN_3_DAYS')`,
        [userId, instanceId],
      ),
    ).rejects.toThrow(/UQ_notifications_instance_kind|duplicate key/);
  });

  it('accepts both kinds for one instance', async () => {
    const { userId, instanceId } = await seedInstance();
    await ds.query(
      `INSERT INTO "notifications" ("user_id","bill_instance_id","kind")
       VALUES ($1,$2,'DUE_IN_3_DAYS'), ($1,$2,'DUE_TOMORROW')`,
      [userId, instanceId],
    );
    const rows = await ds.query(
      `SELECT "kind" FROM "notifications" WHERE "bill_instance_id" = $1 ORDER BY "kind"`,
      [instanceId],
    );
    expect(rows.map((r: { kind: string }) => r.kind)).toEqual(['DUE_IN_3_DAYS', 'DUE_TOMORROW']);
  });

  it('refuses a kind the clients cannot render', async () => {
    const { userId, instanceId } = await seedInstance();
    await expect(
      ds.query(
        `INSERT INTO "notifications" ("user_id","bill_instance_id","kind")
         VALUES ($1,$2,'DUE_IN_99_DAYS')`,
        [userId, instanceId],
      ),
    ).rejects.toThrow(/CHK_notifications_kind|violates check constraint/);
  });

  it('removes a reminder when its instance goes away', async () => {
    const { userId, instanceId } = await seedInstance();
    await ds.query(
      `INSERT INTO "notifications" ("user_id","bill_instance_id","kind")
       VALUES ($1,$2,'DUE_TOMORROW')`,
      [userId, instanceId],
    );
    await ds.query(`DELETE FROM "bill_instances" WHERE "id" = $1`, [instanceId]);
    const rows = await ds.query(`SELECT 1 FROM "notifications" WHERE "user_id" = $1`, [userId]);
    expect(rows).toHaveLength(0);
  });

  it('stores read_at as a nullable instant and created_at as a defaulted one', async () => {
    const rows = await columnsOf('notifications');
    const byName = Object.fromEntries(
      rows.map((r: { column_name: string; data_type: string; is_nullable: string }) => [
        r.column_name,
        r,
      ]),
    );
    expect(byName['read_at'].data_type).toBe('timestamp with time zone');
    expect(byName['read_at'].is_nullable).toBe('YES');
    expect(byName['created_at'].is_nullable).toBe('NO');
  });

  it('indexes the two shapes the bell and the list query', async () => {
    const rows = await ds.query(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'notifications'`,
    );
    const names = rows.map((r: { indexname: string }) => r.indexname);
    expect(names).toContain('IDX_notifications_user_unread');
    expect(names).toContain('IDX_notifications_user_created');
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

```bash
npx nx run api:test-e2e --skip-nx-cache
```

Expected: FAIL — `relation "notifications" does not exist`.

- [ ] **Step 4: Write the migration**

`apps/api/src/database/migrations/1759795200000-AddNotifications.ts`:

```ts
import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `UQ_notifications_instance_kind` is the load-bearing constraint of the
 * whole sub-project, not an incidental tidiness. Spec §4.3 makes the
 * reminder run idempotent by writing with `ON CONFLICT DO NOTHING` against
 * exactly this constraint, which is what makes the run safe to call twice,
 * from two processes, and at every application boot (§4.5). An
 * application-level "have I already sent this?" check would race between
 * processes and would be wrong across a restart mid-run; this one cannot be.
 *
 * `CHK_notifications_kind` guards the same two values the TypeScript union
 * carries, for the reason `CHK_payment_logs_sign` gives in the previous
 * migration: a write path that skips the service — an admin script, a
 * data fix, a bulk import — must not be able to invent a third kind that
 * every client then fails to render.
 *
 * `user_id` is denormalized from `bill_instances`, matching what
 * `bill_instances` itself does. Every scoping query then filters on a
 * column of the row it is returning rather than on something two joins
 * away, and the authorization predicate cannot be lost in a join rewrite.
 */
export class AddNotifications1759795200000 implements MigrationInterface {
  name = 'AddNotifications1759795200000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "notifications" (
        "id"               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id"          uuid        NOT NULL,
        "bill_instance_id" uuid        NOT NULL,
        "kind"             varchar(20) NOT NULL,
        "read_at"          timestamptz,
        "created_at"       timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "FK_notifications_user"
          FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_notifications_instance"
          FOREIGN KEY ("bill_instance_id") REFERENCES "bill_instances"("id") ON DELETE CASCADE,
        CONSTRAINT "UQ_notifications_instance_kind"
          UNIQUE ("bill_instance_id", "kind"),
        CONSTRAINT "CHK_notifications_kind"
          CHECK ("kind" IN ('DUE_IN_3_DAYS', 'DUE_TOMORROW'))
      )`);

    // The bell's unread count, and the page's ordering. Separate indexes
    // rather than one composite: the count never orders and the list never
    // filters on read_at.
    await q.query(
      `CREATE INDEX "IDX_notifications_user_unread" ON "notifications" ("user_id", "read_at")`,
    );
    await q.query(
      `CREATE INDEX "IDX_notifications_user_created"
         ON "notifications" ("user_id", "created_at" DESC)`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    // Nothing references this table, so the whole thing goes at once; the
    // indexes and constraints fall with it.
    await q.query(`DROP TABLE "notifications"`);
  }
}
```

- [ ] **Step 5: Write the entity**

`apps/api/src/notifications/notification.entity.ts`:

```ts
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { NotificationKind } from '@bill-tracker/shared-types';

/**
 * Deliberately carries no bill name, amount, or due date. A notification
 * is a pointer; every label is joined at read time (spec §3.2), the same
 * discipline `BillScheduler` states for overdue. Rename a bill and its
 * old reminders say the new name, which is what keeps the bell from ever
 * contradicting the dashboard.
 */
@Entity('notifications')
@Index(['userId', 'readAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'bill_instance_id', type: 'uuid' })
  billInstanceId!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: NotificationKind;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
```

- [ ] **Step 6: Add the table to the truncate list**

In `apps/api/test/db.ts`, the `TRUNCATE` string becomes — note `"notifications"` goes **first**, ahead of the tables it references, which keeps the list readable as a dependency order even though `CASCADE` makes the order immaterial:

```ts
  await dataSource.query(
    'TRUNCATE TABLE "notifications", "payment_logs", "bill_instances", "bills", ' +
      '"refresh_tokens", "categories", "users" RESTART IDENTITY CASCADE',
  );
```

- [ ] **Step 7: Run the migration and the test**

```bash
npx nx run api:test-e2e --skip-nx-cache
```

Expected: PASS. The `test-e2e` target runs migrations against `bills_test` before the suite; if the new `describe` still reports a missing relation, the migration file name does not match its exported class name — TypeORM resolves migrations by the glob in `data-source.ts` and the `name` field must equal the class name exactly.

- [ ] **Step 8: Lint, typecheck, commit**

```bash
npx nx run-many -t lint typecheck -p api shared-types
git add libs/shared-types apps/api/src/database/migrations apps/api/src/notifications apps/api/test/db.ts apps/api/test/schema.int-spec.ts
git commit -m "feat(api): add the notifications table and its contracts

UQ_notifications_instance_kind is what makes the reminder run idempotent
under concurrency, across a restart mid-run, and at every boot. The
schema test asserts the database refuses a duplicate rather than
trusting the service to avoid one."
```

---

### Task 2: Mail configuration

**Files:**
- Modify: `apps/api/src/config/env.schema.ts`
- Modify: `.env.example`
- Test: `apps/api/src/config/env.schema.spec.ts`

**Interfaces:**
- Consumes: the existing `envSchema` and `validateEnv` from `apps/api/src/config/env.schema.ts`.
- Produces: `Env['SMTP_URL']` typed `string | undefined` and `Env['MAIL_FROM']` typed `string | undefined`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/src/config/env.schema.spec.ts`. The existing file already defines a `valid` fixture object at module scope — reuse it; do not redeclare it.

```ts
describe('mail configuration', () => {
  it('needs no mail configuration at all', () => {
    const env = validateEnv({ ...valid });
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.MAIL_FROM).toBeUndefined();
  });

  it('accepts a transport URL together with a sender', () => {
    const env = validateEnv({
      ...valid,
      SMTP_URL: 'smtps://user:pass@smtp.example.com:465',
      MAIL_FROM: 'bills@example.com',
    });
    expect(env.SMTP_URL).toBe('smtps://user:pass@smtp.example.com:465');
    expect(env.MAIL_FROM).toBe('bills@example.com');
  });

  it('refuses a transport URL with no sender, and says which variable is missing', () => {
    expect(() =>
      validateEnv({ ...valid, SMTP_URL: 'smtps://user:pass@smtp.example.com:465' }),
    ).toThrow(/MAIL_FROM/);
  });

  it('refuses a malformed transport URL', () => {
    expect(() =>
      validateEnv({ ...valid, SMTP_URL: 'not-a-url', MAIL_FROM: 'bills@example.com' }),
    ).toThrow(/SMTP_URL/);
  });

  it('refuses a sender that is not an email address', () => {
    expect(() =>
      validateEnv({
        ...valid,
        SMTP_URL: 'smtps://user:pass@smtp.example.com:465',
        MAIL_FROM: 'not-an-email',
      }),
    ).toThrow(/MAIL_FROM/);
  });

  it('provides no default for the transport URL, which can carry a password', () => {
    let message = '';
    try {
      validateEnv({ ...valid, SMTP_URL: 'not-a-url', MAIL_FROM: 'bills@example.com' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toMatch(/smtp:\/\/localhost|changeme|default/i);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx nx test api -- env.schema
```

Expected: FAIL — `env.SMTP_URL` is `undefined` on the accepting case too, because the key is not in the schema, and the "refuses a transport URL with no sender" case does not throw at all.

- [ ] **Step 3: Extend the schema**

In `apps/api/src/config/env.schema.ts`, add the two keys to the object and wrap it in a `superRefine`. The exported name `envSchema` stays bound to the refined schema, so `validateEnv` needs no change:

```ts
const baseEnvSchema = z.object({
  // ... every existing key, unchanged ...
  /**
   * Absent selects the logging transport (spec §5.2) — absence is a mode,
   * not a missing default. This URL can carry a password, so like every
   * other secret in this schema it gets no fallback value.
   */
  SMTP_URL: z.url().optional(),
  MAIL_FROM: z.string().email().optional(),
});

export const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  // Conditional rather than unconditionally required: an installation with
  // no mail server configured must still boot, and it must not be made to
  // invent a sender address it will never use.
  if (env.SMTP_URL !== undefined && env.MAIL_FROM === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_FROM'],
      message: 'is required when SMTP_URL is set, to name the sender of outgoing mail',
    });
  }
});
```

Rename the existing `z.object({...})` declaration to `baseEnvSchema` and leave every key inside it exactly as it is. `Env` stays `z.infer<typeof envSchema>`; a `superRefine` does not change the inferred type.

- [ ] **Step 4: Run to verify the tests pass**

```bash
npx nx test api -- env.schema
```

Expected: PASS, including the four pre-existing tests — in particular `names every invalid variable at once`, which `superRefine` must not short-circuit. `superRefine` runs after the object's own parse, so its issues are appended to any already collected.

- [ ] **Step 5: Document the variables**

Append to `.env.example`:

```
# Mail. Both are optional and must be set together. With SMTP_URL unset,
# reminders are written to the application log instead of sent — the
# default, so a fresh clone needs no mail server. SMTP_URL can carry a
# password, so it has no default value anywhere in the codebase.
# SMTP_URL=smtps://user:password@smtp.example.com:465
# MAIL_FROM=bills@example.com
```

- [ ] **Step 6: Commit**

```bash
npx nx run-many -t lint typecheck -p api
git add apps/api/src/config/env.schema.ts apps/api/src/config/env.schema.spec.ts .env.example
git commit -m "feat(api): validate SMTP_URL and MAIL_FROM together

Conditionally required rather than always: an installation with no mail
server must boot without inventing a sender it will never use. SMTP_URL
can carry a password, so it keeps the no-defaults rule every other
secret in this schema follows."
```

---

### Task 3: `MailTransport` and its two implementations

**Files:**
- Create: `apps/api/src/notifications/mail/mail-transport.ts`
- Create: `apps/api/src/notifications/mail/log-mail.transport.ts`
- Create: `apps/api/src/notifications/mail/smtp-mail.transport.ts`
- Create: `apps/api/src/notifications/mail/mail-transport.provider.ts`
- Modify: `package.json`
- Test: `apps/api/src/notifications/mail/mail-transport.provider.spec.ts`

**Interfaces:**
- Consumes: `Env` from `apps/api/src/config/env.schema.ts` (Task 2), with `SMTP_URL` and `MAIL_FROM`.
- Produces:
  - `interface MailMessage { to: string; subject: string; text: string }`
  - `abstract class MailTransport { abstract send(message: MailMessage): Promise<void> }`
  - `class LogMailTransport extends MailTransport` — constructor takes no arguments
  - `class SmtpMailTransport extends MailTransport` — `constructor(url: string, from: string)`
  - `const mailTransportProvider: Provider` — a `{ provide: MailTransport, useFactory, inject }` provider
  - `function selectMailTransport(config: ConfigService<Env, true>): MailTransport`

- [ ] **Step 1: Install nodemailer**

```bash
npm install nodemailer@10.0.16
```

Do **not** install `@types/nodemailer`. It is at 8.x, nodemailer 10 ships its own declarations (`"types": "./dist/cjs/nodemailer.d.ts"`), and the stale `@types` package would shadow the real ones.

- [ ] **Step 2: Write the abstraction**

`apps/api/src/notifications/mail/mail-transport.ts`:

```ts
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

/**
 * An abstract class rather than an interface plus an injection token:
 * Nest can use the class itself as the token, so consumers write
 * `constructor(private readonly mail: MailTransport)` with no `@Inject`.
 *
 * Plain text only. An HTML body needs a template system, an escaping
 * story, and a multipart builder, for a message that is a list of bills
 * with dates and amounts.
 */
export abstract class MailTransport {
  abstract send(message: MailMessage): Promise<void>;
}
```

- [ ] **Step 3: Write the logging transport**

`apps/api/src/notifications/mail/log-mail.transport.ts`:

```ts
import { Logger } from '@nestjs/common';
import { MailMessage, MailTransport } from './mail-transport';

/**
 * The default transport (spec §5.2). It logs the whole message — recipient,
 * subject, body — so `npm start` on a fresh clone produces working
 * reminders a developer can read in the terminal, with no credentials and
 * no network.
 */
export class LogMailTransport extends MailTransport {
  private readonly logger = new Logger(LogMailTransport.name);

  send(message: MailMessage): Promise<void> {
    this.logger.log(
      `Would send mail\n  to: ${message.to}\n  subject: ${message.subject}\n\n${message.text}`,
    );
    return Promise.resolve();
  }
}
```

- [ ] **Step 4: Write the SMTP transport**

`apps/api/src/notifications/mail/smtp-mail.transport.ts`:

```ts
import { createTransport, type Transporter } from 'nodemailer';
import { MailMessage, MailTransport } from './mail-transport';

export class SmtpMailTransport extends MailTransport {
  private readonly transporter: Transporter;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    super();
    this.transporter = createTransport(url);
  }

  async send(message: MailMessage): Promise<void> {
    // No try/catch here. A send that fails must reach the caller, which is
    // the only place that knows a failed digest costs the email and
    // nothing else (spec §4.4) — swallowing it here would make a dead
    // mail server indistinguishable from a delivered one.
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
```

- [ ] **Step 5: Write the failing selection test**

`apps/api/src/notifications/mail/mail-transport.provider.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { LogMailTransport } from './log-mail.transport';
import { SmtpMailTransport } from './smtp-mail.transport';
import { selectMailTransport } from './mail-transport.provider';

function configWith(values: Partial<Env>): ConfigService<Env, true> {
  return {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;
}

describe('selectMailTransport', () => {
  it('logs when no transport URL is configured', () => {
    const transport = selectMailTransport(configWith({}));
    expect(transport).toBeInstanceOf(LogMailTransport);
  });

  it('sends over SMTP when a transport URL is configured', () => {
    const transport = selectMailTransport(
      configWith({ SMTP_URL: 'smtp://localhost:1025', MAIL_FROM: 'bills@example.com' }),
    );
    expect(transport).toBeInstanceOf(SmtpMailTransport);
  });

  it('logs rather than throwing when a URL is present but the sender is not', () => {
    // env.schema refuses this combination at boot (Task 2), so it cannot
    // reach here through configuration. The guard exists because
    // constructing SmtpMailTransport with an undefined `from` would
    // produce mail with no sender that silently fails at the far end,
    // which is strictly worse than logging.
    const transport = selectMailTransport(configWith({ SMTP_URL: 'smtp://localhost:1025' }));
    expect(transport).toBeInstanceOf(LogMailTransport);
  });
});
```

- [ ] **Step 6: Run to verify failure**

```bash
npx nx test api -- mail-transport.provider
```

Expected: FAIL — `selectMailTransport` is not exported from a module that does not exist yet.

- [ ] **Step 7: Write the provider**

`apps/api/src/notifications/mail/mail-transport.provider.ts`:

```ts
import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { LogMailTransport } from './log-mail.transport';
import { MailTransport } from './mail-transport';
import { SmtpMailTransport } from './smtp-mail.transport';

const logger = new Logger('MailTransport');

export function selectMailTransport(config: ConfigService<Env, true>): MailTransport {
  const url = config.get('SMTP_URL', { infer: true });
  const from = config.get('MAIL_FROM', { infer: true });

  if (url === undefined || from === undefined) {
    // Logged once at startup so which transport is live is never a guess.
    logger.log('No SMTP_URL configured; reminder mail will be written to this log');
    return new LogMailTransport();
  }

  logger.log(`Sending reminder mail over SMTP as ${from}`);
  return new SmtpMailTransport(url, from);
}

export const mailTransportProvider: Provider = {
  provide: MailTransport,
  useFactory: selectMailTransport,
  inject: [ConfigService],
};
```

- [ ] **Step 8: Run to verify the tests pass**

```bash
npx nx test api -- mail-transport.provider
```

Expected: PASS, 3 tests.

- [ ] **Step 9: Commit**

```bash
npx nx run-many -t lint typecheck -p api
git add package.json package-lock.json apps/api/src/notifications/mail
git commit -m "feat(api): add a mail transport with a logging default

SMTP_URL absent selects the logging transport, so a fresh clone produces
readable reminders with no credentials and no network. nodemailer 10
ships its own types; @types/nodemailer is at 8.x and would shadow them,
so it is deliberately not a dependency."
```

---

### Task 4: Digest rendering

**Files:**
- Create: `apps/api/src/notifications/digest.ts`
- Test: `apps/api/src/notifications/digest.spec.ts`

**Interfaces:**
- Consumes: `MailMessage` from `./mail/mail-transport` (Task 3); `NotificationKind` from `@bill-tracker/shared-types` (Task 1).
- Produces:
  - `interface DigestRecipient { email: string; name: string }`
  - `interface DigestItem { kind: NotificationKind; billName: string; dueDate: string; amountDue: number }`
  - `function renderDigest(recipient: DigestRecipient, items: DigestItem[]): MailMessage | null` — null for an empty list, which Task 6 must handle

- [ ] **Step 1: Write the failing test**

`apps/api/src/notifications/digest.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DigestItem, renderDigest } from './digest';

const recipient = { email: 'don@example.com', name: 'Don' };

const rent: DigestItem = {
  kind: 'DUE_IN_3_DAYS',
  billName: 'Rent',
  dueDate: '2026-10-10',
  amountDue: 1200,
};
const power: DigestItem = {
  kind: 'DUE_TOMORROW',
  billName: 'Electric',
  dueDate: '2026-10-08',
  amountDue: 84.5,
};

describe('renderDigest', () => {
  it('addresses the recipient and names the count in the singular', () => {
    const message = renderDigest(recipient, [rent]);
    expect(message.to).toBe('don@example.com');
    expect(message.subject).toBe('1 bill due soon');
    expect(message.text).toContain('Hi Don,');
  });

  it('pluralizes the count', () => {
    expect(renderDigest(recipient, [rent, power]).subject).toBe('2 bills due soon');
  });

  it('puts the most urgent bill first, whatever order it arrives in', () => {
    // Rent is passed first but falls later. Ordering by the caller's array
    // would bury tomorrow's bill below one three days out.
    const text = renderDigest(recipient, [rent, power]).text;
    expect(text.indexOf('Electric')).toBeLessThan(text.indexOf('Rent'));
  });

  it('breaks a same-day tie by bill name, so two runs read identically', () => {
    const water: DigestItem = { ...power, billName: 'Water' };
    const cable: DigestItem = { ...power, billName: 'Cable' };
    const text = renderDigest(recipient, [water, cable]).text;
    expect(text.indexOf('Cable')).toBeLessThan(text.indexOf('Water'));
  });

  it('states each bill with its horizon in words, its date, and its balance', () => {
    const text = renderDigest(recipient, [power]);
    expect(text.text).toContain('Tomorrow (2026-10-08) — Electric — $84.50');
  });

  it('says "In 3 days" for the earlier reminder', () => {
    expect(renderDigest(recipient, [rent]).text).toContain(
      'In 3 days (2026-10-10) — Rent — $1,200.00',
    );
  });

  it('formats the balance as currency rather than a bare number', () => {
    const text = renderDigest(recipient, [{ ...rent, amountDue: 1234.5 }]).text;
    expect(text).toContain('$1,234.50');
    expect(text).not.toContain('1234.5 ');
  });

  it('shows the balance outstanding, which a partial payment has reduced', () => {
    // The caller passes `amount - amount_paid`; this asserts the renderer
    // does not re-derive or round it away.
    expect(renderDigest(recipient, [{ ...rent, amountDue: 200 }]).text).toContain('$200.00');
  });

  it('renders nothing for an empty list rather than an empty-bodied email', () => {
    // The run never calls this with an empty list, because `RETURNING`
    // decides the recipients. Returning null makes a future caller's
    // mistake visible instead of mailing a blank page.
    expect(renderDigest(recipient, [])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx nx test api -- digest
```

Expected: FAIL — cannot resolve `./digest`.

- [ ] **Step 3: Write the renderer**

`apps/api/src/notifications/digest.ts`:

```ts
import type { NotificationKind } from '@bill-tracker/shared-types';
import type { MailMessage } from './mail/mail-transport';

export interface DigestRecipient {
  email: string;
  name: string;
}

export interface DigestItem {
  kind: NotificationKind;
  billName: string;
  /** `YYYY-MM-DD`. Never parsed — only printed. */
  dueDate: string;
  /** The outstanding balance, already computed by the caller. */
  amountDue: number;
}

const HORIZON: Record<NotificationKind, string> = {
  DUE_TOMORROW: 'Tomorrow',
  DUE_IN_3_DAYS: 'In 3 days',
};

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * Pure: no database, no clock, no configuration. Everything it needs is
 * in its arguments, which is what lets `digest.spec.ts` assert the exact
 * bytes of the message.
 *
 * Returns null for an empty list. The run decides its recipients from the
 * `RETURNING` set, so it never calls this with nothing; null makes a
 * future caller's mistake visible rather than mailing a blank page.
 */
export function renderDigest(
  recipient: DigestRecipient,
  items: DigestItem[],
): MailMessage | null {
  if (items.length === 0) return null;

  // Sorted here rather than in SQL so the ordering is a property of the
  // message and is testable without a database. `localeCompare` breaks the
  // same-day tie, which keeps two runs over the same data byte-identical.
  const ordered = [...items].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.billName.localeCompare(b.billName),
  );

  const lines = ordered.map(
    (item) =>
      `  ${HORIZON[item.kind]} (${item.dueDate}) — ${item.billName} — ${MONEY.format(item.amountDue)}`,
  );

  const noun = items.length === 1 ? 'bill' : 'bills';

  return {
    to: recipient.email,
    subject: `${items.length} ${noun} due soon`,
    text: [
      `Hi ${recipient.name},`,
      '',
      `${items.length} ${noun} ${items.length === 1 ? 'is' : 'are'} coming up:`,
      '',
      ...lines,
      '',
      'Open Bill Tracker to record a payment.',
      '',
      '— Bill Tracker',
    ].join('\n'),
  };
}
```

- [ ] **Step 4: Run to verify the tests pass**

```bash
npx nx test api -- digest
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
npx nx run-many -t lint typecheck -p api
git add apps/api/src/notifications/digest.ts apps/api/src/notifications/digest.spec.ts
git commit -m "feat(api): render the reminder digest

Pure — no database, no clock, no config — so the tests assert the exact
message. Ordering by due date then name lives here rather than in SQL,
which makes it a property of the message and keeps two runs over the
same data byte-identical."
```

---

### Task 5: `RemindersService.scan()` — the idempotent statement

**Files:**
- Create: `apps/api/src/notifications/reminders.service.ts`
- Create: `apps/api/src/notifications/notifications.module.ts` (minimal; Task 8 extends it)
- Modify: `apps/api/src/app/app.module.ts`
- Test: `apps/api/test/reminders.int-spec.ts`

**Interfaces:**
- Consumes: `Notification` entity (Task 1); `BillGeneratorService` with `today(): string` from `apps/api/src/bills/bill-generator.service.ts`; `addDays(date: string, n: number): string` from `apps/api/src/bills/dates.ts`.
- Produces:
  - `interface NewNotification { id: string; userId: string }`
  - `class RemindersService` with `scan(): Promise<NewNotification[]>`

Task 6 adds `run()` to this same class. Task 5 delivers `scan()` only; do not add mail here.

- [ ] **Step 1: Write the failing integration test**

`apps/api/test/reminders.int-spec.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app/app.module';
import { BillGeneratorService } from '../src/bills/bill-generator.service';
import { RemindersService } from '../src/notifications/reminders.service';
import { addDays } from '../src/bills/dates';
import { getTestDataSource, truncateAll } from './db';

let moduleRef: TestingModule;
let reminders: RemindersService;
let generator: BillGeneratorService;
let ds: DataSource;

beforeAll(async () => {
  process.env.ENV_FILE = '.env.test';
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  reminders = moduleRef.get(RemindersService);
  generator = moduleRef.get(BillGeneratorService);
  ds = await getTestDataSource();
});

beforeEach(async () => {
  await truncateAll(ds);
});

afterAll(async () => {
  await moduleRef?.close();
  if (ds?.isInitialized) await ds.destroy();
});

interface SeedUserOptions {
  notifyEmail?: boolean;
  notifyInApp?: boolean;
  email?: string;
}

async function seedUser(options: SeedUserOptions = {}): Promise<string> {
  const [row] = await ds.query(
    `INSERT INTO "users" ("email","password_hash","name","notify_email","notify_in_app")
     VALUES ($1,$2,'Don',$3,$4) RETURNING "id"`,
    [
      options.email ?? `u${Math.random()}@example.com`,
      'x'.repeat(60),
      options.notifyEmail ?? true,
      options.notifyInApp ?? true,
    ],
  );
  return row.id as string;
}

interface SeedInstanceOptions {
  dueDate: string;
  status?: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  amount?: number;
  amountPaid?: number;
  name?: string;
}

async function seedInstance(userId: string, options: SeedInstanceOptions): Promise<string> {
  const [bill] = await ds.query(
    `INSERT INTO "bills" ("user_id","name","default_amount","frequency","start_date")
     VALUES ($1,$2,$3,'MONTHLY','2026-01-01') RETURNING "id"`,
    [userId, options.name ?? 'Rent', options.amount ?? 1200],
  );
  const [instance] = await ds.query(
    `INSERT INTO "bill_instances"
       ("bill_id","user_id","due_date","amount","amount_paid","status")
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING "id"`,
    [
      bill.id,
      userId,
      options.dueDate,
      options.amount ?? 1200,
      options.amountPaid ?? 0,
      options.status ?? 'UNPAID',
    ],
  );
  return instance.id as string;
}

const kindsFor = async (userId: string): Promise<string[]> => {
  const rows = await ds.query(
    `SELECT "kind" FROM "notifications" WHERE "user_id" = $1 ORDER BY "kind"`,
    [userId],
  );
  return rows.map((r: { kind: string }) => r.kind);
};

describe('RemindersService.scan', () => {
  it('records a reminder three days out and one day out', async () => {
    const userId = await seedUser();
    const asOf = generator.today();
    await seedInstance(userId, { dueDate: addDays(asOf, 3), name: 'Rent' });
    await seedInstance(userId, { dueDate: addDays(asOf, 1), name: 'Electric' });

    const created = await reminders.scan();

    expect(created).toHaveLength(2);
    expect(await kindsFor(userId)).toEqual(['DUE_IN_3_DAYS', 'DUE_TOMORROW']);
  });

  it('ignores every other horizon', async () => {
    const userId = await seedUser();
    const asOf = generator.today();
    // The two offsets are exact. A bill two days out is between the two
    // reminders and gets neither; four days out has not reached the first.
    for (const offset of [-1, 0, 2, 4, 7]) {
      await seedInstance(userId, { dueDate: addDays(asOf, offset) });
    }

    expect(await reminders.scan()).toHaveLength(0);
    expect(await kindsFor(userId)).toEqual([]);
  });

  it('runs twice without producing a second reminder', async () => {
    const userId = await seedUser();
    await seedInstance(userId, { dueDate: addDays(generator.today(), 3) });

    const first = await reminders.scan();
    const before = await ds.query(
      `SELECT "id","created_at","read_at" FROM "notifications" WHERE "user_id" = $1`,
      [userId],
    );

    const second = await reminders.scan();
    const after = await ds.query(
      `SELECT "id","created_at","read_at" FROM "notifications" WHERE "user_id" = $1`,
      [userId],
    );

    expect(first).toHaveLength(1);
    // The second run must report nothing new — this is what makes the
    // bootstrap run of spec §4.5 safe to perform on every restart.
    expect(second).toHaveLength(0);
    expect(after).toHaveLength(1);
    // And must not disturb the existing row: a reset created_at would
    // reorder the list, a reset read_at would resurrect a dismissed one.
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].created_at).toEqual(before[0].created_at);
    expect(after[0].read_at).toBeNull();
  });

  it('skips a bill that is already paid in full', async () => {
    const userId = await seedUser();
    await seedInstance(userId, {
      dueDate: addDays(generator.today(), 1),
      status: 'PAID',
      amountPaid: 1200,
    });

    expect(await reminders.scan()).toHaveLength(0);
  });

  it('still reminds about a bill that is only partly paid', async () => {
    const userId = await seedUser();
    await seedInstance(userId, {
      dueDate: addDays(generator.today(), 1),
      status: 'PARTIALLY_PAID',
      amountPaid: 200,
    });

    // `status <> 'PAID'`, not `status = 'UNPAID'`: a partly paid bill
    // still has a balance and still earns the reminder.
    expect(await reminders.scan()).toHaveLength(1);
  });

  it('records nothing for a user who has turned both channels off', async () => {
    const quiet = await seedUser({ notifyEmail: false, notifyInApp: false });
    await seedInstance(quiet, { dueDate: addDays(generator.today(), 1) });

    expect(await reminders.scan()).toHaveLength(0);
    expect(await kindsFor(quiet)).toEqual([]);
  });

  it('records for a user with only one channel on', async () => {
    const emailOnly = await seedUser({ notifyEmail: true, notifyInApp: false });
    const inAppOnly = await seedUser({ notifyEmail: false, notifyInApp: true });
    const asOf = addDays(generator.today(), 1);
    await seedInstance(emailOnly, { dueDate: asOf });
    await seedInstance(inAppOnly, { dueDate: asOf });

    // Within a user who wants *something*, rows are always written; each
    // channel consults its own toggle at delivery time (spec §4.3). That
    // is what keeps the dedupe ledger free of holes.
    expect(await reminders.scan()).toHaveLength(2);
    expect(await kindsFor(emailOnly)).toEqual(['DUE_TOMORROW']);
    expect(await kindsFor(inAppOnly)).toEqual(['DUE_TOMORROW']);
  });

  it('never attributes one user a reminder for another user\'s bill', async () => {
    const mine = await seedUser();
    const theirs = await seedUser();
    const due = addDays(generator.today(), 3);
    await seedInstance(mine, { dueDate: due, name: 'Mine' });
    await seedInstance(theirs, { dueDate: due, name: 'Theirs' });

    const created = await reminders.scan();

    expect(created).toHaveLength(2);
    const owners = new Set(created.map((c) => c.userId));
    expect(owners).toEqual(new Set([mine, theirs]));
    expect(await kindsFor(mine)).toEqual(['DUE_IN_3_DAYS']);
    expect(await kindsFor(theirs)).toEqual(['DUE_IN_3_DAYS']);
  });

  it('records both kinds for one instance when it crosses both horizons', async () => {
    // Not reachable in a single run — one date cannot be both +3 and +1 —
    // but reachable across two days, and the list and the mark-read
    // endpoints must treat them as two independent reminders.
    const userId = await seedUser();
    const instanceId = await seedInstance(userId, { dueDate: addDays(generator.today(), 3) });
    await reminders.scan();
    await ds.query(`UPDATE "bill_instances" SET "due_date" = $1 WHERE "id" = $2`, [
      addDays(generator.today(), 1),
      instanceId,
    ]);

    await reminders.scan();

    expect(await kindsFor(userId)).toEqual(['DUE_IN_3_DAYS', 'DUE_TOMORROW']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx nx run api:test-e2e --skip-nx-cache
```

Expected: FAIL — `Nest could not find RemindersService`.

- [ ] **Step 3: Write the service**

`apps/api/src/notifications/reminders.service.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notification } from './notification.entity';
import { BillGeneratorService } from '../bills/bill-generator.service';
import { addDays } from '../bills/dates';

/**
 * Selection and deduplication in one statement.
 *
 * `ON CONFLICT DO NOTHING` against `UQ_notifications_instance_kind` is the
 * entire idempotency story — not an application-level "have I sent this?"
 * check, which would race between two processes and would be wrong across
 * a restart mid-run. The database holds the guarantee.
 *
 * `RETURNING` therefore yields exactly the rows that are new in this run,
 * which is precisely the set to email. The decision about what is new is
 * made once, by this statement, rather than by a second selection that
 * could disagree with it.
 *
 * The `VALUES` join rather than `due_date IN (...)`: the kind has to come
 * from whichever date matched, and a bare `IN` loses that association.
 *
 * `status <> 'PAID'` rather than `= 'UNPAID'`: a partly paid bill still
 * has a balance due.
 *
 * The `users` join with `(notify_in_app OR notify_email)` means a user who
 * wants nothing generates nothing at all — no rows, no mail, no growth.
 */
const SCAN_SQL = `
  INSERT INTO "notifications" ("user_id", "bill_instance_id", "kind")
  SELECT bi."user_id", bi."id", k.kind
  FROM "bill_instances" bi
  INNER JOIN "users" u ON u."id" = bi."user_id"
  INNER JOIN (VALUES ($1::date, 'DUE_IN_3_DAYS'), ($2::date, 'DUE_TOMORROW'))
    AS k(due, kind) ON k.due = bi."due_date"
  WHERE bi."status" <> 'PAID'
    AND (u."notify_in_app" OR u."notify_email")
  ON CONFLICT ("bill_instance_id", "kind") DO NOTHING
  RETURNING "id", "user_id"
`;

interface NewNotificationRow {
  id: string;
  user_id: string;
}

export interface NewNotification {
  id: string;
  userId: string;
}

@Injectable()
export class RemindersService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
    private readonly generator: BillGeneratorService,
  ) {}

  /**
   * Writes every reminder that newly qualifies today and returns only
   * those it created. Safe to call repeatedly.
   */
  async scan(): Promise<NewNotification[]> {
    // Not CURRENT_DATE: that answers in the database session's zone, which
    // APP_TIMEZONE does not control. The same call the summary endpoint and
    // the overdue badge use, so no two parts of the application can
    // disagree about what day it is.
    const asOf = this.generator.today();

    const rows = await this.notifications.query<NewNotificationRow[]>(SCAN_SQL, [
      addDays(asOf, 3),
      addDays(asOf, 1),
    ]);

    return rows.map((row) => ({ id: row.id, userId: row.user_id }));
  }
}
```

- [ ] **Step 4: Register the service so the test can resolve it**

Create `apps/api/src/notifications/notifications.module.ts` with only what Task 5 needs; Task 8 extends it:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillsModule } from '../bills/bills.module';
import { Notification } from './notification.entity';
import { RemindersService } from './reminders.service';
import { mailTransportProvider } from './mail/mail-transport.provider';

/**
 * `BillsModule` is imported for `BillGeneratorService`, which it exports.
 * Re-providing the generator here would give the reminder run its own
 * instance and its own answer to "what day is it" — the one thing the
 * timezone rule forbids.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Notification]), BillsModule],
  providers: [RemindersService, mailTransportProvider],
  exports: [RemindersService],
})
export class NotificationsModule {}
```

Add it to `apps/api/src/app/app.module.ts`'s `imports`, after `SummaryModule`:

```ts
import { NotificationsModule } from '../notifications/notifications.module';
```

- [ ] **Step 5: Run to verify the tests pass**

```bash
npx nx run api:test-e2e --skip-nx-cache
```

Expected: PASS, 10 new tests in `reminders.int-spec.ts`, and every pre-existing suite still green.

- [ ] **Step 6: Prove the tests would catch a broken statement**

Make each change, run `npx nx run api:test-e2e --skip-nx-cache`, confirm a test **fails by assertion** (not by a compile error or an unrelated crash), then revert with `git checkout -- apps/api/src/notifications/reminders.service.ts`:

1. Delete `AND (u."notify_in_app" OR u."notify_email")` → `records nothing for a user who has turned both channels off` must fail.
2. Change `status <> 'PAID'` to `status = 'UNPAID'` → `still reminds about a bill that is only partly paid` must fail.
3. Remove `ON CONFLICT ("bill_instance_id", "kind") DO NOTHING` → `runs twice without producing a second reminder` must fail.
4. Swap `addDays(asOf, 3)` and `addDays(asOf, 1)` → `records a reminder three days out and one day out` must fail on the kind ordering.

Record each result in the task report. A change that fails to compile proves nothing about the tests; if one does, adjust it so it compiles and try again.

- [ ] **Step 7: Commit**

```bash
npx nx run-many -t lint typecheck -p api
git add apps/api/src/notifications apps/api/src/app/app.module.ts apps/api/test/reminders.int-spec.ts
git commit -m "feat(api): scan for and record due reminders

One statement selects and deduplicates: ON CONFLICT DO NOTHING against
UQ_notifications_instance_kind is the guarantee, so RETURNING names
exactly what is new and no second selection can disagree about it.

The tests were checked by breaking the statement four ways — dropping
the toggle predicate, narrowing the status test, removing ON CONFLICT,
and swapping the two offsets — and confirming each one fails."
```

---

### Task 6: `RemindersService.run()` — delivery

**Files:**
- Modify: `apps/api/src/notifications/reminders.service.ts`
- Modify: `apps/api/test/reminders.int-spec.ts`

**Interfaces:**
- Consumes: `scan(): Promise<NewNotification[]>` (Task 5); `MailTransport` and `MailMessage` (Task 3); `renderDigest(recipient, items): MailMessage | null`, `DigestItem`, `DigestRecipient` (Task 4).
- Produces: `interface RunResult { created: number; usersNotified: number; mailSent: number; mailFailed: number }` and `run(): Promise<RunResult>` on `RemindersService`.

- [ ] **Step 1: Write the failing tests**

Append to `apps/api/test/reminders.int-spec.ts`. Add `MailTransport` to the imports and install a capturing double in `beforeAll` by overriding the provider:

```ts
import { MailTransport, type MailMessage } from '../src/notifications/mail/mail-transport';
```

Replace the existing `beforeAll` with one that overrides the transport, and add a `sent` array plus a `beforeEach` reset:

```ts
const sent: MailMessage[] = [];
let failNextSends = false;

class CapturingMailTransport extends MailTransport {
  send(message: MailMessage): Promise<void> {
    if (failNextSends) return Promise.reject(new Error('smtp is down'));
    sent.push(message);
    return Promise.resolve();
  }
}

beforeAll(async () => {
  process.env.ENV_FILE = '.env.test';
  moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailTransport)
    .useClass(CapturingMailTransport)
    .compile();
  await moduleRef.init();
  reminders = moduleRef.get(RemindersService);
  generator = moduleRef.get(BillGeneratorService);
  ds = await getTestDataSource();
});

beforeEach(async () => {
  await truncateAll(ds);
  sent.length = 0;
  failNextSends = false;
});
```

Then the new `describe`:

```ts
describe('RemindersService.run', () => {
  it('sends one digest to one user covering every new reminder', async () => {
    const userId = await seedUser({ email: 'don@example.com' });
    const asOf = generator.today();
    await seedInstance(userId, { dueDate: addDays(asOf, 3), name: 'Rent', amount: 1200 });
    await seedInstance(userId, { dueDate: addDays(asOf, 1), name: 'Electric', amount: 84.5 });

    const result = await reminders.run();

    // Eight bills would still be one email; two certainly are.
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('don@example.com');
    expect(sent[0].subject).toBe('2 bills due soon');
    expect(sent[0].text).toContain('Rent');
    expect(sent[0].text).toContain('Electric');
    expect(result).toEqual({ created: 2, usersNotified: 1, mailSent: 1, mailFailed: 0 });
  });

  it('gives each user only their own bills', async () => {
    const mine = await seedUser({ email: 'mine@example.com' });
    const theirs = await seedUser({ email: 'theirs@example.com' });
    const due = addDays(generator.today(), 1);
    await seedInstance(mine, { dueDate: due, name: 'My Rent' });
    await seedInstance(theirs, { dueDate: due, name: 'Their Rent' });

    await reminders.run();

    expect(sent).toHaveLength(2);
    const mineMail = sent.find((m) => m.to === 'mine@example.com');
    const theirsMail = sent.find((m) => m.to === 'theirs@example.com');
    expect(mineMail?.text).toContain('My Rent');
    expect(mineMail?.text).not.toContain('Their Rent');
    expect(theirsMail?.text).toContain('Their Rent');
    expect(theirsMail?.text).not.toContain('My Rent');
  });

  it('records the reminder but sends no mail when email is switched off', async () => {
    const userId = await seedUser({ notifyEmail: false, notifyInApp: true });
    await seedInstance(userId, { dueDate: addDays(generator.today(), 1) });

    const result = await reminders.run();

    expect(await kindsFor(userId)).toEqual(['DUE_TOMORROW']);
    expect(sent).toHaveLength(0);
    expect(result.mailSent).toBe(0);
  });

  it('sends mail to a user who has only the email channel on', async () => {
    const userId = await seedUser({ notifyEmail: true, notifyInApp: false });
    await seedInstance(userId, { dueDate: addDays(generator.today(), 1) });

    await reminders.run();

    expect(sent).toHaveLength(1);
  });

  it('shows the outstanding balance, not the face amount', async () => {
    const userId = await seedUser();
    await seedInstance(userId, {
      dueDate: addDays(generator.today(), 1),
      status: 'PARTIALLY_PAID',
      amount: 1200,
      amountPaid: 1000,
    });

    await reminders.run();

    expect(sent[0].text).toContain('$200.00');
    expect(sent[0].text).not.toContain('$1,200.00');
  });

  it('keeps the reminders when mail fails, and resolves rather than throwing', async () => {
    const userId = await seedUser();
    await seedInstance(userId, { dueDate: addDays(generator.today(), 1) });
    failNextSends = true;

    const result = await reminders.run();

    // Mail failure costs the email and nothing else (spec §4.4). Rolling
    // back would mean a persistently broken mail server leaves the bell
    // empty too, losing both channels instead of one.
    expect(await kindsFor(userId)).toEqual(['DUE_TOMORROW']);
    expect(result).toEqual({ created: 1, usersNotified: 1, mailSent: 0, mailFailed: 1 });
  });

  it('does not let one user\'s mail failure stop another user\'s', async () => {
    const first = await seedUser({ email: 'first@example.com' });
    const second = await seedUser({ email: 'second@example.com' });
    const due = addDays(generator.today(), 1);
    await seedInstance(first, { dueDate: due });
    await seedInstance(second, { dueDate: due });

    let calls = 0;
    const transport = moduleRef.get(MailTransport);
    const original = transport.send.bind(transport);
    transport.send = (message: MailMessage): Promise<void> => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('smtp is down')) : original(message);
    };

    const result = await reminders.run();
    transport.send = original;

    expect(result.mailSent).toBe(1);
    expect(result.mailFailed).toBe(1);
    expect(sent).toHaveLength(1);
  });

  it('sends nothing at all on a second run', async () => {
    const userId = await seedUser();
    await seedInstance(userId, { dueDate: addDays(generator.today(), 1) });

    await reminders.run();
    sent.length = 0;
    const second = await reminders.run();

    // This is what makes the bootstrap run safe on every restart: nothing
    // new, so nobody is mailed twice.
    expect(sent).toHaveLength(0);
    expect(second).toEqual({ created: 0, usersNotified: 0, mailSent: 0, mailFailed: 0 });
  });

  it('does nothing and sends nothing when no bill qualifies', async () => {
    const userId = await seedUser();
    await seedInstance(userId, { dueDate: addDays(generator.today(), 5) });

    const result = await reminders.run();

    expect(result).toEqual({ created: 0, usersNotified: 0, mailSent: 0, mailFailed: 0 });
    expect(sent).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx nx run api:test-e2e --skip-nx-cache
```

Expected: FAIL — `reminders.run is not a function`.

- [ ] **Step 3: Add the digest query and `run()`**

Add to `apps/api/src/notifications/reminders.service.ts`. New imports:

```ts
import { Logger } from '@nestjs/common';
import { MailTransport } from './mail/mail-transport';
import { DigestItem, DigestRecipient, renderDigest } from './digest';
```

The query that turns the `RETURNING` ids into renderable rows:

```ts
/**
 * A projection of an already-fixed set, not a second selection. The ids
 * come from `scan()`'s `RETURNING`, so this cannot disagree with it about
 * what is new — it only looks up the labels for rows already decided.
 *
 * `notify_email` is filtered here rather than in `scan()`: the row is
 * written for anyone with either channel on, and the email channel
 * consults its own toggle at delivery time.
 *
 * `due_date` is cast to text because a `date` read through a raw query is
 * parsed into a JS `Date` by node-postgres — TypeORM's entity hydration is
 * what normally keeps these as strings, and a raw query bypasses it.
 */
const DIGEST_SQL = `
  SELECT
    n."user_id"                      AS user_id,
    u."email"                        AS email,
    u."name"                         AS name,
    n."kind"                         AS kind,
    b."name"                         AS bill_name,
    bi."due_date"::text              AS due_date,
    (bi."amount" - bi."amount_paid") AS amount_due
  FROM "notifications" n
  INNER JOIN "users" u          ON u."id"  = n."user_id"
  INNER JOIN "bill_instances" bi ON bi."id" = n."bill_instance_id"
  INNER JOIN "bills" b           ON b."id"  = bi."bill_id"
  WHERE n."id" = ANY($1::uuid[]) AND u."notify_email"
`;

interface DigestRow {
  user_id: string;
  email: string;
  name: string;
  kind: 'DUE_IN_3_DAYS' | 'DUE_TOMORROW';
  bill_name: string;
  due_date: string;
  amount_due: string;
}

export interface RunResult {
  created: number;
  usersNotified: number;
  mailSent: number;
  mailFailed: number;
}
```

Add `MailTransport` to the constructor, a logger field, and the method:

```ts
  private readonly logger = new Logger(RemindersService.name);

  // ... constructor gains:  private readonly mail: MailTransport,

  async run(): Promise<RunResult> {
    // Phase one: write the rows and commit. Phase two sends mail. The
    // order is what makes a mail failure cost the email and nothing else.
    const created = await this.scan();
    if (created.length === 0) {
      return { created: 0, usersNotified: 0, mailSent: 0, mailFailed: 0 };
    }

    const rows = await this.notifications.query<DigestRow[]>(DIGEST_SQL, [
      created.map((c) => c.id),
    ]);

    const byUser = new Map<string, { recipient: DigestRecipient; items: DigestItem[] }>();
    for (const row of rows) {
      const entry = byUser.get(row.user_id) ?? {
        recipient: { email: row.email, name: row.name },
        items: [],
      };
      entry.items.push({
        kind: row.kind,
        billName: row.bill_name,
        dueDate: row.due_date,
        // `numeric` arrives as a string on a raw query. Unconverted, the
        // currency formatter would be handed "200.00" and the digest would
        // read "$NaN".
        amountDue: Number(row.amount_due),
      });
      byUser.set(row.user_id, entry);
    }

    let mailSent = 0;
    let mailFailed = 0;

    for (const [userId, { recipient, items }] of byUser) {
      const message = renderDigest(recipient, items);
      if (message === null) continue;
      try {
        await this.mail.send(message);
        mailSent += 1;
      } catch (error: unknown) {
        // Per user, so one dead address cannot silence everyone else's
        // digest. Never retried and never rolled back (spec §4.4).
        mailFailed += 1;
        this.logger.error(`Reminder digest to user ${userId} failed`, error as Error);
      }
    }

    const result = { created: created.length, usersNotified: byUser.size, mailSent, mailFailed };
    this.logger.log(
      `Reminder run created ${result.created} notification(s); ` +
        `mail sent ${mailSent}, failed ${mailFailed}`,
    );
    return result;
  }
```

Add `MailTransport` to `NotificationsModule`'s providers — `mailTransportProvider` is already there from Task 5, so nothing changes in the module.

- [ ] **Step 4: Run to verify the tests pass**

```bash
npx nx run api:test-e2e --skip-nx-cache
```

Expected: PASS, 9 new tests, and Task 5's 10 still green.

- [ ] **Step 5: Prove the tests would catch broken delivery**

Make each change, run the suite, confirm a test fails by assertion, revert:

1. Remove `AND u."notify_email"` from `DIGEST_SQL` → `records the reminder but sends no mail when email is switched off` must fail.
2. Drop the `try`/`catch` around `this.mail.send` → `keeps the reminders when mail fails, and resolves rather than throwing` must fail (it will reject rather than resolve).
3. Remove `Number(...)` around `row.amount_due` → `shows the outstanding balance, not the face amount` must fail on a `$NaN` body.
4. Move the `scan()` call inside a transaction that also wraps the sends and rolls back on failure → `keeps the reminders when mail fails` must fail.

Record each in the report.

- [ ] **Step 6: Commit**

```bash
npx nx run-many -t lint typecheck -p api
git add apps/api/src/notifications/reminders.service.ts apps/api/test/reminders.int-spec.ts
git commit -m "feat(api): send one reminder digest per user per run

Rows commit first, then mail sends inside a per-user catch. A dead SMTP
server therefore costs the email and nothing else — rolling back would
mean a persistently broken mail server leaves the bell empty too, losing
both channels instead of one.

The digest query is a projection of scan()'s RETURNING ids, not a second
selection, so it cannot disagree about what is new."
```

---

### Task 7: `ReminderScheduler`

**Files:**
- Create: `apps/api/src/notifications/reminder.scheduler.ts`
- Modify: `apps/api/src/notifications/notifications.module.ts`
- Test: `apps/api/src/notifications/reminder.scheduler.spec.ts`
- Test: `apps/api/test/scheduler.int-spec.ts` (append one test)

**Interfaces:**
- Consumes: `RemindersService.run(): Promise<RunResult>` (Task 6); `SchedulerRegistry` from `@nestjs/schedule`; `ConfigService<Env, true>`.
- Produces: `class ReminderScheduler implements OnApplicationBootstrap`.

- [ ] **Step 1: Write the failing unit test**

`apps/api/src/notifications/reminder.scheduler.spec.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';
import { ReminderScheduler } from './reminder.scheduler';
import type { RemindersService, RunResult } from './reminders.service';

const NOTHING: RunResult = { created: 0, usersNotified: 0, mailSent: 0, mailFailed: 0 };

function configWith(values: Partial<Env>): ConfigService<Env, true> {
  return { get: (key: keyof Env) => values[key] } as unknown as ConfigService<Env, true>;
}

let registry: SchedulerRegistry;
let run: ReturnType<typeof vi.fn>;
let reminders: RemindersService;

beforeEach(() => {
  registry = new SchedulerRegistry();
  run = vi.fn().mockResolvedValue(NOTHING);
  reminders = { run } as unknown as RemindersService;
});

const build = (env: Partial<Env>): ReminderScheduler =>
  new ReminderScheduler(reminders, configWith(env), registry);

describe('ReminderScheduler under NODE_ENV=test', () => {
  it('neither runs nor schedules, so no spec races a background write', async () => {
    await build({ NODE_ENV: 'test', APP_TIMEZONE: 'UTC' }).onApplicationBootstrap();

    expect(run).not.toHaveBeenCalled();
    expect(registry.getCronJobs().size).toBe(0);
  });
});

describe('ReminderScheduler in a real environment', () => {
  it('runs once at bootstrap, so a server that was down at 08:00 still delivers', async () => {
    await build({ NODE_ENV: 'development', APP_TIMEZONE: 'UTC' }).onApplicationBootstrap();

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('schedules the daily job in the configured zone, not the host zone', async () => {
    await build({
      NODE_ENV: 'development',
      APP_TIMEZONE: 'America/New_York',
    }).onApplicationBootstrap();

    const job = registry.getCronJob('bill-reminders');
    expect(job).toBeDefined();
    // The decorator form fixes timeZone at class-definition time, which is
    // why this is registered imperatively — the same reason BillScheduler
    // gives. Asserting the zone is what keeps that from regressing to
    // a @Cron decorator.
    expect(String(job.cronTime.timeZone)).toBe('America/New_York');
  });

  it('still schedules the job when the bootstrap run throws', async () => {
    run.mockRejectedValueOnce(new Error('database is not up yet'));

    await build({ NODE_ENV: 'development', APP_TIMEZONE: 'UTC' }).onApplicationBootstrap();

    // A boot-time hiccup must not leave the process running all day with
    // no reminder job scheduled — a silent failure rather than a loud one.
    expect(registry.getCronJobs().size).toBe(1);
  });

  it('does not reject when the bootstrap run throws', async () => {
    run.mockRejectedValueOnce(new Error('database is not up yet'));

    await expect(
      build({ NODE_ENV: 'development', APP_TIMEZONE: 'UTC' }).onApplicationBootstrap(),
    ).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx nx test api -- reminder.scheduler
```

Expected: FAIL — cannot resolve `./reminder.scheduler`.

- [ ] **Step 3: Write the scheduler**

`apps/api/src/notifications/reminder.scheduler.ts`:

```ts
import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { RemindersService } from './reminders.service';
import type { Env } from '../config/env.schema';

const JOB_NAME = 'bill-reminders';

/**
 * 08:00 in APP_TIMEZONE, after BillScheduler's 03:00 horizon roll, so any
 * instance materialized overnight is visible on the same day. The ordering
 * is defensive rather than load-bearing: BillsService already materializes
 * synchronously when a bill is created.
 *
 * Registered imperatively rather than with `@Cron`, because the decorator's
 * `timeZone` is fixed at class-definition time and this one comes from
 * configuration — the same reason BillScheduler gives.
 *
 * There is also one run at bootstrap, which is safe only because
 * UQ_notifications_instance_kind makes the run idempotent: a server that
 * already ran today and restarts writes nothing and mails nobody, while a
 * server that was down through 08:00 delivers that day's reminders on the
 * way up. That is the only path by which they get sent at all.
 */
@Injectable()
export class ReminderScheduler implements OnApplicationBootstrap {
  private readonly logger = new Logger(ReminderScheduler.name);

  constructor(
    private readonly reminders: RemindersService,
    private readonly config: ConfigService<Env, true>,
    private readonly registry: SchedulerRegistry,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Under test neither the run nor the cron happens: the run would race
    // each spec's truncate, and a cron firing mid-suite would make every
    // other test intermittent.
    if (this.config.get('NODE_ENV', { infer: true }) === 'test') return;

    // Before the registration and unable to prevent it. BillScheduler
    // leaves its startup sweep unwrapped, which is defensible there — an
    // unmaterialized horizon means the application is serving wrong data.
    // Here a boot-time hiccup must not leave the process up all day with
    // no reminder job scheduled, which fails silently instead of loudly.
    await this.runOnce('Bootstrap');

    const timeZone = this.config.get('APP_TIMEZONE', { infer: true });
    const job = new CronJob(
      '0 8 * * *',
      () => {
        void this.runOnce('Daily');
      },
      null,
      false,
      timeZone,
    );
    this.registry.addCronJob(JOB_NAME, job);
    job.start();
    this.logger.log(`Daily reminder run scheduled for 08:00 ${timeZone}`);
  }

  private async runOnce(label: string): Promise<void> {
    try {
      const result = await this.reminders.run();
      this.logger.log(
        `${label} reminder run created ${result.created} notification(s), ` +
          `mailed ${result.mailSent} user(s)`,
      );
    } catch (error: unknown) {
      // A throw out of a cron callback is an unhandled rejection that can
      // take the process down; the reminders can wait until tomorrow.
      this.logger.error(`${label} reminder run failed`, error as Error);
    }
  }
}
```

- [ ] **Step 4: Register it**

Add `ReminderScheduler` to `NotificationsModule`'s `providers` array. It is not exported — nothing injects it.

- [ ] **Step 5: Append the integration assertion**

In `apps/api/test/scheduler.int-spec.ts`, the existing test `registers no cron jobs, so no spec races a background write` already covers the whole registry, so it now also covers this scheduler. Add one test to that same `describe` proving the reminder job is the thing being suppressed rather than merely absent:

```ts
  it('provides the reminder scheduler even though it schedules nothing here', async () => {
    // If NotificationsModule were simply missing from AppModule, the
    // registry would also be empty — and the test above would pass for
    // the wrong reason.
    const { ReminderScheduler } = await import('../src/notifications/reminder.scheduler');
    expect(moduleRef.get(ReminderScheduler)).toBeInstanceOf(ReminderScheduler);
  });
```

- [ ] **Step 6: Run both suites**

```bash
npx nx test api -- reminder.scheduler
npx nx run api:test-e2e --skip-nx-cache
```

Expected: PASS, 5 unit tests and the scheduler integration suite green.

- [ ] **Step 7: Prove the tests would catch a broken schedule**

Make each change, run `npx nx test api -- reminder.scheduler`, confirm failure by assertion, revert:

1. Change `'0 8 * * *'` to `'0 3 * * *'` → no test fails. **This is expected**: nothing asserts the hour. Add this test to `reminder.scheduler.spec.ts` before moving on, then re-check:

```ts
  it('fires at 08:00, after the horizon roll rather than before it', async () => {
    await build({ NODE_ENV: 'development', APP_TIMEZONE: 'UTC' }).onApplicationBootstrap();

    // Earlier than BillScheduler's 03:00 roll would mean reminders that
    // miss an instance the roll was about to materialize.
    expect(registry.getCronJob('bill-reminders').cronTime.source).toBe('0 8 * * *');
  });
```

2. Remove the `timeZone` argument from the `CronJob` constructor → `schedules the daily job in the configured zone` must fail.
3. Move `await this.runOnce('Bootstrap')` to after `job.start()` → no test fails, and that is acceptable: the ordering is not load-bearing. Note it in the report rather than adding a test that pins an incidental detail.
4. Delete the `NODE_ENV === 'test'` guard → `neither runs nor schedules` must fail.

- [ ] **Step 8: Commit**

```bash
npx nx run-many -t lint typecheck -p api
git add apps/api/src/notifications apps/api/test/scheduler.int-spec.ts
git commit -m "feat(api): run reminders at boot and daily at 08:00

The bootstrap run is safe only because the run is idempotent: a restart
after today's run writes nothing and mails nobody, while a server that
was down through 08:00 delivers on the way up. A failing bootstrap run
cannot prevent the cron from being registered — that would fail silently
instead of loudly."
```

---

### Task 8: `NotificationsService`, controller, and routes

**Files:**
- Create: `apps/api/src/notifications/notifications.service.ts`
- Create: `apps/api/src/notifications/notifications.controller.ts`
- Modify: `apps/api/src/notifications/notifications.module.ts`
- Test: `apps/api/test/notifications.e2e-spec.ts`

**Interfaces:**
- Consumes: `Notification` entity (Task 1); `NotificationItem`, `NotificationListResponse`, `MarkAllReadResponse` (Task 1); `CurrentUser` from `apps/api/src/common/decorators/current-user.decorator.ts`.
- Produces:
  - `const LIST_CAP = 200`
  - `class NotificationsService` with `list(userId): Promise<NotificationListResponse>`, `markRead(userId, id): Promise<void>`, `markAllRead(userId): Promise<MarkAllReadResponse>`
  - routes `GET /api/notifications`, `POST /api/notifications/:id/read`, `POST /api/notifications/read-all`

- [ ] **Step 1: Write the failing e2e tests**

`apps/api/test/notifications.e2e-spec.ts`:

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

async function registerAs(email: string): Promise<{ token: string; userId: string }> {
  const res = await request(app.getHttpServer())
    .post('/api/auth/register')
    .send({ email, name: 'Test User', password: 'hunter22' })
    .expect(201);
  return { token: res.body.accessToken as string, userId: res.body.user.id as string };
}

interface SeedOptions {
  kind?: 'DUE_IN_3_DAYS' | 'DUE_TOMORROW';
  dueDate?: string;
  amount?: number;
  amountPaid?: number;
  status?: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  billName?: string;
  readAt?: string | null;
}

/**
 * Inserts one notification and the bill it points at. Deliberately not a
 * call to RemindersService: this suite is about the read endpoints, and
 * driving them through the scan would couple it to today's date.
 */
async function seedNotification(
  userId: string,
  options: SeedOptions = {},
): Promise<{ id: string; billId: string; instanceId: string }> {
  const [bill] = await ds.query(
    `INSERT INTO "bills" ("user_id","name","default_amount","frequency","start_date")
     VALUES ($1,$2,$3,'MONTHLY','2026-01-01') RETURNING "id"`,
    [userId, options.billName ?? 'Rent', options.amount ?? 1200],
  );
  const [instance] = await ds.query(
    `INSERT INTO "bill_instances"
       ("bill_id","user_id","due_date","amount","amount_paid","status")
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING "id"`,
    [
      bill.id,
      userId,
      options.dueDate ?? '2026-11-01',
      options.amount ?? 1200,
      options.amountPaid ?? 0,
      options.status ?? 'UNPAID',
    ],
  );
  const [notification] = await ds.query(
    `INSERT INTO "notifications" ("user_id","bill_instance_id","kind","read_at")
     VALUES ($1,$2,$3,$4) RETURNING "id"`,
    [userId, instance.id, options.kind ?? 'DUE_IN_3_DAYS', options.readAt ?? null],
  );
  return { id: notification.id as string, billId: bill.id as string, instanceId: instance.id as string };
}

const list = (token: string) =>
  request(app.getHttpServer()).get('/api/notifications').set('Authorization', `Bearer ${token}`);

describe('GET /api/notifications', () => {
  it('refuses an unauthenticated request', async () => {
    await request(app.getHttpServer()).get('/api/notifications').expect(401);
  });

  it('returns an empty list and a zero count for a new account', async () => {
    const { token } = await registerAs('a@example.com');

    const res = await list(token).expect(200);

    // Never null items and never a null count: COUNT over zero rows
    // returns NULL from a bare aggregate, and the client does arithmetic
    // on this number.
    expect(res.body).toEqual({ items: [], unreadCount: 0, truncated: false });
  });

  it('joins the bill name, due date, and outstanding balance', async () => {
    const { token, userId } = await registerAs('a@example.com');
    await seedNotification(userId, {
      billName: 'Electric',
      dueDate: '2026-11-05',
      amount: 120,
      amountPaid: 20,
      status: 'PARTIALLY_PAID',
      kind: 'DUE_TOMORROW',
    });

    const res = await list(token).expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      kind: 'DUE_TOMORROW',
      isRead: false,
      billName: 'Electric',
      dueDate: '2026-11-05',
      amountDue: 100,
      isResolved: false,
    });
    // A number, not the string node-postgres returns for `numeric`.
    expect(typeof res.body.items[0].amountDue).toBe('number');
    expect(res.body.unreadCount).toBe(1);
  });

  it('keeps a due date a calendar day rather than an instant', async () => {
    const { token, userId } = await registerAs('a@example.com');
    await seedNotification(userId, { dueDate: '2026-11-05' });

    const res = await list(token).expect(200);

    expect(res.body.items[0].dueDate).toBe('2026-11-05');
  });

  it('returns only the caller\'s notifications', async () => {
    const mine = await registerAs('mine@example.com');
    const theirs = await registerAs('theirs@example.com');
    await seedNotification(mine.userId, { billName: 'Mine' });
    await seedNotification(theirs.userId, { billName: 'Theirs' });
    await seedNotification(theirs.userId, { billName: 'Theirs Two' });

    const res = await list(mine.token).expect(200);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].billName).toBe('Mine');
    expect(res.body.unreadCount).toBe(1);
  });

  it('counts unread over the whole table, not the returned page', async () => {
    const { token, userId } = await registerAs('a@example.com');
    for (let i = 0; i < 205; i += 1) {
      await seedNotification(userId, { billName: `Bill ${i}` });
    }

    const res = await list(token).expect(200);

    expect(res.body.items).toHaveLength(200);
    expect(res.body.unreadCount).toBe(205);
    expect(res.body.truncated).toBe(true);
  });

  it('does not claim truncation at exactly the cap', async () => {
    const { token, userId } = await registerAs('a@example.com');
    for (let i = 0; i < 200; i += 1) {
      await seedNotification(userId, { billName: `Bill ${i}` });
    }

    const res = await list(token).expect(200);

    expect(res.body.items).toHaveLength(200);
    expect(res.body.truncated).toBe(false);
  });

  it('excludes a resolved notification from the unread count', async () => {
    const { token, userId } = await registerAs('a@example.com');
    await seedNotification(userId, { billName: 'Paid Rent', status: 'PAID', amountPaid: 1200 });
    await seedNotification(userId, { billName: 'Unpaid Power' });

    const res = await list(token).expect(200);

    // The paid reminder stays in the list as history, but a badge that
    // counts a bill you have already paid is a number that means nothing.
    expect(res.body.items).toHaveLength(2);
    expect(res.body.unreadCount).toBe(1);
    const resolved = res.body.items.find(
      (i: { billName: string }) => i.billName === 'Paid Rent',
    );
    expect(resolved.isResolved).toBe(true);
    expect(resolved.amountDue).toBe(0);
  });

  it('orders newest first', async () => {
    const { token, userId } = await registerAs('a@example.com');
    const first = await seedNotification(userId, { billName: 'Older' });
    await ds.query(
      `UPDATE "notifications" SET "created_at" = now() - interval '1 day' WHERE "id" = $1`,
      [first.id],
    );
    await seedNotification(userId, { billName: 'Newer' });

    const res = await list(token).expect(200);

    expect(res.body.items.map((i: { billName: string }) => i.billName)).toEqual([
      'Newer',
      'Older',
    ]);
  });
});

describe('POST /api/notifications/:id/read', () => {
  const markRead = (token: string, id: string) =>
    request(app.getHttpServer())
      .post(`/api/notifications/${id}/read`)
      .set('Authorization', `Bearer ${token}`);

  it('refuses an unauthenticated request', async () => {
    const { userId } = await registerAs('a@example.com');
    const { id } = await seedNotification(userId);
    await request(app.getHttpServer()).post(`/api/notifications/${id}/read`).expect(401);
  });

  it('marks one read and drops the unread count', async () => {
    const { token, userId } = await registerAs('a@example.com');
    const { id } = await seedNotification(userId);

    await markRead(token, id).expect(200);

    const res = await list(token).expect(200);
    expect(res.body.items[0].isRead).toBe(true);
    expect(res.body.unreadCount).toBe(0);
  });

  it('is idempotent and keeps the first read instant', async () => {
    const { token, userId } = await registerAs('a@example.com');
    const { id } = await seedNotification(userId);

    await markRead(token, id).expect(200);
    const [before] = await ds.query(`SELECT "read_at" FROM "notifications" WHERE "id" = $1`, [id]);
    await markRead(token, id).expect(200);
    const [after] = await ds.query(`SELECT "read_at" FROM "notifications" WHERE "id" = $1`, [id]);

    expect(after.read_at).toEqual(before.read_at);
  });

  it('does not touch the other kind for the same bill', async () => {
    const { token, userId } = await registerAs('a@example.com');
    const seeded = await seedNotification(userId, { kind: 'DUE_IN_3_DAYS' });
    const [other] = await ds.query(
      `INSERT INTO "notifications" ("user_id","bill_instance_id","kind")
       VALUES ($1,$2,'DUE_TOMORROW') RETURNING "id"`,
      [userId, seeded.instanceId],
    );

    await markRead(token, seeded.id).expect(200);

    const res = await list(token).expect(200);
    const stillUnread = res.body.items.find((i: { id: string }) => i.id === other.id);
    expect(stillUnread.isRead).toBe(false);
    expect(res.body.unreadCount).toBe(1);
  });

  it('is a 404 for another user\'s notification, and leaves it unread', async () => {
    const mine = await registerAs('mine@example.com');
    const theirs = await registerAs('theirs@example.com');
    const { id } = await seedNotification(theirs.userId);

    await markRead(mine.token, id).expect(404);

    const [row] = await ds.query(`SELECT "read_at" FROM "notifications" WHERE "id" = $1`, [id]);
    expect(row.read_at).toBeNull();
  });

  it('is a 404 for an id that does not exist', async () => {
    const { token } = await registerAs('a@example.com');
    await markRead(token, '00000000-0000-4000-8000-000000000000').expect(404);
  });

  it('is a 400 for an id that is not a UUID', async () => {
    const { token } = await registerAs('a@example.com');
    // ParseUUIDPipe, not Postgres rejecting the cast with a 500.
    await markRead(token, 'not-a-uuid').expect(400);
  });
});

describe('POST /api/notifications/read-all', () => {
  const readAll = (token: string) =>
    request(app.getHttpServer())
      .post('/api/notifications/read-all')
      .set('Authorization', `Bearer ${token}`);

  it('refuses an unauthenticated request', async () => {
    await request(app.getHttpServer()).post('/api/notifications/read-all').expect(401);
  });

  it('clears every unread notification and reports how many', async () => {
    const { token, userId } = await registerAs('a@example.com');
    await seedNotification(userId, { billName: 'One' });
    await seedNotification(userId, { billName: 'Two' });
    const read = await seedNotification(userId, { billName: 'Three' });
    await ds.query(`UPDATE "notifications" SET "read_at" = now() WHERE "id" = $1`, [read.id]);

    const res = await readAll(token).expect(200);

    // Two, not three: the already-read one is not updated again.
    expect(res.body).toEqual({ updated: 2 });
    expect((await list(token).expect(200)).body.unreadCount).toBe(0);
  });

  it('affects no other user', async () => {
    const mine = await registerAs('mine@example.com');
    const theirs = await registerAs('theirs@example.com');
    await seedNotification(mine.userId);
    await seedNotification(theirs.userId);

    await readAll(mine.token).expect(200);

    expect((await list(theirs.token).expect(200)).body.unreadCount).toBe(1);
  });

  it('reports zero for an account with nothing unread', async () => {
    const { token } = await registerAs('a@example.com');
    const res = await readAll(token).expect(200);
    expect(res.body).toEqual({ updated: 0 });
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx nx run api:test-e2e --skip-nx-cache
```

Expected: FAIL — every request 404s, the routes do not exist.

- [ ] **Step 3: Write the service**

`apps/api/src/notifications/notifications.service.ts`:

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type {
  MarkAllReadResponse,
  NotificationItem,
  NotificationKind,
  NotificationListResponse,
} from '@bill-tracker/shared-types';
import { Notification } from './notification.entity';

/**
 * A deliberate departure from "nothing is paginated". The instance list is
 * bounded by a 400-day range; this table grows for as long as the account
 * exists — roughly two rows per bill per month, forever. The cap bounds
 * every response without introducing pagination UI, and the response says
 * when it bit.
 */
export const LIST_CAP = 200;

/**
 * Every label is joined, never stored: a notification is a pointer (spec
 * §3.2). Rename a bill and its old reminders say the new name, which is
 * what keeps the bell from contradicting the dashboard.
 *
 * `due_date` and `created_at` are cast to text because a raw query skips
 * TypeORM's entity hydration, and node-postgres would otherwise parse the
 * `date` into a JS `Date` in the host's zone.
 *
 * The `LIMIT` takes one more row than the cap, so the service can tell
 * "exactly at the cap" from "truncated" without a second COUNT.
 */
const LIST_SQL = `
  SELECT
    n."id"                           AS id,
    n."kind"                         AS kind,
    (n."read_at" IS NOT NULL)        AS is_read,
    n."created_at"                   AS created_at,
    bi."id"                          AS bill_instance_id,
    b."id"                           AS bill_id,
    b."name"                         AS bill_name,
    bi."due_date"::text              AS due_date,
    (bi."amount" - bi."amount_paid") AS amount_due,
    (bi."status" = 'PAID')           AS is_resolved
  FROM "notifications" n
  INNER JOIN "bill_instances" bi ON bi."id" = n."bill_instance_id"
  INNER JOIN "bills" b           ON b."id"  = bi."bill_id"
  WHERE n."user_id" = $1
  ORDER BY n."created_at" DESC, n."id" DESC
  LIMIT $2
`;

/**
 * Unread *and* unresolved. A badge that counts a bill the user has already
 * paid is a number that means nothing, and the reminder's whole purpose is
 * discharged by the payment.
 *
 * COUNT(*) over zero rows is 0, not NULL — only bare aggregates like SUM
 * return NULL there — so no COALESCE is needed.
 */
const UNREAD_SQL = `
  SELECT COUNT(*) AS unread
  FROM "notifications" n
  INNER JOIN "bill_instances" bi ON bi."id" = n."bill_instance_id"
  WHERE n."user_id" = $1 AND n."read_at" IS NULL AND bi."status" <> 'PAID'
`;

interface ListRow {
  id: string;
  kind: NotificationKind;
  is_read: boolean;
  created_at: Date;
  bill_instance_id: string;
  bill_id: string;
  bill_name: string;
  due_date: string;
  amount_due: string;
  is_resolved: boolean;
}

function toItem(row: ListRow): NotificationItem {
  return {
    id: row.id,
    kind: row.kind,
    isRead: row.is_read,
    createdAt: row.created_at.toISOString(),
    billInstanceId: row.bill_instance_id,
    billId: row.bill_id,
    billName: row.bill_name,
    dueDate: row.due_date,
    // `numeric` arrives as a string on a raw query. Unconverted, the
    // client's arithmetic becomes string concatenation.
    amountDue: Number(row.amount_due),
    isResolved: row.is_resolved,
  };
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectRepository(Notification)
    private readonly notifications: Repository<Notification>,
  ) {}

  async list(userId: string): Promise<NotificationListResponse> {
    const rows = await this.notifications.query<ListRow[]>(LIST_SQL, [userId, LIST_CAP + 1]);
    const [{ unread }] = await this.notifications.query<[{ unread: string }]>(UNREAD_SQL, [
      userId,
    ]);

    return {
      items: rows.slice(0, LIST_CAP).map(toItem),
      // `COUNT(*)` is a bigint, which node-postgres returns as a string.
      unreadCount: Number(unread),
      truncated: rows.length > LIST_CAP,
    };
  }

  async markRead(userId: string, id: string): Promise<void> {
    // `read_at IS NULL` in the predicate rather than an unconditional SET:
    // a second call must not move the instant the user first dismissed it.
    // The scoping predicate on `user_id` is what makes another user's id a
    // 404 rather than a silent cross-tenant write.
    const result = await this.notifications.update(
      { id, userId, readAt: null },
      { readAt: new Date() },
    );

    if (result.affected === 0) {
      // Zero rows means either "not yours / does not exist" or "already
      // read". Distinguish them, because the second is a success.
      const exists = await this.notifications.exists({ where: { id, userId } });
      if (!exists) {
        // The same 404 for someone else's row as for one that does not
        // exist: a different status would disclose that it exists.
        throw new NotFoundException('Notification not found');
      }
    }
  }

  async markAllRead(userId: string): Promise<MarkAllReadResponse> {
    const result = await this.notifications.update(
      { userId, readAt: null },
      { readAt: new Date() },
    );
    return { updated: result.affected ?? 0 };
  }
}
```

- [ ] **Step 4: Write the controller**

`apps/api/src/notifications/notifications.controller.ts`:

```ts
import {
  Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post,
} from '@nestjs/common';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() userId: string) {
    return this.notifications.list(userId);
  }

  /**
   * `read-all` is declared before `:id/read` only for readability — the
   * two patterns cannot collide, since one has a second segment. Marking
   * read is also the dismiss action: there is no DELETE, because removing
   * the row would remove what UQ_notifications_instance_kind relies on and
   * the next run would recreate the reminder.
   */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  markAllRead(@CurrentUser() userId: string) {
    return this.notifications.markAllRead(userId);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    await this.notifications.markRead(userId, id);
  }
}
```

- [ ] **Step 5: Wire the module**

`apps/api/src/notifications/notifications.module.ts` becomes:

```ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillsModule } from '../bills/bills.module';
import { Notification } from './notification.entity';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { ReminderScheduler } from './reminder.scheduler';
import { RemindersService } from './reminders.service';
import { mailTransportProvider } from './mail/mail-transport.provider';

/**
 * `BillsModule` is imported for `BillGeneratorService`, which it exports.
 * Re-providing the generator here would give the reminder run its own
 * instance and its own answer to "what day is it" — the one thing the
 * timezone rule forbids.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Notification]), BillsModule],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    RemindersService,
    ReminderScheduler,
    mailTransportProvider,
  ],
  exports: [NotificationsService, RemindersService],
})
export class NotificationsModule {}
```

- [ ] **Step 6: Run to verify the tests pass**

```bash
npx nx run api:test-e2e --skip-nx-cache
```

Expected: PASS, 20 new tests, every earlier suite green.

- [ ] **Step 7: Prove the tests would catch broken scoping**

Make each change, run the suite, confirm failure by assertion, revert:

1. Drop `WHERE n."user_id" = $1` from `LIST_SQL` → `returns only the caller's notifications` must fail.
2. Drop `WHERE n."user_id" = $1 AND ...` scoping from `UNREAD_SQL` → `counts unread over the whole table` or `returns only the caller's notifications` must fail.
3. Remove `userId` from `markRead`'s update criteria → `is a 404 for another user's notification` must fail.
4. Remove `readAt: null` from `markRead`'s criteria → `is idempotent and keeps the first read instant` must fail.
5. Remove `bi."status" <> 'PAID'` from `UNREAD_SQL` → `excludes a resolved notification from the unread count` must fail.
6. Change `LIMIT $2` to `LIMIT ${LIST_CAP}` (no extra row) → `does not claim truncation at exactly the cap` or `counts unread over the whole table` must fail.

Record each in the report.

- [ ] **Step 8: Commit**

```bash
npx nx run-many -t lint typecheck -p api
git add apps/api/src/notifications apps/api/test/notifications.e2e-spec.ts
git commit -m "feat(api): list, read, and clear notifications

Labels are joined, never stored, so a renamed bill's old reminders say
the new name. The unread count excludes notifications whose bill is now
paid: a badge counting a bill you have already settled is a number that
means nothing, and the reminder's purpose is discharged by the payment.

Scoping was checked by removing each user_id predicate in turn and
confirming a test notices."
```

---

### Task 9: Store first-flush refactor

**Files:**
- Modify: `apps/web/src/app/core/state/summary.store.ts`
- Modify: `apps/web/src/app/core/state/instances.store.ts`
- Test: `apps/web/src/app/core/state/summary.store.spec.ts`
- Test: `apps/web/src/app/core/state/instances.store.spec.ts`

**Interfaces:**
- Consumes: `BillsStore.mutations` and `PaymentsService.mutations`, both `Signal<number>`.
- Produces: no public surface change. `SummaryStore` and `InstancesStore` keep every existing member with the same name and type. Task 10 copies the pattern established here.

**Why this task exists:** an Angular `effect` runs its body once on its first flush regardless of what it read. Both stores exploit that accidentally: they read the counters, then gate on a `loaded` flag read `untracked`. When a test's first flush happens to land *after* `load()` resolved, the effect body runs with `loaded` already true and fetches — so the test observes a fetch that the counters had nothing to do with. Sub-project 4's review proved this by severing both counters in `SummaryStore` and watching 7/7 tests still pass.

- [ ] **Step 1: Write the test that the current code passes for the wrong reason**

Append to `apps/web/src/app/core/state/summary.store.spec.ts`. Match the file's existing harness (`TestBed`, `provideHttpClientTesting`, `HttpTestingController`); read the top of the file and reuse its setup rather than writing a second one.

```ts
  it('refetches when a bill mutation is recorded', async () => {
    const store = TestBed.inject(SummaryStore);
    const bills = TestBed.inject(BillsStore);

    await store.load();
    http.expectOne('/api/summary').flush(emptySummary);
    // Let the first effect flush happen and settle BEFORE the mutation, so
    // the fetch asserted below cannot be the first-flush side effect.
    await TestBed.inject(ApplicationRef).whenStable();
    http.expectNone('/api/summary');

    bills.recordMutation();
    await TestBed.inject(ApplicationRef).whenStable();

    // At least one literal expect(): apps/web/.oxlintrc.json does not
    // treat http.expectOne as an assertion.
    const pending = http.match('/api/summary');
    expect(pending).toHaveLength(1);
    pending[0].flush(emptySummary);
  });

  it('does not refetch when no counter has moved', async () => {
    const store = TestBed.inject(SummaryStore);

    await store.load();
    http.expectOne('/api/summary').flush(emptySummary);
    await TestBed.inject(ApplicationRef).whenStable();
    await TestBed.inject(ApplicationRef).whenStable();

    // The guard against the first-flush bug: a second flush with nothing
    // changed must be silent.
    expect(http.match('/api/summary')).toHaveLength(0);
  });
```

`BillsStore` exposes its counter bump through its public mutating methods; if it has no bare `recordMutation()`, call whichever public method the existing spec already uses to bump it (`create`, `remove`, …) and flush that request too. Read the spec file first and follow what it does.

- [ ] **Step 2: Run, and confirm the refetch test passes *before* the fix**

```bash
npx nx test web -- summary.store
```

Expected: `refetches when a bill mutation is recorded` **passes already**. That is the point — it is not evidence. Record in the report that it passed before any change.

- [ ] **Step 3: Prove the current code is broken**

Temporarily comment out both counter reads in `summary.store.ts`:

```ts
    effect(() => {
      // this.bills.mutations();
      // this.payments.mutations();
      if (untracked(() => this.loadedState())) void this.fetch();
    });
```

Run `npx nx test web -- summary.store`. Record which tests fail. If `refetches when a bill mutation is recorded` still passes, the `whenStable()` before the mutation was not enough to force the first flush — in that case the new test is still tautological and must be strengthened until severing the counters fails it. Restore the file with `git checkout -- apps/web/src/app/core/state/summary.store.ts` before continuing.

- [ ] **Step 4: Refactor `SummaryStore`**

Replace the second effect. Note the two baseline fields must be declared **after** `bills` and `payments`, because class field initializers run in declaration order and these read those injections:

```ts
  /**
   * Last-seen counter values. The effect compares against these instead of
   * relying on an effect's first flush running its body regardless of its
   * dependencies — which is what made the old refetch tests tautological:
   * when the first flush landed after `load()` resolved, the body ran with
   * `loadedState` already true and fetched for no reason at all.
   *
   * Initialized from the current values so the first flush is a no-op.
   */
  private lastBillsMutations = this.bills.mutations();
  private lastPaymentsMutations = this.payments.mutations();
```

```ts
    // Both counters, because both move these figures: a payment changes
    // every bucket, and creating, editing, or deleting a bill rewrites the
    // instances the buckets are computed from.
    effect(() => {
      const bills = this.bills.mutations();
      const payments = this.payments.mutations();
      const moved =
        bills !== this.lastBillsMutations || payments !== this.lastPaymentsMutations;
      this.lastBillsMutations = bills;
      this.lastPaymentsMutations = payments;

      // `loadedState` is read untracked on purpose: tracked, the first
      // successful fetch would re-run this effect and fetch again.
      if (moved && untracked(() => this.loadedState())) void this.fetch();
    });
```

- [ ] **Step 5: Refactor `InstancesStore` the same way**

```ts
  private lastBillsMutations = this.bills.mutations();
```

```ts
    // A template change rewrites, generates, or cascades on the server by
    // rules this store cannot reproduce. Watching the counter rather than
    // having `BillsStore` call in keeps the dependency pointing one way.
    effect(() => {
      const bills = this.bills.mutations();
      const moved = bills !== this.lastBillsMutations;
      this.lastBillsMutations = bills;
      if (moved && untracked(() => this.loaded())) void this.refresh();
    });
```

Add the matching pair of tests to `apps/web/src/app/core/state/instances.store.spec.ts`, in that file's own harness style: one asserting a bill mutation triggers a refetch of the current query, one asserting a second flush with nothing moved issues no request.

- [ ] **Step 6: Run the whole web suite**

```bash
npx nx test web
```

Expected: PASS. If a pre-existing test now fails, it was depending on the first-flush fetch — read it and decide whether the behaviour it asserted was real. Report any such test and what you concluded; do not narrow a pre-existing test without saying so.

- [ ] **Step 7: Prove the fix makes the mutation detectable**

Comment out both counter reads in `summary.store.ts` again (replacing them with constants so it still compiles):

```ts
      const bills = 0;
      const payments = 0;
```

Run `npx nx test web -- summary.store`. Expected: `refetches when a bill mutation is recorded` **now fails**. Do the same for `instances.store.ts`. Restore both with `git checkout --`. Record both results — this is the evidence the task exists to produce.

- [ ] **Step 8: Commit**

```bash
npx nx run-many -t lint typecheck -p web
git add apps/web/src/app/core/state
git commit -m "refactor(web): detect counter changes instead of leaning on first flush

An Angular effect runs its body once on first flush whatever it read, so
both stores' refetch tests passed with their invalidation counters
severed — the observed fetch was the first flush, not the mutation.
Remembering the last-seen values makes the mutation the only trigger,
and severing a counter now fails a test.

Done before NotificationsStore is written, so a third store does not
copy the pattern."
```

---

### Task 10: `NotificationsApi` and `NotificationsStore`

**Files:**
- Create: `apps/web/src/app/core/api/notifications.api.ts`
- Create: `apps/web/src/app/core/state/notifications.store.ts`
- Test: `apps/web/src/app/core/state/notifications.store.spec.ts`

**Interfaces:**
- Consumes: `NotificationItem`, `NotificationListResponse`, `MarkAllReadResponse` (Task 1); `API_BASE` from `apps/web/src/app/core/api/api.constants.ts`; `errorMessage` from `apps/web/src/app/core/api/api-error.ts`; `SessionService` with `isAuthenticated: Signal<boolean>`.
- Produces:
  - `class NotificationsApi` with `list(): Observable<NotificationListResponse>`, `markRead(id: string): Observable<void>`, `markAllRead(): Observable<MarkAllReadResponse>`
  - `class NotificationsStore` with signals `items: Signal<NotificationItem[]>`, `unreadCount: Signal<number>`, `truncated: Signal<boolean>`, `loading: Signal<boolean>`, `error: Signal<string | null>`, `recent: Signal<NotificationItem[]>`; methods `load(force?: boolean): Promise<void>`, `refresh(): Promise<void>`, `markRead(id: string): Promise<void>`, `markAllRead(): Promise<void>`, `reset(): void`
  - `const RECENT_LIMIT = 5`

- [ ] **Step 1: Write the API client**

`apps/web/src/app/core/api/notifications.api.ts`:

```ts
import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  MarkAllReadResponse,
  NotificationListResponse,
} from '@bill-tracker/shared-types';
import { API_BASE } from './api.constants';

@Injectable({ providedIn: 'root' })
export class NotificationsApi {
  private readonly http = inject(HttpClient);

  /** No parameters: the server caps the page and says whether it did. */
  list(): Observable<NotificationListResponse> {
    return this.http.get<NotificationListResponse>(`${API_BASE}/notifications`);
  }

  markRead(id: string): Observable<void> {
    return this.http.post<void>(`${API_BASE}/notifications/${id}/read`, {});
  }

  markAllRead(): Observable<MarkAllReadResponse> {
    return this.http.post<MarkAllReadResponse>(`${API_BASE}/notifications/read-all`, {});
  }
}
```

- [ ] **Step 2: Write the failing store tests**

`apps/web/src/app/core/state/notifications.store.spec.ts`. Follow the harness in `summary.store.spec.ts` — `TestBed.configureTestingModule` with `provideHttpClient`, `provideHttpClientTesting`, and whatever session stub that file uses.

```ts
import { ApplicationRef } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NotificationItem, NotificationListResponse } from '@bill-tracker/shared-types';
import { NotificationsStore } from './notifications.store';
import { SessionService } from '../auth/session.service';

const item = (overrides: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n1',
  kind: 'DUE_TOMORROW',
  isRead: false,
  createdAt: '2026-10-07T08:00:00.000Z',
  billInstanceId: 'bi1',
  billId: 'b1',
  billName: 'Rent',
  dueDate: '2026-10-08',
  amountDue: 1200,
  isResolved: false,
  ...overrides,
});

const response = (
  overrides: Partial<NotificationListResponse> = {},
): NotificationListResponse => ({
  items: [item()],
  unreadCount: 1,
  truncated: false,
  ...overrides,
});

let http: HttpTestingController;
let store: NotificationsStore;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SessionService, useValue: { isAuthenticated: () => true } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  store = TestBed.inject(NotificationsStore);
});

afterEach(() => {
  http.verify();
});

const stable = () => TestBed.inject(ApplicationRef).whenStable();

describe('NotificationsStore.load', () => {
  it('holds the items and the unread count', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(response());
    await loading;

    expect(store.items()).toHaveLength(1);
    expect(store.unreadCount()).toBe(1);
    expect(store.truncated()).toBe(false);
  });

  it('does not fetch a second time unless forced', async () => {
    const first = store.load();
    http.expectOne('/api/notifications').flush(response());
    await first;

    await store.load();
    expect(http.match('/api/notifications')).toHaveLength(0);

    const forced = store.load(true);
    const requests = http.match('/api/notifications');
    expect(requests).toHaveLength(1);
    requests[0].flush(response());
    await forced;
  });

  it('surfaces a failure as a message rather than throwing', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush('nope', { status: 500, statusText: 'Error' });
    await loading;

    expect(store.error()).not.toBeNull();
    expect(store.loading()).toBe(false);
  });
});

describe('NotificationsStore.recent', () => {
  it('offers at most five, newest first as the server returned them', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(
      response({
        items: Array.from({ length: 8 }, (_, i) => item({ id: `n${i}`, billName: `Bill ${i}` })),
        unreadCount: 8,
      }),
    );
    await loading;

    expect(store.recent()).toHaveLength(5);
    expect(store.recent()[0].billName).toBe('Bill 0');
  });

  it('offers everything when there are fewer than five', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(response());
    await loading;

    expect(store.recent()).toHaveLength(1);
  });
});

describe('NotificationsStore.markRead', () => {
  it('marks the row read and decrements the count without refetching', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(
      response({
        items: [item({ id: 'n1' }), item({ id: 'n2' })],
        unreadCount: 2,
      }),
    );
    await loading;

    const marking = store.markRead('n1');
    http.expectOne('/api/notifications/n1/read').flush(null);
    await marking;

    // Patched locally: the server returns no body, and refetching the
    // whole list to learn one row would throw away the rest.
    expect(store.items().find((i) => i.id === 'n1')?.isRead).toBe(true);
    expect(store.items().find((i) => i.id === 'n2')?.isRead).toBe(false);
    expect(store.unreadCount()).toBe(1);
  });

  it('does not decrement twice for a row already read', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(
      response({ items: [item({ id: 'n1', isRead: true })], unreadCount: 0 }),
    );
    await loading;

    const marking = store.markRead('n1');
    http.expectOne('/api/notifications/n1/read').flush(null);
    await marking;

    expect(store.unreadCount()).toBe(0);
  });

  it('never drives the count below zero', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(
      // A resolved-but-unread row is in `items` yet excluded from the
      // count, so naive decrementing would go negative.
      response({ items: [item({ id: 'n1', isResolved: true })], unreadCount: 0 }),
    );
    await loading;

    const marking = store.markRead('n1');
    http.expectOne('/api/notifications/n1/read').flush(null);
    await marking;

    expect(store.unreadCount()).toBe(0);
  });

  it('leaves the row alone when the request fails', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(response());
    await loading;

    const marking = store.markRead('n1');
    http
      .expectOne('/api/notifications/n1/read')
      .flush('nope', { status: 500, statusText: 'Error' });
    await marking;

    expect(store.items()[0].isRead).toBe(false);
    expect(store.unreadCount()).toBe(1);
    expect(store.error()).not.toBeNull();
  });
});

describe('NotificationsStore.markAllRead', () => {
  it('reads every row and zeroes the count', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(
      response({ items: [item({ id: 'n1' }), item({ id: 'n2' })], unreadCount: 2 }),
    );
    await loading;

    const marking = store.markAllRead();
    http.expectOne('/api/notifications/read-all').flush({ updated: 2 });
    await marking;

    expect(store.items().every((i) => i.isRead)).toBe(true);
    expect(store.unreadCount()).toBe(0);
  });
});

describe('NotificationsStore visibility refresh', () => {
  it('refetches when the tab becomes visible again', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(response());
    await loading;
    await stable();

    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await stable();

    const requests = http.match('/api/notifications');
    expect(requests).toHaveLength(1);
    requests[0].flush(response());
  });

  it('does not refetch as the tab is being hidden', async () => {
    const loading = store.load();
    http.expectOne('/api/notifications').flush(response());
    await loading;
    await stable();

    // Without the visibilityState guard, every switch away from the tab
    // costs a request.
    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await stable();

    expect(http.match('/api/notifications')).toHaveLength(0);
  });

  it('does not refetch before anything has been loaded', async () => {
    Object.defineProperty(document, 'visibilityState', {
      value: 'visible',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await stable();

    expect(http.match('/api/notifications')).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to verify failure**

```bash
npx nx test web -- notifications.store
```

Expected: FAIL — cannot resolve `./notifications.store`.

- [ ] **Step 4: Write the store**

`apps/web/src/app/core/state/notifications.store.ts`:

```ts
import {
  DestroyRef, Injectable, computed, effect, inject, signal,
} from '@angular/core';
import { firstValueFrom } from 'rxjs';
import type { NotificationItem } from '@bill-tracker/shared-types';
import { NotificationsApi } from '../api/notifications.api';
import { errorMessage } from '../api/api-error';
import { SessionService } from '../auth/session.service';

/** How many the bell's menu offers before sending the user to the page. */
export const RECENT_LIMIT = 5;

@Injectable({ providedIn: 'root' })
export class NotificationsStore {
  private readonly api = inject(NotificationsApi);
  private readonly session = inject(SessionService);
  private readonly destroyRef = inject(DestroyRef);

  private readonly data = signal<NotificationItem[]>([]);
  private readonly unread = signal(0);
  private readonly truncatedState = signal(false);
  private readonly loadingState = signal(false);
  private readonly errorState = signal<string | null>(null);
  private readonly loadedState = signal(false);

  readonly items = this.data.asReadonly();
  readonly unreadCount = this.unread.asReadonly();
  readonly truncated = this.truncatedState.asReadonly();
  readonly loading = this.loadingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly recent = computed(() => this.data().slice(0, RECENT_LIMIT));

  constructor() {
    effect(() => {
      if (!this.session.isAuthenticated()) this.reset();
    });

    // The reminder run fires once a day at a known hour, so a polling
    // timer would mean dozens of requests per session to catch a single
    // transition. This one listener covers the case that actually happens:
    // a tab left open since yesterday.
    const onVisibility = (): void => {
      // Without this guard the event also fires as the tab is *hidden*,
      // so every switch away would cost a request.
      if (document.visibilityState !== 'visible') return;
      if (!this.loadedState()) return;
      void this.fetch();
    };
    document.addEventListener('visibilitychange', onVisibility);
    this.destroyRef.onDestroy(() => {
      document.removeEventListener('visibilitychange', onVisibility);
    });
  }

  async load(force = false): Promise<void> {
    if (this.loadedState() && !force) return;
    await this.fetch();
  }

  refresh(): Promise<void> {
    return this.fetch();
  }

  async markRead(id: string): Promise<void> {
    const before = this.data().find((item) => item.id === id);
    if (before === undefined) return;

    this.errorState.set(null);
    try {
      await firstValueFrom(this.api.markRead(id));
    } catch (error: unknown) {
      // The row stays as it was: showing it read while the server still
      // has it unread would survive until the next fetch and then jump
      // back, which reads as the app losing the click.
      this.errorState.set(errorMessage(error));
      return;
    }

    this.data.update((items) =>
      items.map((item) => (item.id === id ? { ...item, isRead: true } : item)),
    );
    // Only an unread, unresolved row was being counted — the same
    // predicate the server uses. Decrementing for any other row would
    // drift the badge away from what a refetch would say.
    if (!before.isRead && !before.isResolved) {
      this.unread.update((count) => Math.max(0, count - 1));
    }
  }

  async markAllRead(): Promise<void> {
    this.errorState.set(null);
    try {
      await firstValueFrom(this.api.markAllRead());
    } catch (error: unknown) {
      this.errorState.set(errorMessage(error));
      return;
    }
    this.data.update((items) => items.map((item) => ({ ...item, isRead: true })));
    this.unread.set(0);
  }

  reset(): void {
    this.data.set([]);
    this.unread.set(0);
    this.truncatedState.set(false);
    this.loadedState.set(false);
    this.errorState.set(null);
    this.loadingState.set(false);
  }

  private async fetch(): Promise<void> {
    this.loadingState.set(true);
    this.errorState.set(null);
    try {
      const response = await firstValueFrom(this.api.list());
      this.data.set(response.items);
      this.unread.set(response.unreadCount);
      this.truncatedState.set(response.truncated);
      this.loadedState.set(true);
    } catch (error: unknown) {
      this.errorState.set(errorMessage(error));
    } finally {
      this.loadingState.set(false);
    }
  }
}
```

- [ ] **Step 5: Run to verify the tests pass**

```bash
npx nx test web -- notifications.store
```

Expected: PASS, 13 tests.

- [ ] **Step 6: Add the client to the shared API test if one enumerates them**

`apps/web/src/app/core/api/api-clients.spec.ts` asserts the URL and method of each client. Read it, and add `NotificationsApi`'s three calls in the same style it already uses for `SummaryApi`. If the file turns out not to enumerate clients that way, skip this step and say so in the report.

- [ ] **Step 7: Prove the tests would catch broken refresh**

Make each change, run `npx nx test web -- notifications.store`, confirm failure by assertion, revert:

1. Remove the `document.visibilityState !== 'visible'` guard → `does not refetch as the tab is being hidden` must fail.
2. Remove the `!before.isRead && !before.isResolved` guard → `does not decrement twice for a row already read` and `never drives the count below zero` must fail.
3. Move the `this.data.update(...)` in `markRead` above the `try` → `leaves the row alone when the request fails` must fail.
4. Remove the `removeEventListener` in `onDestroy` → no test fails. Note it; a leaked listener across a test's TestBed teardown is a real concern but needs a second store instance to observe, which is more harness than the risk warrants.

- [ ] **Step 8: Commit**

```bash
npx nx run-many -t lint typecheck -p web
git add apps/web/src/app/core/api/notifications.api.ts apps/web/src/app/core/state/notifications.store.ts apps/web/src/app/core/state/notifications.store.spec.ts apps/web/src/app/core/api/api-clients.spec.ts
git commit -m "feat(web): hold notifications and refresh on tab focus

No polling timer: the reminder run fires once a day, so a timer would
cost dozens of requests to catch one transition. The visibilitychange
listener covers the case that happens — a tab open since yesterday —
and guards on visibilityState, or every switch away from the tab would
cost a request too.

markRead decrements only for a row that was actually being counted,
using the same unread-and-unresolved predicate as the server, so the
badge cannot drift from what a refetch would say."
```

---

### Task 11: The `/notifications` page

**Files:**
- Create: `apps/web/src/app/notifications/notification-text.ts`
- Create: `apps/web/src/app/notifications/notifications.component.ts`
- Modify: `apps/web/src/app/app.routes.ts`
- Test: `apps/web/src/app/notifications/notification-text.spec.ts`
- Test: `apps/web/src/app/notifications/notifications.component.spec.ts`

**Interfaces:**
- Consumes: `NotificationsStore` (Task 10); `NotificationItem` (Task 1); `formatMoney` from `apps/web/src/app/shared/money.ts`; `CalendarDatePipe` (`name: 'calendarDate'`) from `apps/web/src/app/core/date/calendar-date.pipe.ts`; `defaultParams` and `toQueryParams` from `apps/web/src/app/instances/upcoming-params.ts`; `SessionService.user(): Signal<UserProfile | null>`.
- Produces:
  - `function kindLabel(kind: NotificationKind): string`
  - `function notificationLink(item: NotificationItem): Params` — the `/upcoming` query params that isolate the item's row
  - `const LIST_CAP_LABEL = 'most recent 200'`
  - `class NotificationsComponent`

- [ ] **Step 1: Write the failing text-helper tests**

`apps/web/src/app/notifications/notification-text.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { NotificationItem } from '@bill-tracker/shared-types';
import { kindLabel, notificationLink } from './notification-text';

const item: NotificationItem = {
  id: 'n1',
  kind: 'DUE_TOMORROW',
  isRead: false,
  createdAt: '2026-10-07T08:00:00.000Z',
  billInstanceId: 'bi1',
  billId: 'b1',
  billName: 'Rent',
  dueDate: '2026-10-08',
  amountDue: 1200,
  isResolved: false,
};

describe('kindLabel', () => {
  it('names each horizon in words', () => {
    expect(kindLabel('DUE_TOMORROW')).toBe('Due tomorrow');
    expect(kindLabel('DUE_IN_3_DAYS')).toBe('Due in 3 days');
  });
});

describe('notificationLink', () => {
  it('isolates the bill on its own due date', () => {
    const params = notificationLink(item);
    expect(params).toMatchObject({ from: '2026-10-08', to: '2026-10-08', billId: 'b1' });
  });

  it('carries no leftover filter that could hide the row', () => {
    // A same-day from/to pair satisfies the parser's forwards and
    // 400-day checks trivially, and `status` must stay absent — a paid
    // reminder's row would otherwise be filtered out of the very list
    // the notification sent the user to.
    const params = notificationLink({ ...item, isResolved: true });
    expect(params['status']).toBeUndefined();
    expect(params['overdue']).toBeUndefined();
    expect(params['q']).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx nx test web -- notification-text
```

Expected: FAIL — cannot resolve `./notification-text`.

- [ ] **Step 3: Write the helpers**

`apps/web/src/app/notifications/notification-text.ts`:

```ts
import type { Params } from '@angular/router';
import type { NotificationItem, NotificationKind } from '@bill-tracker/shared-types';
import { defaultParams, toQueryParams } from '../instances/upcoming-params';

const LABELS: Record<NotificationKind, string> = {
  DUE_TOMORROW: 'Due tomorrow',
  DUE_IN_3_DAYS: 'Due in 3 days',
};

export function kindLabel(kind: NotificationKind): string {
  return LABELS[kind];
}

/**
 * The query parameters that land the user on exactly the row the
 * notification is about, rather than on a list they then have to search.
 *
 * Built from `defaultParams()` so every filter this does not set is at
 * its default and therefore omitted by `toQueryParams` — in particular
 * `status`, which if carried over would filter out a paid bill's row from
 * the very list its notification linked to.
 */
export function notificationLink(item: NotificationItem): Params {
  return toQueryParams({
    ...defaultParams(),
    from: item.dueDate,
    to: item.dueDate,
    billId: item.billId,
  });
}
```

`defaultParams()` returns `from`/`to` typed `CalendarDate`; `item.dueDate` is a plain `string`. If `CalendarDate` is a branded type that rejects the assignment, use the module's own validator to narrow it rather than casting — read `apps/web/src/app/core/date/calendar-date.ts` and use `isCalendarDate` as a type guard, falling back to `defaultParams()`'s range when the guard fails. Report which applied.

- [ ] **Step 4: Run to verify the helper tests pass**

```bash
npx nx test web -- notification-text
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Write the failing component tests**

`apps/web/src/app/notifications/notifications.component.spec.ts`. Follow the harness used by `apps/web/src/app/dashboard/dashboard.component.spec.ts` — read it first and reuse its provider setup and its `whenStable()` idiom.

```ts
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NotificationItem, UserProfile } from '@bill-tracker/shared-types';
import { NotificationsComponent } from './notifications.component';
import { SessionService } from '../core/auth/session.service';

const profile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  id: 'u1',
  email: 'don@example.com',
  name: 'Don',
  notifyEmail: true,
  notifyInApp: true,
  ...overrides,
});

const item = (overrides: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n1',
  kind: 'DUE_TOMORROW',
  isRead: false,
  createdAt: '2026-10-07T08:00:00.000Z',
  billInstanceId: 'bi1',
  billId: 'b1',
  billName: 'Rent',
  dueDate: '2026-10-08',
  amountDue: 1200,
  isResolved: false,
  ...overrides,
});

let http: HttpTestingController;
const user = signal<UserProfile | null>(profile());

beforeEach(() => {
  user.set(profile());
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      {
        provide: SessionService,
        useValue: { isAuthenticated: () => true, user },
      },
    ],
  });
  http = TestBed.inject(HttpTestingController);
});

const render = async (items: NotificationItem[], extra: Partial<{ truncated: boolean }> = {}) => {
  const fixture = TestBed.createComponent(NotificationsComponent);
  fixture.detectChanges();
  http.expectOne('/api/notifications').flush({
    items,
    unreadCount: items.filter((i) => !i.isRead && !i.isResolved).length,
    truncated: extra.truncated ?? false,
  });
  await TestBed.inject(ApplicationRef).whenStable();
  fixture.detectChanges();
  return fixture;
};

const text = (fixture: { nativeElement: HTMLElement }): string =>
  fixture.nativeElement.textContent ?? '';

describe('NotificationsComponent', () => {
  it('lists each reminder with its horizon, bill, date, and balance', async () => {
    const fixture = await render([item()]);

    expect(text(fixture)).toContain('Due tomorrow');
    expect(text(fixture)).toContain('Rent');
    expect(text(fixture)).toContain('$1,200.00');
  });

  it('links a reminder to the row it is about', async () => {
    const fixture = await render([item()]);

    const link = fixture.nativeElement.querySelector<HTMLAnchorElement>(
      '[data-testid="notification-link"]',
    );
    expect(link?.getAttribute('href')).toContain('billId=b1');
  });

  it('marks a reminder read when its link is followed', async () => {
    const fixture = await render([item()]);

    fixture.nativeElement
      .querySelector<HTMLAnchorElement>('[data-testid="notification-link"]')
      ?.click();
    await TestBed.inject(ApplicationRef).whenStable();

    const request = http.expectOne('/api/notifications/n1/read');
    expect(request.request.method).toBe('POST');
    request.flush(null);
  });

  it('distinguishes a read reminder from an unread one', async () => {
    const fixture = await render([item({ id: 'n1' }), item({ id: 'n2', isRead: true })]);

    const rows = fixture.nativeElement.querySelectorAll('[data-testid="notification-row"]');
    expect(rows[0].classList.contains('unread')).toBe(true);
    expect(rows[1].classList.contains('unread')).toBe(false);
  });

  it('says a reminder is settled once its bill is paid', async () => {
    const fixture = await render([item({ isResolved: true, amountDue: 0 })]);

    // Without this the row reads "$0.00 due", which looks like a bug
    // rather than like a bill that has been paid.
    expect(text(fixture)).toContain('Paid');
  });

  it('clears everything with one action', async () => {
    const fixture = await render([item({ id: 'n1' }), item({ id: 'n2' })]);

    fixture.nativeElement
      .querySelector<HTMLButtonElement>('[data-testid="mark-all-read"]')
      ?.click();
    await TestBed.inject(ApplicationRef).whenStable();

    const request = http.expectOne('/api/notifications/read-all');
    expect(request.request.method).toBe('POST');
    request.flush({ updated: 2 });
  });

  it('offers no clear-all action when nothing is unread', async () => {
    const fixture = await render([item({ isRead: true })]);

    expect(
      fixture.nativeElement.querySelector('[data-testid="mark-all-read"]'),
    ).toBeNull();
  });

  it('says so when the server capped the list', async () => {
    const fixture = await render([item()], { truncated: true });

    expect(text(fixture)).toContain('most recent 200');
  });

  it('says there is nothing rather than showing a bare page', async () => {
    const fixture = await render([]);

    expect(text(fixture)).toContain('No reminders yet');
  });

  it('explains that reminders are off rather than claiming there are none', async () => {
    user.set(profile({ notifyInApp: false }));
    const fixture = TestBed.createComponent(NotificationsComponent);
    fixture.detectChanges();
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();

    // "No reminders" would be false and is exactly the wrong thing to
    // tell someone about their bills.
    expect(text(fixture)).toContain('turned off');
    expect(text(fixture)).not.toContain('No reminders yet');
    expect(
      fixture.nativeElement.querySelector<HTMLAnchorElement>('[data-testid="to-settings"]'),
    ).not.toBeNull();
  });
});
```

Note the last test does **not** flush a list request: with `notifyInApp` false the component renders the explanation instead. `http.verify()` is not called in this spec's `afterEach`, so an unflushed request would not fail it; if the component does fetch anyway, flush it inside that test and say so in the report.

- [ ] **Step 6: Run to verify failure**

```bash
npx nx test web -- notifications.component
```

Expected: FAIL — cannot resolve `./notifications.component`.

- [ ] **Step 7: Write the component**

`apps/web/src/app/notifications/notifications.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import type { NotificationItem } from '@bill-tracker/shared-types';
import { NotificationsStore } from '../core/state/notifications.store';
import { SessionService } from '../core/auth/session.service';
import { CalendarDatePipe } from '../core/date/calendar-date.pipe';
import { formatMoney } from '../shared/money';
import { LIST_CAP_LABEL, kindLabel, notificationLink } from './notification-text';

interface Row {
  item: NotificationItem;
  label: string;
  amountLabel: string;
  queryParams: ReturnType<typeof notificationLink>;
}

@Component({
  selector: 'app-notifications',
  imports: [
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatListModule,
    MatProgressBarModule,
    CalendarDatePipe,
  ],
  template: `
    <header class="page-header">
      <h1>Reminders</h1>
      @if (store.unreadCount() > 0) {
        <button
          matButton
          data-testid="mark-all-read"
          (click)="markAllRead()"
        >
          Mark all read
        </button>
      }
    </header>

    @if (store.loading()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (store.error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }

    @if (!notificationsEnabled()) {
      <p class="muted">
        In-app reminders are turned off, so nothing is shown here. Reminders are still
        being recorded, and turning them back on will reveal them.
      </p>
      <a matButton routerLink="/settings" data-testid="to-settings">Open settings</a>
    } @else if (rows().length === 0 && !store.loading()) {
      <p class="muted">No reminders yet. They arrive three days and one day before a bill is due.</p>
    } @else {
      <mat-list>
        @for (row of rows(); track row.item.id) {
          <mat-list-item
            data-testid="notification-row"
            [class.unread]="!row.item.isRead"
          >
            <mat-icon matListItemIcon>{{ row.item.isResolved ? 'check_circle' : 'schedule' }}</mat-icon>
            <a
              matListItemTitle
              data-testid="notification-link"
              routerLink="/upcoming"
              [queryParams]="row.queryParams"
              (click)="markRead(row.item)"
            >
              {{ row.item.billName }}
            </a>
            <span matListItemLine>
              {{ row.label }} — {{ row.item.dueDate | calendarDate }} —
              @if (row.item.isResolved) {
                Paid
              } @else {
                {{ row.amountLabel }}
              }
            </span>
          </mat-list-item>
        }
      </mat-list>

      @if (store.truncated()) {
        <p class="muted">Showing the {{ capLabel }} reminders.</p>
      }
    }
  `,
  styles: `
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .unread {
      font-weight: 600;
    }
    .muted {
      opacity: 0.75;
    }
    .error {
      color: var(--mat-sys-error, #b3261e);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationsComponent {
  protected readonly store = inject(NotificationsStore);
  private readonly session = inject(SessionService);

  protected readonly capLabel = LIST_CAP_LABEL;

  /**
   * The bell is hidden and this page explains itself rather than showing
   * an empty list, because "no reminders" would be false — and false is
   * exactly the wrong thing to tell someone about their bills.
   */
  protected readonly notificationsEnabled = computed(
    () => this.session.user()?.notifyInApp ?? true,
  );

  protected readonly rows = computed<Row[]>(() =>
    this.store.items().map((item) => ({
      item,
      label: kindLabel(item.kind),
      amountLabel: `${formatMoney(item.amountDue)} due`,
      queryParams: notificationLink(item),
    })),
  );

  constructor() {
    void this.store.load();
  }

  protected markRead(item: NotificationItem): void {
    if (item.isRead) return;
    void this.store.markRead(item.id);
  }

  protected markAllRead(): void {
    void this.store.markAllRead();
  }
}
```

Add to `notification-text.ts`:

```ts
/**
 * The server's cap, stated in the one place the page mentions it. Kept as
 * a label rather than a number so the copy reads naturally and there is
 * one string to change if the cap moves.
 */
export const LIST_CAP_LABEL = 'most recent 200';
```

- [ ] **Step 8: Add the route**

In `apps/web/src/app/app.routes.ts`, inside the `authGuard` parent's `children`, after the `calendar` entry:

```ts
      {
        path: 'notifications',
        loadComponent: () =>
          import('./notifications/notifications.component').then(
            (m) => m.NotificationsComponent,
          ),
      },
```

Add a test to `apps/web/src/app/app.spec.ts` in the style of the existing route tests there (sub-project 4 added route-resolution tests to that file — read it and match):

```ts
  it('resolves /notifications inside the protected shell', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/notifications');
    expect(router.url).toBe('/notifications');
  });
```

If `app.spec.ts` asserts routes differently, follow its idiom exactly rather than introducing a second one.

- [ ] **Step 9: Run to verify the tests pass**

```bash
npx nx test web
```

Expected: PASS, 10 component tests plus the route test, and every pre-existing web test still green.

- [ ] **Step 10: Prove the tests would catch broken copy**

Make each change, run `npx nx test web -- notifications.component`, confirm failure by assertion, revert:

1. Change `@if (!notificationsEnabled())` to `@if (false)` → `explains that reminders are off` must fail.
2. Remove the `@if (row.item.isResolved) { Paid }` branch → `says a reminder is settled once its bill is paid` must fail.
3. Remove `(click)="markRead(row.item)"` → `marks a reminder read when its link is followed` must fail.
4. Change `store.unreadCount() > 0` to `true` → `offers no clear-all action when nothing is unread` must fail.

- [ ] **Step 11: Commit**

```bash
npx nx run-many -t lint typecheck -p web
git add apps/web/src/app/notifications apps/web/src/app/app.routes.ts apps/web/src/app/app.spec.ts
git commit -m "feat(web): add the reminders page

With in-app reminders switched off the page explains itself instead of
rendering an empty list: 'no reminders' would be false, and false is
exactly the wrong thing to tell someone about their bills.

Links are built from defaultParams() so no leftover status filter can
hide the very row the notification sent the user to."
```

---

### Task 12: The toolbar bell

**Files:**
- Create: `apps/web/src/app/shell/notification-bell.component.ts`
- Modify: `apps/web/src/app/shell/shell.component.ts`
- Test: `apps/web/src/app/shell/notification-bell.component.spec.ts`
- Test: `apps/web/src/app/shell/shell.component.spec.ts` (append)

**Interfaces:**
- Consumes: `NotificationsStore` and `RECENT_LIMIT` (Task 10); `kindLabel`, `notificationLink` (Task 11); `SessionService.user()`.
- Produces: `class NotificationBellComponent` with selector `app-notification-bell`.

- [ ] **Step 1: Write the failing tests**

`apps/web/src/app/shell/notification-bell.component.spec.ts`:

```ts
import { ApplicationRef, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import type { NotificationItem, UserProfile } from '@bill-tracker/shared-types';
import { NotificationBellComponent } from './notification-bell.component';
import { SessionService } from '../core/auth/session.service';

const profile = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  id: 'u1',
  email: 'don@example.com',
  name: 'Don',
  notifyEmail: true,
  notifyInApp: true,
  ...overrides,
});

const item = (overrides: Partial<NotificationItem> = {}): NotificationItem => ({
  id: 'n1',
  kind: 'DUE_TOMORROW',
  isRead: false,
  createdAt: '2026-10-07T08:00:00.000Z',
  billInstanceId: 'bi1',
  billId: 'b1',
  billName: 'Rent',
  dueDate: '2026-10-08',
  amountDue: 1200,
  isResolved: false,
  ...overrides,
});

let http: HttpTestingController;
const user = signal<UserProfile | null>(profile());

beforeEach(() => {
  user.set(profile());
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: SessionService, useValue: { isAuthenticated: () => true, user } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
});

const render = async (items: NotificationItem[]) => {
  const fixture = TestBed.createComponent(NotificationBellComponent);
  fixture.detectChanges();
  http.expectOne('/api/notifications').flush({
    items,
    unreadCount: items.filter((i) => !i.isRead && !i.isResolved).length,
    truncated: false,
  });
  await TestBed.inject(ApplicationRef).whenStable();
  fixture.detectChanges();
  return fixture;
};

const openMenu = async (fixture: { nativeElement: HTMLElement; detectChanges: () => void }) => {
  fixture.nativeElement.querySelector<HTMLButtonElement>('[data-testid="bell"]')?.click();
  await TestBed.inject(ApplicationRef).whenStable();
  fixture.detectChanges();
};

describe('NotificationBellComponent', () => {
  it('shows the unread count', async () => {
    const fixture = await render([item({ id: 'n1' }), item({ id: 'n2' })]);

    const bell = fixture.nativeElement.querySelector('[data-testid="bell"]');
    expect(bell?.getAttribute('aria-label')).toBe('Reminders, 2 unread');
  });

  it('names zero unread without a count in the label', async () => {
    const fixture = await render([item({ isRead: true })]);

    expect(
      fixture.nativeElement.querySelector('[data-testid="bell"]')?.getAttribute('aria-label'),
    ).toBe('Reminders, none unread');
  });

  it('offers at most five in the menu', async () => {
    const fixture = await render(
      Array.from({ length: 7 }, (_, i) => item({ id: `n${i}`, billName: `Bill ${i}` })),
    );
    await openMenu(fixture);

    // The overlay renders outside the fixture's own element.
    const entries = document.querySelectorAll('[data-testid="bell-item"]');
    expect(entries).toHaveLength(5);
  });

  it('links a menu entry to the row it is about and marks it read', async () => {
    const fixture = await render([item()]);
    await openMenu(fixture);

    const entry = document.querySelector<HTMLAnchorElement>('[data-testid="bell-item"]');
    expect(entry?.getAttribute('href')).toContain('billId=b1');

    entry?.click();
    await TestBed.inject(ApplicationRef).whenStable();
    http.expectOne('/api/notifications/n1/read').flush(null);
  });

  it('offers a way to the full list', async () => {
    const fixture = await render([item()]);
    await openMenu(fixture);

    const all = document.querySelector<HTMLAnchorElement>('[data-testid="bell-see-all"]');
    expect(all?.getAttribute('href')).toContain('/notifications');
  });

  it('says there is nothing rather than opening an empty menu', async () => {
    const fixture = await render([]);
    await openMenu(fixture);

    expect(document.querySelector('[data-testid="bell-empty"]')).not.toBeNull();
  });

  it('is not rendered at all when in-app reminders are off', async () => {
    user.set(profile({ notifyInApp: false }));
    const fixture = TestBed.createComponent(NotificationBellComponent);
    fixture.detectChanges();
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[data-testid="bell"]')).toBeNull();
  });
});
```

Append to `apps/web/src/app/shell/shell.component.spec.ts`, in that file's existing harness:

```ts
  it('puts the bell in the toolbar, ahead of sign out', async () => {
    const fixture = TestBed.createComponent(ShellComponent);
    fixture.detectChanges();
    await TestBed.inject(ApplicationRef).whenStable();
    fixture.detectChanges();

    const bell = fixture.nativeElement.querySelector('app-notification-bell');
    const signOut = fixture.nativeElement.querySelector('[data-testid="sign-out"]');
    expect(bell).not.toBeNull();
    // A reminder the user has to navigate to is a reminder they will miss,
    // so it belongs in the chrome that is always on screen.
    expect(bell.compareDocumentPosition(signOut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
```

The shell spec's existing setup may not provide `HttpTestingController`; the bell fetches on construction. Add `provideHttpClient()` and `provideHttpClientTesting()` to that spec's providers if they are not there, and flush or ignore the `/api/notifications` request as that file's style dictates. Report what you had to add.

- [ ] **Step 2: Run to verify failure**

```bash
npx nx test web -- notification-bell
```

Expected: FAIL — cannot resolve `./notification-bell.component`.

- [ ] **Step 3: Write the component**

`apps/web/src/app/shell/notification-bell.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatBadgeModule } from '@angular/material/badge';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import type { NotificationItem } from '@bill-tracker/shared-types';
import { NotificationsStore } from '../core/state/notifications.store';
import { SessionService } from '../core/auth/session.service';
import { kindLabel, notificationLink } from '../notifications/notification-text';

interface BellRow {
  item: NotificationItem;
  label: string;
  queryParams: ReturnType<typeof notificationLink>;
}

@Component({
  selector: 'app-notification-bell',
  imports: [RouterLink, MatBadgeModule, MatButtonModule, MatIconModule, MatMenuModule],
  template: `
    @if (enabled()) {
      <button
        matIconButton
        data-testid="bell"
        [attr.aria-label]="label()"
        [matMenuTriggerFor]="menu"
      >
        <mat-icon
          [matBadge]="store.unreadCount()"
          [matBadgeHidden]="store.unreadCount() === 0"
          matBadgeSize="small"
          matBadgeColor="warn"
        >
          notifications
        </mat-icon>
      </button>

      <mat-menu #menu>
        @if (rows().length === 0) {
          <span mat-menu-item disabled data-testid="bell-empty">No reminders</span>
        } @else {
          @for (row of rows(); track row.item.id) {
            <a
              mat-menu-item
              data-testid="bell-item"
              routerLink="/upcoming"
              [queryParams]="row.queryParams"
              (click)="markRead(row.item)"
            >
              <span class="bill">{{ row.item.billName }}</span>
              <span class="horizon">{{ row.label }}</span>
            </a>
          }
        }
        <a mat-menu-item routerLink="/notifications" data-testid="bell-see-all">See all</a>
      </mat-menu>
    }
  `,
  styles: `
    .horizon {
      margin-left: 0.5rem;
      opacity: 0.7;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NotificationBellComponent {
  protected readonly store = inject(NotificationsStore);
  private readonly session = inject(SessionService);

  /**
   * Hidden rather than emptied when the channel is off. A bell showing
   * zero would imply there is nothing due, which is a different claim
   * from "you asked not to be shown this".
   */
  protected readonly enabled = computed(() => this.session.user()?.notifyInApp ?? true);

  protected readonly rows = computed<BellRow[]>(() =>
    this.store.recent().map((item) => ({
      item,
      label: kindLabel(item.kind),
      queryParams: notificationLink(item),
    })),
  );

  /**
   * The count belongs in the accessible name, not only in the badge:
   * `matBadge` renders a visually-positioned span that a screen reader
   * reads out of context, if at all.
   */
  protected readonly label = computed(() => {
    const count = this.store.unreadCount();
    return count === 0 ? 'Reminders, none unread' : `Reminders, ${count} unread`;
  });

  constructor() {
    void this.store.load();
  }

  protected markRead(item: NotificationItem): void {
    if (item.isRead) return;
    void this.store.markRead(item.id);
  }
}
```

- [ ] **Step 4: Put it in the toolbar**

In `apps/web/src/app/shell/shell.component.ts`, add the import to the component's `imports` array and place the element between the user's name and the sign-out button:

```html
      <span class="user">{{ user()?.name }}</span>
      <app-notification-bell />
      <button matIconButton data-testid="sign-out" aria-label="Sign out" (click)="signOut()">
```

```ts
import { NotificationBellComponent } from './notification-bell.component';
```

- [ ] **Step 5: Run to verify the tests pass**

```bash
npx nx test web
```

Expected: PASS, 7 bell tests plus the shell placement test, and every pre-existing web test still green.

- [ ] **Step 6: Prove the tests would catch a broken bell**

Make each change, run `npx nx test web -- notification-bell`, confirm failure by assertion, revert:

1. Change `@if (enabled())` to `@if (true)` → `is not rendered at all when in-app reminders are off` must fail.
2. Change `store.recent()` to `store.items()` → `offers at most five in the menu` must fail.
3. Remove the `[attr.aria-label]` binding → `shows the unread count` must fail. **This is the point of asserting the label rather than the badge text:** sub-project 4's review found that the calendar's keyboard focus was entirely untested because nothing but a sighted mouse user ever exercised it.
4. Remove `(click)="markRead(row.item)"` → `links a menu entry to the row it is about and marks it read` must fail.

- [ ] **Step 7: Commit**

```bash
npx nx run-many -t lint typecheck -p web
git add apps/web/src/app/shell
git commit -m "feat(web): add the reminder bell to the toolbar

The count goes in the button's accessible name, not only the badge:
matBadge renders a positioned span a screen reader reads out of context
if at all, and a count only a sighted mouse user can perceive is the
same gap that left the calendar's keyboard focus untested.

With the channel off the bell is absent rather than showing zero — zero
implies nothing is due, which is a different claim from 'you asked not
to be shown this'."
```

---

### Task 13: The end-to-end journey

**Files:**
- Create: `apps/web-e2e/src/support/seed.ts`
- Create: `apps/web-e2e/src/journey-notifications.spec.ts`
- Modify: `apps/web-e2e/src/support/flows.ts`

**Interfaces:**
- Consumes: `E2E_DATABASE_URL` from `apps/web-e2e/src/support/database-url.ts`; `newAccount` from `./support/accounts`; `registerAndSignIn`, `createBill`, `BillInput` from `./support/flows`.
- Produces:
  - `function daysFromToday(n: number): string` in `support/flows.ts`
  - `async function seedNotification(email: string, kind: 'DUE_IN_3_DAYS' | 'DUE_TOMORROW', billName: string): Promise<void>` in `support/seed.ts` — the third argument names the bill to attach to, not a date

- [ ] **Step 1: Add the date helper**

`support/flows.ts` already exports `startOfThisMonth()`. Add beside it, matching its style:

```ts
/**
 * A calendar day `n` days from today, in the browser's zone. Good enough
 * for a journey: the API's APP_TIMEZONE is UTC under e2e, and the suite
 * does not run across a midnight boundary.
 */
export function daysFromToday(n: number): string {
  const date = new Date();
  date.setDate(date.getDate() + n);
  return date.toISOString().slice(0, 10);
}
```

- [ ] **Step 2: Write the seeding helper**

`apps/web-e2e/src/support/seed.ts`:

```ts
import { DataSource } from 'typeorm';
import { E2E_DATABASE_URL } from './database-url.ts';

/**
 * Inserts one notification row directly.
 *
 * Everything else in this journey goes through the UI — the account is
 * registered and the bill created like a user would. The one thing a
 * journey cannot do is wait until 08:00 for the reminder cron, so that
 * single row is written here.
 *
 * Deliberately NOT a copy of the reminder run's own statement. It selects
 * one already-known instance by bill name and due date and inserts one
 * row, so it cannot quietly become a second implementation of the
 * selection logic that then agrees with a broken original.
 */
export async function seedNotification(
  email: string,
  kind: 'DUE_IN_3_DAYS' | 'DUE_TOMORROW',
  billName: string,
): Promise<void> {
  const ds = new DataSource({ type: 'postgres', url: E2E_DATABASE_URL });
  await ds.initialize();
  try {
    const rows = await ds.query(
      `SELECT bi."id" AS instance_id, bi."user_id" AS user_id
       FROM "bill_instances" bi
       INNER JOIN "bills" b ON b."id" = bi."bill_id"
       INNER JOIN "users" u ON u."id" = bi."user_id"
       WHERE u."email" = $1 AND b."name" = $2
       ORDER BY bi."due_date" ASC
       LIMIT 1`,
      [email.toLowerCase(), billName],
    );
    if (rows.length === 0) {
      throw new Error(
        `seedNotification found no instance of "${billName}" for ${email}. ` +
          'The bill must be created through the UI before this is called.',
      );
    }
    await ds.query(
      `INSERT INTO "notifications" ("user_id","bill_instance_id","kind")
       VALUES ($1,$2,$3)
       ON CONFLICT ("bill_instance_id","kind") DO NOTHING`,
      [rows[0].user_id, rows[0].instance_id, kind],
    );
  } finally {
    await ds.destroy();
  }
}
```

- [ ] **Step 3: Write the journey**

`apps/web-e2e/src/journey-notifications.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import { newAccount } from './support/accounts';
import { createBill, daysFromToday, registerAndSignIn } from './support/flows';
import { seedNotification } from './support/seed';

/**
 * The loop this sub-project exists to deliver: a reminder reaches the
 * user, names the right bill, and leads to the row where they can act on
 * it — and stops asking once acknowledged.
 *
 * A badge that leads nowhere, or that never clears, is the failure this
 * catches. Both look fine in a screenshot.
 */
test('a reminder leads to its bill and clears once read', async ({ page }) => {
  const account = newAccount();
  await registerAndSignIn(page, account);

  const dueDate = daysFromToday(1);
  await createBill(page, { name: 'Electric', amount: '84.50', startDate: dueDate });

  // The one step the UI cannot perform: the cron runs at 08:00.
  await seedNotification(account.email, 'DUE_TOMORROW', 'Electric');

  await page.goto('/dashboard');

  const bell = page.getByTestId('bell');
  // The count lives in the accessible name, which is also what a screen
  // reader gets — asserting it covers both at once.
  await expect(bell).toHaveAttribute('aria-label', 'Reminders, 1 unread');

  await bell.click();
  const entry = page.getByTestId('bell-item').first();
  await expect(entry).toContainText('Electric');
  await expect(entry).toContainText('Due tomorrow');

  await entry.click();

  // Landed on the list, filtered to exactly this bill on exactly its day.
  await expect(page).toHaveURL(/\/upcoming\?/);
  await expect(page).toHaveURL(new RegExp(`from=${dueDate}`));
  await expect(page.getByText('Electric').first()).toBeVisible();

  // Clicking the reminder acknowledged it, so the badge is gone.
  await expect(bell).toHaveAttribute('aria-label', 'Reminders, none unread');

  // And the full list agrees, rather than the bell and the page
  // disagreeing about the same row.
  await page.goto('/notifications');
  await expect(page.getByTestId('notification-row')).toHaveCount(1);
  await expect(page.getByTestId('mark-all-read')).toHaveCount(0);
});
```

- [ ] **Step 4: Run the suite**

```bash
npx nx e2e web-e2e
```

Expected: PASS, 11 journeys (the 10 existing plus this one).

If the run reports `Waiting for api:serve:development in another nx process`, a stale serve from an earlier session is holding the target. Find it with `ps aux | grep 'nx run api:serve'` — a port check alone misses a process stuck before it binds — kill that PID, run `npx nx reset`, and retry.

- [ ] **Step 5: Prove the journey would catch a broken loop**

Make each change, run `npx nx e2e web-e2e --skip-nx-cache`, confirm the journey fails, revert:

1. In `notification-bell.component.ts`, remove `(click)="markRead(row.item)"` → the final `none unread` assertion must fail.
2. In `notification-text.ts`, drop `billId: item.billId` from `notificationLink` → the URL assertion must fail.

Record both. Do not leave either change in place.

- [ ] **Step 6: Full verification**

```bash
npx nx run-many -t lint typecheck build test
npx nx run api:test-e2e --skip-nx-cache
npx nx e2e web-e2e
```

Expected: all green across all four projects.

Then run the API suite under two zones on opposite sides of the date line, since the reminder offsets are computed from `APP_TIMEZONE`:

```bash
TZ=Pacific/Kiritimati npx nx run api:test-e2e --skip-nx-cache
TZ=Pacific/Midway npx nx run api:test-e2e --skip-nx-cache
```

`TZ` is not part of the Nx cache key, so `--skip-nx-cache` is required or the second run replays the first's result.

- [ ] **Step 7: Commit**

```bash
git add apps/web-e2e
git commit -m "test(web-e2e): cover the reminder-to-payment-row loop

A badge that leads nowhere, and a badge that never clears, both look
fine in a screenshot. This journey fails for either.

The seeding helper writes one row by id rather than reusing the
reminder run's statement, so it cannot become a second implementation
of the selection logic that agrees with a broken original."
```

---

## Verification Summary

After Task 13 the following must all hold:

| Check | Command |
|---|---|
| Lint, typecheck, build, unit tests, 4 projects | `npx nx run-many -t lint typecheck build test` |
| API integration and e2e | `npx nx run api:test-e2e --skip-nx-cache` |
| API suite east of the date line | `TZ=Pacific/Kiritimati npx nx run api:test-e2e --skip-nx-cache` |
| API suite west of the date line | `TZ=Pacific/Midway npx nx run api:test-e2e --skip-nx-cache` |
| Playwright journeys | `npx nx e2e web-e2e` |

No server process may be left running. Confirm with `ps aux | grep 'nx run api:serve'` before finishing.
