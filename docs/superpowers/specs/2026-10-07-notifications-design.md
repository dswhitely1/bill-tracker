# Design: Notifications (Sub-project 5)

**Date:** 2026-10-07
**Sub-project:** 5 of 5
**Depends on:** `2026-10-04-api-foundation-design.md`,
`2026-10-05-bills-api-design.md`, `2026-10-06-angular-shell-design.md`,
`2026-10-06-views-design.md`

## 1. Goal and non-goals

### Goal

Make an unpaid bill reach the user *before* it is late, without
requiring them to open the application. Two reminders per bill
instance — three days out and one day out — recorded once each, shown
in the shell, and delivered to the inbox as a single daily digest when
mail is configured.

This also closes the two user columns that sub-project 1 created and
nothing has ever read: `users.notify_email` and `users.notify_in_app`
are toggled from `/settings` today and have no effect. After this
sub-project they govern real delivery.

Success criteria:

- An unpaid instance due in exactly 3 days, and again in exactly 1 day,
  produces exactly one notification each — and running the job twice,
  or in two processes, or across a restart mid-run, still produces
  exactly one each.
- A user who has turned both channels off generates no rows at all.
- A paid instance generates nothing.
- One user never sees another user's notifications, through any route.
- Mail delivery failing costs the email and nothing else: the in-app
  reminder still stands.
- The application runs correctly with no mail configuration at all.

### Non-goals

No push notifications, no SMS, no web-push, no service worker. No
per-bill reminder overrides — the offsets are 3 and 1 days for
everything, per the PRD. No due-today reminder and no recurring overdue
nag: overdue is already stated on the dashboard card and badged on
every row, and a third trigger would repeat what the UI says loudly
already.

No retry queue for failed mail (§4.4). No digest scheduling preferences
(hour, frequency, quiet hours). No notification delete — read *is*
dismissal (§5.3). No real-time transport: the client refreshes on
events it already has (§6.4).

No change to `GET /api/bill-instances`, `GET /api/summary`, or any
existing contract. This sub-project adds; it does not alter.

## 2. Context and scope

Sub-projects 1–4 are merged. The API has JWT auth, categories, bill
templates, bill instances, an append-only payment log, and the summary
aggregate. The Angular client has the shell, auth screens, bills,
categories, the instance list, the dashboard, and the calendar.

Two pieces of existing machinery this design builds on directly:

**`BillScheduler`** (`apps/api/src/bills/bill.scheduler.ts`) already
establishes how this codebase schedules work: a `CronJob` registered
imperatively through `SchedulerRegistry` rather than with the `@Cron`
decorator, because the decorator fixes `timeZone` at class-definition
time and this application's zone comes from configuration. It also
establishes that the scheduler does nothing when `NODE_ENV === 'test'`,
so a cron firing mid-suite cannot make other tests intermittent.

**`BillGeneratorService.today()`** is, in its own words, "the single
point where the application asks what day it is". It resolves
`APP_TIMEZONE`. Sub-project 4 §3.2 made this binding for the summary
endpoint: never Postgres `CURRENT_DATE`, which answers in the database
session's zone. The same rule binds here.

### Deliverables

- `notifications` table, via a real migration. `synchronize: false`
  remains true in every environment.
- `NotificationKind`, `NotificationItem`, `NotificationListResponse` in
  `libs/shared-types`.
- `RemindersService` — the scan-and-record run, callable without a clock.
- `ReminderScheduler` — the 08:00 cron that calls it.
- `MailTransport` abstraction with two implementations, selected by
  configuration.
- `NotificationsService` and `NotificationsController` — list, mark one
  read, mark all read.
- `NotificationsApi`, `NotificationsStore`, a toolbar bell, and a
  `/notifications` page.
- The store first-flush refactor described in §6.5.
- Tests per §7.

## 3. Data

### 3.1 The table

```
notifications
  id                uuid PK       gen_random_uuid()
  user_id           uuid NOT NULL FK → users           ON DELETE CASCADE
  bill_instance_id  uuid NOT NULL FK → bill_instances  ON DELETE CASCADE
  kind              varchar(20) NOT NULL
  read_at           timestamptz NULL
  created_at        timestamptz NOT NULL DEFAULT now()

  CONSTRAINT UQ_notifications_instance_kind UNIQUE (bill_instance_id, kind)
  CONSTRAINT CHK_notifications_kind CHECK (kind IN ('DUE_IN_3_DAYS','DUE_TOMORROW'))
  INDEX IDX_notifications_user_unread  (user_id, read_at)
  INDEX IDX_notifications_user_created (user_id, created_at DESC)
```

`user_id` is denormalized from `bill_instances` deliberately, matching
what `bill_instances` itself does with `user_id`: every scoping query
filters without a join, and the authorization predicate is a column on
the row being returned rather than something two joins away.

`ON DELETE CASCADE` on `bill_instance_id` means deleting a bill removes
its notifications. A reminder about a bill that no longer exists is
noise, not history.

`CHK_notifications_kind` is a database-level guard on the same values
the TypeScript union carries. The precedent is
`CHK_payment_logs_sign` from sub-project 2, justified there as "the
database guarantee ... independent of any service-level check". A
future write path that skips the service cannot invent a third kind
that every client then fails to render.

### 3.2 A notification is a pointer, not a copy

The row stores no message text, no bill name, no amount, and no due
date. All of it is joined at read time from `bill_instances` and
`bills`.

This is the same discipline `BillScheduler` states for overdue:
"overdue is derived at read time ... so there is no stored value that
can go stale between runs." Rename a bill and its notifications say the
new name. Edit an amount and they say the new amount. Record a partial
payment and the notification's remaining balance moves with it.

The cost is that a notification is not a historical record of exactly
what was said at the time. That is accepted: in an application whose
dashboard, badges, and calendar all derive from current state, a bell
that disagreed with them would read as a bug, not as an archive.

### 3.3 Migration

One migration file, named with a timestamp after
`1759708800000-AddPaymentLogsSignCheck`, following the house pattern:
`up()` and `down()` as raw `q.query(...)` calls, and a header comment
stating why the constraints exist rather than restating what they are.

`down()` drops the table. Because the table is new and nothing else
references it, the down path is a single `DROP TABLE`.

## 4. The reminder run

### 4.1 Separation of run from schedule

`RemindersService.run(): Promise<RunResult>` holds all the logic and
takes no clock argument — it asks `BillGeneratorService.today()`, the
same as everything else. `ReminderScheduler` does nothing but register
the cron and call `run()`.

This split exists so the integration tests in §7.1 can execute a real
run against a real database without a scheduler, a fake timer, or a
mocked clock. A test seeds instances at known offsets from
`generator.today()` and calls `run()` directly.

`RunResult` is `{ created: number; usersNotified: number; mailSent:
number; mailFailed: number }` — the shape the log line reports.

### 4.2 Schedule

**08:00 in `APP_TIMEZONE`, daily.** Registered imperatively via
`SchedulerRegistry` with a `CronJob` carrying the configured
`timeZone`, exactly as `BillScheduler` does and for the same stated
reason.

08:00 is after `BillScheduler`'s 03:00 horizon roll, so any instance
the roll materialized overnight is visible to the run on the same day.
The ordering is defensive rather than load-bearing: `BillsService`
already materializes synchronously when a bill is created.

Like `BillScheduler`, the scheduler returns immediately when
`NODE_ENV === 'test'`, and like it, it also performs one run at
application bootstrap before registering the cron (§4.5).

A throw out of the cron callback is an unhandled rejection that can
take the process down. `run()` is therefore called inside a `try`/
`catch` that logs and swallows, matching `BillScheduler.roll()`.

The **startup** call is wrapped the same way, and is made *before* the
cron is registered but in a way that cannot prevent that registration.
`BillScheduler` leaves its startup sweep unwrapped, which is defensible
there — an unmaterialized horizon means the application is serving
wrong data and failing loudly is reasonable. Here it is not: a boot-time
mail or database hiccup must not leave the process running all day with
no reminder job scheduled, which is a silent failure rather than a loud
one.

### 4.3 The statement

Selection and deduplication are one statement:

```sql
INSERT INTO "notifications" ("user_id", "bill_instance_id", "kind")
SELECT bi."user_id", bi."id", k.kind
FROM "bill_instances" bi
JOIN "users" u ON u."id" = bi."user_id"
JOIN (VALUES ($1::date, 'DUE_IN_3_DAYS'), ($2::date, 'DUE_TOMORROW'))
  AS k(due, kind) ON k.due = bi."due_date"
WHERE bi."status" <> 'PAID'
  AND (u."notify_in_app" OR u."notify_email")
ON CONFLICT ("bill_instance_id", "kind") DO NOTHING
RETURNING "id", "user_id"
```

`$1` is `addDays(asOf, 3)`, `$2` is `addDays(asOf, 1)`, both from the
existing `apps/api/src/bills/dates.ts` helpers.

Three properties of this statement are load-bearing:

1. **`UQ_notifications_instance_kind` + `ON CONFLICT DO NOTHING` is the
   entire idempotency story.** Not an application-level "have I already
   sent this?" check, which would race between two processes and would
   be wrong across a restart mid-run. The constraint holds under
   concurrency because the database enforces it.

2. **`RETURNING` yields exactly the rows that are new in this run.**
   The set of reminders to email is therefore decided by the same
   statement that decided which rows to create — not by a second
   selection that could disagree with the first about what is new. The
   digest's *contents* are then fetched by joining those returned ids
   back to `bill_instances` and `bills`, which is a projection of an
   already-fixed set rather than a second query over dates and
   statuses.

3. **`status <> 'PAID'`** rather than `status = 'UNPAID'`. A
   `PARTIALLY_PAID` instance still has a balance due and still earns a
   reminder.

The join against `users` with `(notify_in_app OR notify_email)` means a
user who wants nothing generates nothing — no rows, no work, no table
growth. Within a user who wants *something*, rows are always written;
each channel then consults its own toggle at delivery time (§4.4, §6.3).
This keeps one deduplication ledger with no holes in it, so that
switching a channel back on reveals the history rather than a void.

### 4.4 Delivery, and what failure costs

The run is two phases in a fixed order:

1. Execute the statement. Commit.
2. For each user in the `RETURNING` set whose `notify_email` is true,
   render and send one digest, each inside its own `try`/`catch`.

**Mail failure never rolls back the notification rows, and is never
retried.** A dead SMTP server costs the email and nothing else: the
in-app reminder still stands and the user sees it at next sign-in. The
failure is logged with the user id and the error.

The alternative — rolling back so tomorrow's run retries — is worse in
the exact case it is meant to help. A persistently broken mail server
would mean the rows are never created, so the bell stays empty too, and
the user loses both channels instead of one. A durable retry queue is
the correct solution to retrying, and it is out of scope: it needs its
own table, its own backoff, its own poison-message handling, and a
second scheduled job.

### 4.5 A startup run, but no backfill across days

**There is one run at application bootstrap**, before the cron is
registered, mirroring `BillScheduler`'s startup horizon sweep.

What makes this safe is `UQ_notifications_instance_kind`. A server that
already ran at 08:00 and restarts at 16:00 executes the statement
again, `ON CONFLICT DO NOTHING` suppresses every row, `RETURNING` comes
back empty, and so no rows are written and **no digest is sent to
anyone**. A crash loop costs one cheap no-op query per boot and nothing
else. A server that was down through 08:00 and comes up at 16:00, by
contrast, writes that day's reminders and sends them — which is the
only way they get sent at all.

The startup run is therefore strictly better than no startup run: it
cannot double-send, and it recovers the case where the cron was missed
entirely. The idempotency constraint is doing real work here, not just
guarding against concurrency.

**What the startup run does not do is reach backwards across days.**
`k.due = bi."due_date"` matches exact dates. If the server is down for
the whole of the day a bill's T-3 falls and comes up the next morning,
that reminder is skipped permanently; the T-1 still fires two days
later.

This is a decision, not an oversight. A catch-up that widened the scan
to a range would send a notification saying "due in 3 days" about a
bill due tomorrow — actively false, and worse than silence. Making the
kind depend on the current distance rather than on the trigger date
would collapse the two offsets into one and lose the earlier warning
entirely. Meanwhile the user who signs in is met by the dashboard's
overdue and next-7-days cards, which have no such gap because they are
computed on demand.

## 5. Mail

### 5.1 The abstraction

```ts
export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export abstract class MailTransport {
  abstract send(message: MailMessage): Promise<void>;
}
```

An abstract class rather than an interface plus a token, because Nest
can use the class itself as the injection token. One consumer
(`RemindersService`), one method, no options object.

Plain text only. An HTML body needs a template system, an escaping
story, and a multipart builder, for a message that is a list of bills
with dates and amounts.

### 5.2 Two implementations

**`LogMailTransport`** is the default. It writes the full rendered
message — recipient, subject, body — through the Nest `Logger` at
`log` level. It needs no credentials, no network, and no configuration,
so `npm start` on a fresh clone produces working reminders that a
developer can read in the terminal.

**`SmtpMailTransport`** wraps `nodemailer` (10.0.16, which ships its
own type declarations — `@types/nodemailer` is **not** a dependency; it
is at 8.x and would shadow the real ones). It is constructed from
`SMTP_URL` and sends with `MAIL_FROM` as the sender.

Selection is a factory provider in `NotificationsModule`:
`SMTP_URL` present selects SMTP, absent selects the log transport. The
choice is logged once at startup so which transport is live is never a
guess.

### 5.3 Configuration

Two additions to `apps/api/src/config/env.schema.ts`:

| Variable | Rule |
|---|---|
| `SMTP_URL` | optional; when present must parse as a URL |
| `MAIL_FROM` | optional; **required when `SMTP_URL` is present**; must look like an email address |

The conditional requirement is expressed with a `superRefine` on the
schema object, so the error names `MAIL_FROM` and says it is required
because `SMTP_URL` is set — consistent with the existing schema's
behaviour of naming every invalid variable at once rather than failing
on the first.

`SMTP_URL` can carry a password, so it is a secret and gets **no
default value**, per the standing project constraint. Its absence is
not a default — it selects a different mode. `.env.example` documents
both variables as commented-out lines, and `.env` remains gitignored.

### 5.4 The digest

One email per user per run. Eight bills newly qualifying means one
email, not eight.

The subject names the count and pluralizes correctly: `1 bill due soon`
/ `3 bills due soon`. The body greets the user by name and lists each
newly recorded reminder on its own line with the horizon in words
(`Tomorrow` / `In 3 days`), the due date, the bill name, and the amount
still outstanding — ordered by due date ascending, then bill name, so
the most urgent line is first. Amounts are formatted as currency, not
as raw numbers.

Rendering is a pure function — `renderDigest(user, items): MailMessage`
— taking already-fetched data and returning the message. It touches no
database and no clock, so §7.2 can assert its exact output.

## 6. Web and API surface

### 6.1 Contracts

New file `libs/shared-types/src/lib/notification.contracts.ts`, exported
from the barrel alongside the others.

```ts
export const NOTIFICATION_KINDS = ['DUE_IN_3_DAYS', 'DUE_TOMORROW'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/** Dates are `YYYY-MM-DD`. Money is a `number`. */
export interface NotificationItem {
  id: string;
  kind: NotificationKind;
  isRead: boolean;
  createdAt: string;        // ISO 8601 instant
  billInstanceId: string;
  billId: string;
  billName: string;
  dueDate: string;
  amountDue: number;        // amount - amount_paid, at read time
}

export interface NotificationListResponse {
  items: NotificationItem[];
  unreadCount: number;
}
```

`NOTIFICATION_KINDS` lives beside `BILL_STATUSES` in spirit but in its
own file; `enums.ts` holds the two bill enums and is left alone.

`amountDue` is the outstanding balance, not the face amount, computed
as `amount - amount_paid` in the same query that joins the row. It
passes through `Number(...)` on the way out, because `node-postgres`
returns `numeric` as a string — the behaviour sub-project 4 §3.5 had to
handle explicitly for the summary figures, for the same reason.

### 6.2 Endpoints

| Route | Behaviour |
|---|---|
| `GET /api/notifications` | newest first by `created_at DESC, id DESC`, capped at 200; returns items and `unreadCount` |
| `POST /api/notifications/:id/read` | marks one read; idempotent; 404 if the id is not this user's |
| `POST /api/notifications/read-all` | marks every unread row for this user read; returns the count affected |

All three are behind the global `JwtAuthGuard` and scope every
statement by `user_id` from the token. `unreadCount` is computed over
the user's whole table, not over the capped page, so a user with 300
unread rows sees 300 rather than 200.

`created_at DESC, id DESC` — the id tiebreak is deliberate. Two rows
from the same run share a `created_at` to the microsecond often enough
that ordering without it is unstable between requests. Sub-project 4
shipped `dueDate ASC, id ASC` for the same reason.

The 200 cap is a deliberate departure from sub-project 4 §5.3's "nothing
is paginated". The instance list is bounded by a 400-day range; this
table grows for as long as the account exists — roughly two rows per
bill per month, forever. The cap bounds the response without
introducing pagination UI. The list page states that it shows the most
recent 200 when the cap is actually hit.

There is **no DELETE**. Marking read is dismissal: it clears the badge
and greys the row. A hard delete would remove the row that
`UQ_notifications_instance_kind` relies on, so a deleted notification
would be recreated by the next run for a bill still inside its window —
the reminder would reappear, which is precisely what dismissing it was
meant to prevent.

### 6.3 The bell and the page

A toolbar bell sits left of the existing sign-out button in
`ShellComponent`, carrying a `matBadge` with the unread count. It opens
a `MatMenu` listing the five most recent notifications; a "See all"
item routes to `/notifications`.

Clicking a notification marks it read and routes to
`/upcoming?from=<dueDate>&to=<dueDate>&billId=<billId>` — reusing
sub-project 4 §5.1's URL parameters, so the notification lands the user
on exactly the row it is about rather than on a list they must then
search. A same-day `from`/`to` pair satisfies the parser's forward and
400-day checks trivially.

The `/notifications` page lists every returned item with its kind,
bill, due date, amount, and read state, plus a "Mark all read" action.
It is a lazy route inside the `authGuard`-protected parent, alongside
`dashboard` and `calendar`.

**When `notify_in_app` is false**, the bell is not rendered at all, and
`/notifications` renders an explanation with a link to `/settings`
rather than an empty list — an empty list would read as "you have no
reminders", which is false and is exactly the wrong thing to tell
someone about their bills. The route stays reachable so the link in the
explanation is not the only way back.

### 6.4 Refreshing

`NotificationsStore` fetches on shell initialization, re-fetches when
the document becomes visible again (`visibilitychange`, guarded on
`visibilityState === 'visible'`), and re-fetches after its own
mark-read mutations.

No polling timer. The event being waited on happens once a day at a
known hour; a timer would mean dozens of requests per session to catch
a single transition. The visibility hook covers the realistic failure
case — a tab left open since yesterday — for one listener.

The store fetches even when `notify_in_app` is false. The bell is
hidden by the component (§6.3), not by withholding the data: the toggle
can be changed on `/settings` in the same session, and the shell must
not need a reload to notice.

The limitation is stated rather than hidden: a tab that stays focused
across 08:00 will not show the new badge until it is backgrounded and
refocused, or navigated. That is acceptable for a daily reminder.

### 6.5 Store first-flush refactor

Sub-project 4's final review recorded that `SummaryStore` and
`InstancesStore` both rely on an Angular `effect` running its body once
on first flush regardless of dependencies, and that three separate
`whenStable()`-before-flush workarounds were written around it. It
recommended fixing the pattern before a third store copied it.

`NotificationsStore` is that third store. This sub-project therefore
changes all three to the same explicit shape: the store remembers the
last-seen value of each invalidation counter it watches and refetches
only when a counter actually differs, rather than depending on the
first-flush side effect.

This is in scope because writing `NotificationsStore` in the current
style and fixing it later costs strictly more than doing it once. It is
bounded to the invalidation mechanism in those stores; no store's
public surface changes, and no component changes.

## 7. Testing

### 7.1 API integration — where the correctness lives

Against a real database, calling `RemindersService.run()` directly:

- An unpaid instance at exactly `today + 3` produces one
  `DUE_IN_3_DAYS` row; at exactly `today + 1`, one `DUE_TOMORROW`.
- An instance at `today + 2` produces nothing. Likewise `today + 4`,
  `today`, and `today - 1`.
- **Running `run()` twice produces no second row and no second email.**
  This is the single most important test in the sub-project, and it is
  what makes the startup run of §4.5 safe. The second call must leave
  `read_at` and `created_at` on the existing rows untouched, and must
  hand the mail transport nothing at all.
- A `PAID` instance produces nothing; a `PARTIALLY_PAID` one produces a
  row.
- A user with `notify_in_app = false` and `notify_email = false`
  produces no rows, while a second user in the same run with one
  toggle on still does.
- A user with `notify_email = false` gets a row and no email; with
  `notify_in_app = false` and `notify_email = true`, a row and an email.
- Two users with qualifying instances each receive exactly one digest,
  containing only their own bills.
- A transport that throws still leaves the notification rows committed,
  and `run()` resolves rather than rejecting.

A capturing `MailTransport` test double collects messages in an array;
assertions are made against its contents.

### 7.2 API unit

- `renderDigest` output asserted exactly: subject, ordering, every
  line, and the plural/singular forms.
- Transport selection: `SMTP_URL` absent selects the log transport,
  present selects SMTP.
- `env.schema`: `SMTP_URL` without `MAIL_FROM` fails and names
  `MAIL_FROM`; both absent passes; both present passes; a malformed
  `SMTP_URL` fails.
- `ReminderScheduler` neither runs nor registers a job when
  `NODE_ENV === 'test'`; otherwise it performs one startup run and
  registers a job carrying the configured `timeZone`.
- A startup run that throws does not prevent the cron from being
  registered — one bad boot must not disable reminders until the next
  restart.
- `run()` rejecting inside the cron callback is caught and logged, not
  rethrown.

### 7.3 API e2e

Full HTTP, with auth:

- Unauthenticated requests to all three routes are rejected.
- A list request returns only the caller's rows, with correct
  `unreadCount`, when another user's rows exist.
- `POST /:id/read` on another user's notification is a 404 — the row is
  not modified and its existence is not disclosed.
- `POST /:id/read` twice is idempotent and leaves `read_at` at its
  first value.
- `read-all` clears the count and affects no other user.
- `amountDue` reflects a partial payment rather than the face amount.

### 7.4 Web

Unit and component tests for `NotificationsStore` (initial fetch,
visibility refetch, mark-read updating the count without a full
refetch, error state), the bell (badge count, hidden when
`notify_in_app` is false, menu contents capped at five, the
click-through URL it builds), and the page (list rendering, read
styling, "Mark all read", the toggles-off explanation, the cap notice).

Each store-invalidation claim is verified by breaking the mechanism and
confirming a test fails — the discipline sub-project 4 established after
the severed-counter mutation passed 7/7.

### 7.5 End-to-end

One Playwright journey.

Everything the journey needs except the clock comes from production
paths: it registers an account and creates a bill due in three days
through the UI, and `BillsService.create` materializes that instance in
the same transaction. The one thing it cannot do is wait until 08:00
for the cron, so the notification row is inserted directly.

That needs a new helper, `apps/web-e2e/src/support/seed.ts`, exposing
`seedNotification(email, kind)`. It opens a TypeORM `DataSource` against
`E2E_DATABASE_URL` — the same constant and the same mechanism
`global-setup.ts` already uses — finds the named user's bill instance
at the matching offset, inserts one `notifications` row, and closes the
connection. `bootstrap-db` is **not** the right home for it: that script
runs once before the suite to create and migrate the database, not
per-test.

The helper deliberately does **not** reuse or re-state the statement
from §4.3. It inserts a single row by id, so it cannot accidentally
become a second implementation of the selection logic that then agrees
with a broken original.

The journey then proves: badge shows the unread count → bell opens →
the item names the right bill → clicking it lands on `/upcoming`
filtered to that instance → the badge has decremented → "Mark all
read" on `/notifications` clears it.

## 8. Review focus

Five things the spec implies that are most likely to bite a user, each
owned by a test above:

1. **Double-send.** Two processes, a restart mid-run, or a manual
   re-run must not produce a second reminder or a second email
   (§4.3, §7.1).
2. **Cross-user leakage.** Every statement in `NotificationsService`
   and in the run must be scoped by `user_id`; the join through
   `bill_instances` is not a substitute (§6.2, §7.3).
3. **A failing mail server silently disabling the bell.** The ordering
   in §4.4 is what prevents this, and §7.1 pins it.
4. **The toggles-off empty state lying.** Rendering "no reminders" to
   someone who has reminders turned off is the wrong sentence (§6.3).
5. **`numeric` arriving as a string.** `amountDue` rendering as
   `"45.00"` concatenated rather than summed — the `Number(...)`
   conversion sub-project 4 §3.5 had to make explicit (§6.1).

## 9. Open items

- Mail deliverability — SPF, DKIM, a real provider, bounce handling —
  is deployment configuration, not application design. `SMTP_URL` is
  the whole seam.
- A tab focused across 08:00 shows a stale badge until it is
  backgrounded and refocused (§6.4).
- Notification rows accumulate for the life of the account with no
  pruning. At roughly two rows per bill per month this is years away
  from mattering, and the 200 cap bounds every response regardless.
- This is the last sub-project in the decomposition. Nothing is
  deferred past it.
