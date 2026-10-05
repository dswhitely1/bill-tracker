# Design: Bills API (Sub-project 2)

**Status:** approved
**Date:** 2026-10-05
**Predecessor:** `docs/superpowers/specs/2026-10-04-api-foundation-design.md`

---

## 1. Purpose

Build the bills half of the API: bill templates, the recurrence instance
generator, per-occurrence state, and payment history. The deliverable is
an API a client can build a bill list, a calendar, and a dashboard
against.

This specification is the binding authority for its implementation plan.
Where it contradicts the foundation spec, section 2 says so explicitly
and this document wins; everywhere else the foundation spec still holds.

### Success criteria

- A user creates a recurring bill and immediately has occurrences
  materialized to a rolling 12-month horizon.
- Re-running the generator changes nothing. It is idempotent by
  construction, not by convention.
- A user can pay a bill in full in one call with an empty body, or in
  parts across several calls, and the recorded total is always the sum
  of an append-only log.
- Un-marking a payment is possible and leaves the history intact.
- One user can never read or alter another user's bills, instances, or
  payments through any route.

### Non-goals

- Dashboard aggregate endpoints (sub-project 4, with the views they feed).
- Notifications and reminder scheduling (sub-project 5).
- Any Angular work (sub-projects 3 and 4).
- Overpayment as a tracked credit, multi-currency, attachments, or
  shared/household bills.

---

## 2. Amendments to the foundation spec

Two decisions recorded in the foundation spec are superseded here. Both
follow from the decision to support partial payments. Neither table has
been migrated yet, so the schema cost is zero; the enum change is a real
edit to committed code in `libs/shared-types`, made now because no client
consumes it yet.

### 2.1 `BillStatus` loses `OVERDUE`

The foundation spec fixed `BillStatus` as
`UNPAID | PAID | OVERDUE`. That conflates two independent axes — how much
of the bill is paid, and whether it is late. With partial payments the
conflation has no correct resolution: a half-paid bill two days late
cannot pick a value.

**Stored status covers payment progress only:**

| Value | Meaning |
|---|---|
| `UNPAID` | `amount_paid <= 0` |
| `PARTIALLY_PAID` | `0 < amount_paid < amount` |
| `PAID` | `amount_paid >= amount` |

**Overdue is derived and never stored:**

```
is_overdue  :=  status <> 'PAID' AND due_date < today
```

This is a strict improvement beyond the enum. It **removes the nightly
overdue sweep entirely** — the `UPDATE ... WHERE due_date < CURRENT_DATE`
job the foundation spec described does not exist. There is consequently
no window in which a row is stale because the job has not fired, and no
question of which timezone the server held when it wrote the value.
Overdue becomes a predicate evaluated at read time against the index
`(user_id, status, due_date)` that the foundation spec already specified.

`OVERDUE` survives as **query vocabulary**: `GET /api/bill-instances`
accepts `?overdue=true|false`, and every instance response carries a
derived `isOverdue` boolean. Clients get one flag to render; the database
stores one fact.

### 2.2 `bill_instances` gains two columns

- `amount_paid numeric(12,2) NOT NULL DEFAULT 0` — the cached sum of the
  instance's payment log. Cached so that `status` remains a stored,
  indexed column; recomputed from the log inside every payment
  transaction so it cannot drift.
- `is_customized boolean NOT NULL DEFAULT false` — set when a user edits
  the instance directly. It is the marker that protects an instance from
  being rewritten when its template changes.

### 2.3 Closed open items

Both items the foundation spec deferred to this sub-project are resolved
here: template-edit semantics in section 5.4, and the `DELETE
/api/categories/:id` conflict in section 7.4.

---

## 3. Schema

Migrated by a single migration, `AddBillTables<timestamp>`, following the
raw-SQL style of `1759536000000-InitialSchema.ts`. `synchronize` stays
`false` in every environment.

### `bills` (template)

```sql
CREATE TABLE "bills" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"        uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "category_id"    uuid REFERENCES "categories"("id") ON DELETE SET NULL,
  "name"           varchar(100) NOT NULL,
  "default_amount" numeric(12,2) NOT NULL,
  "frequency"      varchar(20) NOT NULL,
  "start_date"     date NOT NULL,
  "end_date"       date,
  "is_active"      boolean NOT NULL DEFAULT true,
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  "updated_at"     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CHK_bills_frequency"
    CHECK ("frequency" IN ('ONE_TIME','WEEKLY','MONTHLY','ANNUALLY')),
  CONSTRAINT "CHK_bills_default_amount" CHECK ("default_amount" > 0),
  CONSTRAINT "CHK_bills_end_date"
    CHECK ("end_date" IS NULL OR "end_date" >= "start_date")
);
CREATE INDEX "IDX_bills_user_id" ON "bills" ("user_id");
```

`category_id` is `ON DELETE SET NULL` rather than `CASCADE`: deleting a
category must never delete bills. Section 7.4 makes that deletion a 409
anyway, but the constraint is the backstop if a path is ever added.

### `bill_instances`

```sql
CREATE TABLE "bill_instances" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "bill_id"       uuid NOT NULL REFERENCES "bills"("id") ON DELETE CASCADE,
  "user_id"       uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "due_date"      date NOT NULL,
  "amount"        numeric(12,2) NOT NULL,
  "amount_paid"   numeric(12,2) NOT NULL DEFAULT 0,
  "status"        varchar(20) NOT NULL DEFAULT 'UNPAID',
  "is_customized" boolean NOT NULL DEFAULT false,
  "paid_at"       timestamptz,
  "note"          varchar(255),
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_bill_instances_bill_due" UNIQUE ("bill_id","due_date"),
  CONSTRAINT "CHK_bill_instances_status"
    CHECK ("status" IN ('UNPAID','PARTIALLY_PAID','PAID')),
  CONSTRAINT "CHK_bill_instances_amount" CHECK ("amount" > 0)
);
CREATE INDEX "IDX_bill_instances_user_due"
  ON "bill_instances" ("user_id","due_date");
CREATE INDEX "IDX_bill_instances_user_status_due"
  ON "bill_instances" ("user_id","status","due_date");
CREATE INDEX "IDX_bill_instances_bill_id" ON "bill_instances" ("bill_id");
```

`UNIQUE (bill_id, due_date)` is what makes the generator idempotent, and
what makes concurrent generation from two processes safe.

`user_id` is deliberately denormalized, as the foundation spec decided,
so ownership checks and range queries need no join through `bills`.

No `CHECK` constrains `amount_paid` against `amount`: a reversal
transiently makes the arithmetic non-obvious, and overpayment is rejected
in the service (section 6.2), where the error message can be useful.

### `payment_logs`

```sql
CREATE TABLE "payment_logs" (
  "id"                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "bill_instance_id"     uuid NOT NULL
                           REFERENCES "bill_instances"("id") ON DELETE CASCADE,
  "user_id"              uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "amount_paid"          numeric(12,2) NOT NULL,
  "paid_at"              timestamptz NOT NULL,
  "note"                 varchar(255),
  "reverses_payment_id"  uuid REFERENCES "payment_logs"("id") ON DELETE CASCADE,
  "created_at"           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "CHK_payment_logs_amount_nonzero" CHECK ("amount_paid" <> 0)
);
CREATE INDEX "IDX_payment_logs_instance" ON "payment_logs" ("bill_instance_id");
CREATE INDEX "IDX_payment_logs_user_paid_at" ON "payment_logs" ("user_id","paid_at");
CREATE UNIQUE INDEX "UQ_payment_logs_reverses"
  ON "payment_logs" ("reverses_payment_id")
  WHERE "reverses_payment_id" IS NOT NULL;
```

The partial unique index is the database-level guarantee that a payment
can be reversed at most once, independent of any service check.

### Type decisions carried forward

- Money is `numeric(12,2)` with an explicit TypeORM `ValueTransformer`
  to `number`, **introduced here** — sub-project 1 had no money columns,
  so no such transformer exists yet. Without it `node-postgres` returns
  every amount as a string and it reaches the client as `"142.00"`.
  Never floating point.
- **`date` columns are `string` in TypeScript**, in `YYYY-MM-DD` form,
  end to end — entity, DTO, response. They are never converted to
  `Date`. A `Date` carries an instant and a timezone; a due date is a
  calendar day, and every conversion is a chance to shift it by one.
- Enums stay `varchar` + `CHECK`, with the TypeScript union in
  `libs/shared-types` as the single source of truth.

---

## 4. Dates and "today"

All date arithmetic goes through one module, `apps/api/src/bills/dates.ts`,
with no other file computing a date.

**`APP_TIMEZONE`** is a new environment variable: an IANA timezone name,
defaulting to `UTC`, validated in `env.schema.ts` by attempting to
construct an `Intl.DateTimeFormat` with it and failing startup if it
throws. A fixed-UTC server marks a US bill overdue the previous evening;
a configured zone is the honest fix and keeps the whole app on one clock.

The module exports:

- `today(tz: string): string` — the current date in that zone as
  `YYYY-MM-DD`, via `Intl.DateTimeFormat` with `en-CA` formatting.
- `addMonths(date: string, n: number): string` — **clamped to month end
  without drift.** The day component is `min(anchorDay, daysInMonth)`
  computed from the *anchor*, never from the previous result. A bill
  starting Jan 31 yields Feb 28, then **Mar 31** — not Mar 28.
- `addWeeks`, `addYears`, `compare`, `daysInMonth` as needed.

Leap years follow from `daysInMonth`: Feb 29 exists in 2028, and a
Jan 31 anchor yields Feb 29 that year.

---

## 5. The generator

`BillGeneratorService` owns every write to `bill_instances` that is not a
direct user edit or a payment.

### 5.1 The occurrence sequence

For a bill, the occurrence sequence is defined from `start_date`:

- `ONE_TIME` — exactly one occurrence, at `start_date`.
- `WEEKLY` — `start_date + 7n` days.
- `MONTHLY` — `addMonths(start_date, n)`, clamped per section 4.
- `ANNUALLY` — `addYears(start_date, n)`, clamped (Feb 29 anchors to
  Feb 28 in common years).

### 5.2 Which occurrences are materialized

Let `T` = `today(APP_TIMEZONE)` and `H` = `addMonths(T, 12)`, the horizon.

> Materialize every occurrence `O` where `O >= floor` and `O <= H`
> and (`end_date` is null or `O <= end_date`), where **`floor` is the
> latest occurrence on or before `T`, or the first occurrence if every
> occurrence is in the future.**

One rule, uniform across all four frequencies. It is exactly "current
period forward": entering a monthly bill on the 20th still produces this
month's occurrence on the 15th — overdue, which is true — but does not
manufacture twenty months of fictional backlog.

`ONE_TIME` falls out of the same rule with no special case: its single
occurrence is always the floor, so a one-time bill entered with a past
date still produces its instance rather than silently producing nothing.
By the same rule, a bill whose occurrences have *all* passed — an
`end_date` already behind us — materializes only its final occurrence.

A bill with `is_active = false` materializes nothing.

New instances take `amount = bills.default_amount`, `status = 'UNPAID'`,
`amount_paid = 0`, `is_customized = false`.

### 5.3 Idempotency and triggers

Insertion uses `INSERT ... ON CONFLICT ("bill_id","due_date") DO NOTHING`.
Re-running the generator is a no-op, including when two processes run it
at the same moment.

It runs:

- on `POST /api/bills`, synchronously, so the response is followed by a
  populated calendar;
- on `PATCH /api/bills/:id`, as part of the rewrite (5.4);
- at application startup, for every active bill;
- nightly at 03:00 in `APP_TIMEZONE`, via `@nestjs/schedule`'s `@Cron`
  with its `timeZone` option — the job that rolls the horizon forward.

`@nestjs/schedule` is a new dependency, arriving one sub-project earlier
than the foundation spec anticipated.

**Startup generation and the cron are both registered only when
`NODE_ENV !== 'test'`.** A cron firing mid-suite is nondeterminism in
every other test. Tests call `BillGeneratorService` explicitly, which is
also the only way the generator is directly asserted.

No HTTP endpoint triggers generation.

### 5.4 Template edits: the rewrite rule

> An instance is **rewritable** when
> `due_date > today AND status = 'UNPAID' AND amount_paid = 0
> AND is_customized = false`.
> Template changes rewrite rewritable instances and touch nothing else.

`PATCH /api/bills/:id` accepts `name`, `categoryId`, `defaultAmount`,
`frequency`, `startDate`, `endDate`, and `isActive` — every field of the
template. It recomputes the target occurrence set, then in one
transaction:

1. deletes rewritable instances whose `due_date` is not in the target set;
2. updates `amount` on rewritable instances whose `due_date` *is* in the
   target set — preserving their ids, so a client holding one does not
   get a 404;
3. inserts the target dates that are not yet present.

`due_date > today`, strictly — not `>=`. An occurrence that is already
due was billed at the old amount, and that is a historical fact. The
escape hatch for a genuine typo is `PATCH /api/bill-instances/:id`, which
edits that one occurrence directly.

Setting `is_active = false` is the same transaction with an empty target
set: future rewritable instances are removed so they stop cluttering the
calendar, and every paid, partially paid, or customized row survives.
Setting it back to `true` regenerates.

---

## 6. Payments

`payment_logs` is the append-only truth. `bill_instances.amount_paid`,
`.status`, and `.paid_at` are a cache of it.

### 6.1 The transaction

Every payment write runs in one transaction that:

1. loads the instance `WHERE id = :id AND user_id = :userId` with
   `pessimistic_write` (`SELECT ... FOR UPDATE`), 404 if absent;
2. validates (6.2);
3. inserts the log row;
4. recomputes `amount_paid` as `SUM(payment_logs.amount_paid)` over the
   instance — **recomputed from the log, never incremented**, so the
   cache cannot drift from its source;
5. derives `status` per the table in section 2.1;
6. sets `paid_at` to the `paid_at` of the row that brought the total to
   full, or `NULL` when the total no longer covers the amount.

This mirrors the locking discipline established for refresh-token
rotation in sub-project 1: lock first, decide inside, and draw no second
connection from the pool while holding the lock.

### 6.2 Validation

- A payment's `amount`, when supplied, must be `> 0`.
- **`amount` omitted means the full remaining balance**
  (`amount - amount_paid`), so one-click "mark paid" is this endpoint
  with an empty body.
- A payment exceeding the remaining balance is **400**, naming the
  balance. Overpayment is not silently accepted and not tracked as a
  credit.
- A payment against an already-`PAID` instance is 400 by the same rule,
  its balance being zero.
- `paidAt` defaults to now, and may be backdated.

### 6.3 Reversal

`POST /api/bill-instances/:id/payments/:paymentId/reverse` appends a row
whose `amount_paid` is the exact negation of the target's, with
`reverses_payment_id` set and `paid_at` of now. Nothing is ever deleted
or mutated.

- 404 if the payment does not exist, belongs to another user, or belongs
  to a different instance.
- 409 if it is already reversed (the partial unique index enforces this
  regardless).
- 409 if the target is itself a reversal. Reversals are not reversible;
  to undo one, record a new payment.

`POST /api/bill-instances/:id/unpay` reverses every unreversed positive
payment on the instance in a single transaction — the misclick button.
It is sugar over the same primitive, not a second mechanism. 409 when
there is nothing to reverse.

---

## 7. API surface

All routes are under the global `/api` prefix and require a bearer token;
the global `APP_GUARD` from sub-project 1 is unchanged and nothing here
is `@Public()`. Every query filters by the authenticated `userId`, and
**a resource belonging to another user returns 404, never 403** — the
existence of another user's data is not disclosed.

Error bodies follow the foundation spec's section 10 format unchanged.

### 7.1 Bills

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/bills` | `?isActive=` optional; ordered by name |
| `POST` | `/api/bills` | 201; generates instances synchronously |
| `GET` | `/api/bills/:id` | 404 if not owned |
| `PATCH` | `/api/bills/:id` | rewrites per 5.4 |
| `DELETE` | `/api/bills/:id` | 204; cascades instances and logs |

`DELETE` is a real delete, cascading through `bill_instances` and
`payment_logs` by the foreign keys. The non-destructive path is
`PATCH { isActive: false }`, which stops generation and keeps every
record; the README documents the distinction.

Validation: `name` 1–100 chars; `defaultAmount` `> 0` and
`<= 9999999999.99` (the column's capacity — the DTO bound exists so an
oversized value is a 400 rather than a numeric-overflow 500);
`frequency` one of the four; `startDate` a valid `YYYY-MM-DD`;
`endDate` null or `>= startDate`; `categoryId` null or a category owned
by the same user, 400 otherwise.

### 7.2 Bill instances

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/bill-instances` | see below |
| `GET` | `/api/bill-instances/:id` | |
| `PATCH` | `/api/bill-instances/:id` | `amount`, `note`; sets `isCustomized` |
| `GET` | `/api/bill-instances/:id/payments` | oldest first |

`GET /api/bill-instances` **requires `from` and `to`**, both
`YYYY-MM-DD`, with `to >= from` and a span of at most 400 days. The
bounded range is the pagination; there is no cursor. Optional
`status=UNPAID|PARTIALLY_PAID|PAID`, `overdue=true|false` (where
`false` means `status = 'PAID' OR due_date >= today`, the exact negation),
`billId=<uuid>`. Ordered by `due_date`, then `id` for stability.

`PATCH` accepts `amount` and `note` only. **`dueDate` is not editable.**
Vacating a date would let the generator re-create it on the next run,
and moving an occurrence is covered by editing the template. `amount`
must stay `> 0` and `>= amount_paid`, so an edit cannot strand an
instance above its own payments. Any successful `PATCH` sets
`is_customized = true` and recomputes `status`, since lowering the
amount can complete a bill and raising it can un-complete one.

### 7.3 Payments

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/bill-instances/:id/payments` | 201; `{amount?, paidAt?, note?}` |
| `POST` | `/api/bill-instances/:id/payments/:paymentId/reverse` | 201 |
| `POST` | `/api/bill-instances/:id/unpay` | 200; returns the instance |

All three return the updated instance alongside the log row, so a client
never needs a follow-up read to refresh its row.

### 7.4 Categories (amendment)

`DELETE /api/categories/:id` returns **409** when any bill references the
category, with a message naming the count. This closes the foundation
spec's open item. `GET /api/categories` is unchanged.

---

## 8. Contracts

`libs/shared-types` gains `bill.contracts.ts`, exported from `index.ts`
with the `.js` specifier that `nodenext` requires. `enums.ts` changes:

```ts
export const BILL_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];
```

`BILL_FREQUENCIES` is unchanged. New interfaces: `BillResponse`,
`CreateBillRequest`, `UpdateBillRequest`, `BillInstanceResponse`,
`UpdateBillInstanceRequest`, `PaymentLogResponse`,
`RecordPaymentRequest`, `PaymentResultResponse`.

`BillInstanceResponse` carries `isOverdue: boolean`, derived per 2.1, and
`amountPaid`. Money crosses the wire as `number`; dates as `YYYY-MM-DD`
strings; timestamps as ISO 8601.

---

## 9. Module layout

```
apps/api/src/bills/
  bills.module.ts
  bill.entity.ts
  bill-instance.entity.ts
  payment-log.entity.ts
  dates.ts                   pure date arithmetic, no I/O
  occurrences.ts             pure: bill -> occurrence dates
  bill-generator.service.ts  materializes and rewrites
  bills.service.ts           template CRUD
  bills.controller.ts
  bill-instances.service.ts  queries and direct edits
  bill-instances.controller.ts
  payments.service.ts        the payment transaction
  payments.controller.ts
  dto/
```

`dates.ts` and `occurrences.ts` are pure functions with no repository,
clock, or config dependency — the clock is passed in as `today`. They
hold the logic most likely to be wrong and are the cheapest thing in the
sub-project to test exhaustively.

Three controllers rather than one: templates, instances, and payments
have different route roots and different failure modes.

---

## 10. Testing

Following sub-project 1's strategy and its test database conventions
(`.env.test`, `truncateAll()` with its `_test` suffix guard,
`fileParallelism: false`, the shared `configureApp`).

**Unit (pure, no database):**

- `addMonths` clamping: Jan 31 → Feb 28 → **Mar 31**, proving no drift;
  Feb 29 in a leap year; Jan 31 → Feb 29 in 2028.
- The occurrence sequence for each of the four frequencies, including
  `end_date` truncation and a horizon cutoff.
- The floor rule: a bill started in the past produces the current
  period's occurrence and nothing earlier; a future-dated bill produces
  its first occurrence; a past `ONE_TIME` still produces its instance.
- Status derivation across the boundaries: 0, a cent under, exact,
  and after a reversal returns the total to 0.

**Integration (database):**

- Running the generator twice inserts nothing the second time.
- The rewrite predicate: construct one instance of each kind — paid,
  partially paid, customized, past-due, and plain future unpaid — edit
  the template, and assert that exactly one row changed.
- Concurrent generation from two connections violates no constraint.
- The payment transaction under concurrent writes to one instance leaves
  `amount_paid` equal to the log's sum.

**End-to-end:**

- Every route in section 7, each in its success and its 404 form.
- **Ownership isolation on every `:id` route**: a second user's token
  receives 404, never 403 and never data. This is the single most
  important e2e assertion in the sub-project.
- Partial payment flow: pay part, assert `PARTIALLY_PAID`; pay the rest
  with an empty body, assert `PAID` and `paidAt`; reverse one, assert
  the status walks back and the log retains all three rows.
- Overpayment is 400; double reversal is 409; `unpay` with no payments
  is 409.
- `DELETE /api/categories/:id` is 409 while a bill references it.
- A journey test: register → create category → create monthly bill →
  list instances for a range → pay partially → pay the remainder →
  reverse → confirm the instance and its log agree.

The existing `schema.int-spec.ts` is extended to assert the new tables,
constraints, and indexes exist after migration.

---

## 11. Risks

- **The floor rule and the clamping rule are the two places a subtle
  error hides.** Both are pure functions, tested exhaustively, for
  exactly that reason.
- **The rewrite predicate has four conditions and a strict `>`.** A
  single wrong operator silently destroys user data — a paid instance
  deleted on a template edit. Its integration test constructs every
  protected kind at once rather than testing the conditions separately.
- **`amount_paid` is a cache.** Recomputing it from the log in the same
  transaction, rather than incrementing, is what keeps a lost update
  from becoming a wrong balance.
- Changing `BILL_STATUSES` is a wire-format change. Nothing consumes it
  today; sub-project 3 will be written against the amended shape.
