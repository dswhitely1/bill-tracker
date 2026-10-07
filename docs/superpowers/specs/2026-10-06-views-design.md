# Design: Views (Sub-project 4)

**Date:** 2026-10-06
**Sub-project:** 4 of 5
**Depends on:** `2026-10-04-api-foundation-design.md`,
`2026-10-05-bills-api-design.md`, `2026-10-06-angular-shell-design.md`

## 1. Goal and non-goals

### Goal

Give the user the two things the shipped application cannot answer at a
glance: *how much do I owe right now*, and *what does this month look
like laid out on a calendar*. Then make the instance list navigable —
sortable, searchable, and linkable — so the answers on the dashboard lead
somewhere.

Success criteria:

- A single request answers "what do I owe", correctly, including debt
  older than any window the client can fetch.
- Every figure on the dashboard is reachable: clicking it lands on the
  list of rows that produced it.
- A month view shows what falls on each day and lets the user pay from
  there without going somewhere else first.
- A filtered list can be bookmarked, shared, and restored by reload.
- No date value in the client is produced by passing a `YYYY-MM-DD`
  string to `new Date()`. This constraint carries forward from
  sub-project 3 unchanged.

### Non-goals

Saved views — named, persisted filter sets — are dropped. The foundation
spec's decomposition parked them here; they need a table, a migration,
CRUD, and UI for a feature nobody has asked for, and URL-backed filters
(§5) make any view bookmarkable without them. An amount-range filter is
dropped for the same reason. Server-side sorting is dropped because
nothing is paginated (§5.3). Notification delivery remains sub-project 5.

No change is made to `GET /api/bill-instances`. Its three filter
parameters, its 400-day range cap, and its `dueDate ASC, id ASC`
ordering are all left exactly as sub-project 2 shipped them.

## 2. Context and scope

The foundation spec's decomposition (§2) assigns this sub-project
"dashboard summary cards, calendar view, filtering and sorting".
Sub-project 3 deliberately took part of that: `/upcoming` already filters
by `status`, `overdue`, and `billId`, because an instance list with no way
to hide paid rows is not usable. The Angular shell spec (§1) records the
remainder as this sub-project's: "sorting, saved views, and any filtering
beyond the three parameters", plus the dashboard and the calendar. The
bills-API spec (§ non-goals) separately parked "dashboard aggregate
endpoints (sub-project 4, with the views they feed)".

This is therefore the first sub-project since the first to span both the
API and the web application, and that was the plan rather than scope
creep.

### Deliverables

| Area | Deliverable |
|---|---|
| Contracts | `summary.contracts.ts` in `libs/shared-types` |
| API | `summary` module: controller, service, response mapper |
| Web | `/dashboard` — four summary cards, becomes the default route |
| Web | `/calendar` — month grid with day drill-down |
| Web | `/upcoming` — URL-backed filter state, sorting, name and category filters |
| Web | `SummaryApi`, `SummaryStore`, calendar grid builder, filter/sort module |

## 3. The summary endpoint

### 3.1 Contract

New file `libs/shared-types/src/lib/summary.contracts.ts`, re-exported
from `libs/shared-types/src/index.ts`:

```ts
export interface SummaryBucket {
  count: number;
  amount: number;
}

export interface OverdueSummary extends SummaryBucket {
  /**
   * The due date of the oldest unpaid overdue instance, or null when
   * there are none. Exists so the dashboard's link into /upcoming can
   * target a range that actually contains every row the figure counted.
   */
  earliestDueDate: string | null;
}

export interface CategorySummary {
  /** null means the bill has no category. */
  categoryId: string | null;
  categoryName: string | null;
  color: string | null;
  total: number;
  paid: number;
}

export interface SummaryResponse {
  /** The server's calendar day under APP_TIMEZONE. Everything is relative to it. */
  asOf: string;
  overdue: OverdueSummary;
  thisMonth: { count: number; total: number; paid: number };
  next7Days: SummaryBucket;
  byCategory: CategorySummary[];
}
```

`GET /api/summary` takes no parameters and returns `SummaryResponse`. It
is guarded like every other authenticated route and scoped to the
requesting user.

### 3.2 `asOf` comes from the application, not the database

`SummaryService` obtains the current day from
`BillGeneratorService.today()`, which is commented in the shipped code as
"the single point where the application asks what day it is" and which
resolves `APP_TIMEZONE`. It is then passed into every query as a bound
parameter.

Postgres `CURRENT_DATE` must not be used. It answers in the database
session's time zone, which `APP_TIMEZONE` does not control. When the two
disagree — and near midnight in any non-UTC deployment they will — the
dashboard's overdue total contradicts the overdue badge that
`BillInstancesService.findAll` puts on the very same rows. Two numbers
derived from one dataset disagreeing by a day is the kind of defect that
makes a user stop trusting every other number on the page.

`asOf` is returned in the response so the UI can label the figures and so
tests can pin the relationship between a stubbed clock and the output.

### 3.3 Bucket definitions

Let `asOf` be the day from §3.2. All comparisons are on `due_date`, a
`date` column compared against a `YYYY-MM-DD` bound parameter — string
comparison on ISO dates, never a timestamp cast.

| Bucket | Rows | `count` | `amount` / `total` |
|---|---|---|---|
| `overdue` | `status <> 'PAID' AND due_date < asOf` | row count | `SUM(amount - amount_paid)` |
| `next7Days` | `status <> 'PAID' AND due_date BETWEEN asOf AND asOf + 6` | row count | `SUM(amount - amount_paid)` |
| `thisMonth` | every instance whose `due_date` falls in `asOf`'s calendar month, any status | row count | `total = SUM(amount)`, `paid = SUM(amount_paid)` |

`overdue` has no lower bound. That is the whole reason the endpoint
exists: `isOverdue` is derived as `status !== 'PAID' && dueDate < today`
with no floor, so an unpaid instance from eight months ago is overdue
today, and a client aggregating the rows `/upcoming` already fetched
would silently under-report exactly when the figure matters most.

`next7Days` is seven days wide and includes `asOf` itself. It is
disjoint from `overdue` by construction: one is strictly before `asOf`,
the other starts at `asOf`.

The two debt buckets sum the **unpaid remainder**, not the face amount. A
`PARTIALLY_PAID` instance of 100.00 with 40.00 recorded contributes
60.00. Summing `amount` would overstate the debt by every partial payment
ever made. `thisMonth` is the deliberate exception: it is a progress
figure, so it reports `total` and `paid` side by side and includes `PAID`
rows, which the debt buckets exclude.

`byCategory` covers the same row set as `thisMonth` — the current
calendar month, every status — grouped by the owning bill's
`category_id`, reporting `SUM(amount)` as `total` and
`SUM(amount_paid)` as `paid`. Bills with no category group under a single
row with `categoryId: null` and `categoryName: null`; the client renders
that row as "Uncategorized". Rows are ordered by `total` descending, then
`categoryName` ascending, so the output is stable across requests.

### 3.4 Queries

`bill_instances.user_id` is denormalized (`bill-instance.entity.ts`
documents this as a conscious trade-off), so the three scalar buckets
need no join at all — they filter on `user_id` directly and are served by
the existing `['userId', 'status', 'dueDate']` index. Only `byCategory`
joins: `bill_instances` → `bills` for `category_id`, then a left join to
`categories` for name and colour.

Two statements, both parameterized by `userId` and `asOf`:

1. One scalar query producing all three buckets with aggregate `FILTER`
   clauses, so the table is scanned once rather than three times.
2. One grouped query for `byCategory`.

`earliestDueDate` is `MIN(due_date) FILTER (WHERE status <> 'PAID' AND
due_date < :asOf)` inside the first query — no extra round trip.

### 3.5 Two Postgres behaviours that must be handled explicitly

**`SUM` over zero rows returns `NULL`, not `0`.** A brand-new user with
no bills, or any user with an empty bucket, produces `NULL` for every
sum. Uncoalesced, the dashboard renders `null` or `NaN` where it should
render `$0.00`. Every aggregate is wrapped in `COALESCE(..., 0)`.

**`numeric` columns arrive from `pg` as strings.** The entity's
`numericTransformer` converts them for ordinary entity reads, but raw
aggregate queries bypass transformers entirely. Every figure is converted
with `Number(...)` in the response mapper. Shipped without this, `total`
would serialize as `"1234.00"` and the client's arithmetic would
concatenate rather than add.

Both get direct tests (§7.1) rather than being trusted to review.

### 3.6 Scoping

Every query filters on the requesting user. An aggregate that leaks is
worse than a list that leaks: it surfaces another person's finances as a
single plausible-looking number that nothing on the page contradicts. A
two-user e2e test asserts that one user's bills contribute nothing to the
other's totals (§7.1).

### 3.7 Empty state

A user with no bills receives `200` with all counts and amounts at zero,
`earliestDueDate: null`, and `byCategory: []`. Not a 404, not an error.

## 4. The dashboard

### 4.1 `SummaryStore`

A signal store in a plain service, following the pattern the three
shipped stores already use: `loading`, `error`, and `loaded` signals, a
`reset()` driven by an `effect` on `SessionService.isAuthenticated`, and
`isEmpty` as `computed(() => loaded() && ...)`.

It invalidates on **both** `BillsStore.mutations` and
`PaymentsService.mutations`. Recording a payment moves all four cards;
creating, editing, or deleting a bill moves at least three. A dashboard
that still shows the pre-payment overdue total after the user pays is
worse than no dashboard, because it looks authoritative.

### 4.2 Cards

Four `mat-card`s at `/dashboard`:

| Card | Shows | Links to |
|---|---|---|
| Overdue | `overdue.count` and `overdue.amount` | `/upcoming` filtered to overdue (§4.3) |
| Due this month | `thisMonth.total`, with `thisMonth.paid` as an amount and a proportion | `/upcoming` for the current month |
| Next 7 days | `next7Days.count` and `next7Days.amount` | `/upcoming` for `asOf`..`asOf + 6` |
| This month by category | One row per `CategorySummary`, each with its stored colour | `/upcoming` for the month, filtered to that `categoryId` |

Amounts render through the shipped `formatMoney` helper. Dates in link
parameters are produced by the `calendar-date` module.

The by-category rows are drill-down links because a category filter
exists (§5.3). That filter is client-side over rows already loaded and
costs no API change, which is what makes the card's rows clickable rather
than merely informational.

### 4.3 The overdue link, and the range cap

The overdue figure is all-time, but `/upcoming` refuses a range wider
than 400 days (`MAX_RANGE_DAYS`, enforced on both sides). On a long
neglected ledger the card could therefore promise one total while the
list it opens shows a smaller one.

The link targets `from = max(overdue.earliestDueDate, asOf - 400)` and
`to = asOf`, with `overdue=true`. For any user whose oldest unpaid bill
falls inside 400 days — which is every realistic user — the link is
exact. When `earliestDueDate` is older than that, `/upcoming` renders a
disclosure line stating that rows older than the start of the range are
not shown and naming the full figure.

The rejected alternative was bounding the card to 400 days so the link
would always match. That would discard the correctness argument that
justified building the endpoint: the all-time figure is the one the user
needs.

When `overdue.count` is zero the card is not a link.

## 5. `/upcoming`: URL state, sorting, filtering

### 5.1 Query parameters as the source of truth

`/upcoming` currently holds its filters in component signals with no
router involvement. They move into the URL:

| Parameter | Values | Default |
|---|---|---|
| `from`, `to` | `YYYY-MM-DD` | current calendar month |
| `status` | `UNPAID`, `PARTIALLY_PAID`, `PAID` | absent — any |
| `overdue` | `true`, `false` | absent — any |
| `billId` | UUID | absent — any |
| `categoryId` | UUID, or `none` for uncategorized | absent — any |
| `q` | free text | absent |
| `sort` | `dueDate`, `amount`, `name`, `status` | `dueDate` |
| `dir` | `asc`, `desc` | `asc` |

The component reads `ActivatedRoute.queryParamMap` as the single source
of truth and derives its form state from it; controls write back by
navigating. Nothing is stored in two places.

**Unknown and malformed values fall back to their defaults** rather than
reaching the API or throwing: `?status=BANANA`, `?from=2026-13-45`,
`?sort=nonsense`, `?overdue=maybe`, a non-UUID `billId`. A URL is user
input and arrives from bookmarks, link rot, and hand-editing. Parsing is
a pure function with its own tests (§7.2).

`categoryId=none` encodes "bills with no category", which is a real
filter distinct from "any category" and cannot be expressed by an empty
value.

### 5.2 `replaceUrl`, and what it costs

Filter changes navigate with `replaceUrl: true`. The text search
additionally debounces 200ms before navigating.

The trade-off, stated plainly: Back from `/upcoming` returns to
`/dashboard` rather than stepping backwards through the user's last six
filter adjustments. That is the better behaviour — pushing a history
entry per keystroke turns Back into a per-character undo — but it does
mean filter changes are not individually undoable. Bookmarking, sharing,
and reload all preserve filters, which is what the dashboard links need.

### 5.3 Client-side sorting and filtering

`sort`/`dir`, `q`, and `categoryId` are applied as computed signals over
the rows already in `InstancesStore`. None of them issues a request.

This is sound because nothing is paginated: the range is capped at 400
days and `GET /api/bill-instances` returns the whole matching set in one
unpaginated response. Every row the user could sort or search is already
in memory. Server-side sorting would add a parameter, validation, and
tests, and buy a round trip per click.

- `q` matches case-insensitively as a substring of `billName`.
- `categoryId` matches `instance.categoryId`, with `none` matching `null`.
- Sorting is stable: every comparator falls back to `dueDate` then `id`,
  mirroring the server's `dueDate ASC, id ASC`, so equal keys never
  reorder between renders.
- `status` sorts in the enum's own order (`UNPAID`, `PARTIALLY_PAID`,
  `PAID`), not alphabetically, which would put `PAID` first.

`from`, `to`, `status`, `overdue`, and `billId` continue to be sent to
the API, unchanged.

## 6. The calendar

### 6.1 Grid construction

`/calendar` renders one calendar month as a six-row, seven-column grid of
42 cells. Weeks start on **Sunday**, because the shipped
`CalendarDateAdapter.getFirstDayOfWeek()` returns `0` and a month grid
that disagreed with the datepicker beside it would be a visible defect.

The grid is built by a pure function in the `core/date` area:

```ts
/** `anchor` is any date within the month to render; the day is ignored. */
export function monthGrid(anchor: CalendarDate): CalendarDate[];
```

It returns exactly 42 `CalendarDate` strings, starting from the Sunday on
or before the first of `anchor`'s month. It is built entirely from the existing
`startOfMonth`, `dayOfWeek`, and `addDays` string arithmetic. No `Date`
is constructed anywhere in it. Six rows are always rendered rather than
five-or-six, so the grid does not change height between months.

Cells outside the displayed month are rendered dimmed but are real: they
show their bills.

### 6.2 Data

The view fetches through `InstancesStore` with `from` = the first cell
and `to` = the last cell — not the first and last of the month. Spill
days that showed as empty while actually holding bills would be a
silent, plausible lie. A 42-day span is far inside the 400-day cap.

Month navigation (previous, next, today) moves by `addMonths` on the
anchor, which the shipped implementation clamps from the anchor rather
than from an intermediate result.

### 6.3 Cells and chips

Each cell shows its day number and up to three chips, then `+k more`.
Each chip carries the bill name and amount, coloured by state:

| State | Condition |
|---|---|
| Overdue | `isOverdue` |
| Paid | `status === 'PAID'` |
| Due | otherwise |

Status drives the chip colour. Category colour appears on the dashboard,
not here; colouring chips by category would leave the calendar unable to
show the one thing it is for.

Today's cell is marked distinctly, using `today()` from the
`calendar-date` module — the **browser's** day, deliberately. That marker
answers "where am I in the month", which is a question about the viewer,
so the viewer's own clock is the right source.

It is therefore possible for the ring to sit on one cell while a chip in
the previous cell still reads overdue, when the browser and
`APP_TIMEZONE` fall on opposite sides of midnight. That is accepted, and
it must not be "fixed" by deriving overdue state on the client: overdue
always arrives on the instance as `isOverdue`, computed server-side.
`calendar-date.ts` carries this warning on `today()` already — it is
restated here because a calendar is exactly where someone would be
tempted to compare a due date against the local clock.

### 6.4 Drill-down

Clicking a day opens a panel listing that day's instances, rendered with
the shipped `InstanceRowComponent` and wired to the shipped
`PaymentDialogComponent` and `ConfirmDialogComponent`. Pay, reverse, and
clear behave exactly as they do on `/upcoming`, through
`PaymentsService` — no second implementation of payment flow exists.

### 6.5 Accessibility

An interactive grid needs real semantics, and this is the cost of
choosing interactive over read-only:

- The grid is `role="grid"`; rows are `role="row"`; cells are
  `role="gridcell"` containing a focusable control.
- Arrow keys move between days; `Home`/`End` move within a week;
  `PageUp`/`PageDown` change month. Exactly one cell is in the tab order
  at a time (roving `tabindex`).
- Each day exposes an accessible label naming the date and what is on it:
  "14 October 2026, 2 bills, 1 overdue". An empty day says so.
- Chip colour is never the only carrier of state: overdue chips also
  carry a text or icon marker, because a colour-blind user and a
  greyscale printout must both still read the calendar.

## 7. Testing

### 7.1 API

Unit tests for `SummaryService` against a stubbed clock, pinning every
boundary:

- An instance due exactly on `asOf` is **not** overdue and **is** in
  `next7Days`.
- `asOf + 6` is in `next7Days`; `asOf + 7` is out.
- `asOf - 1` is overdue; it is not in `next7Days`.
- A `PAID` instance due yesterday is in neither debt bucket but still
  counts in `thisMonth`.
- A `PARTIALLY_PAID` instance contributes its remainder to the debt
  buckets and its full amount to `thisMonth.total`.
- The first and last day of `asOf`'s month are in `thisMonth`; the
  adjacent days outside it are not.
- `earliestDueDate` is the oldest unpaid overdue due date, and `null`
  when nothing is overdue.

E2E tests:

- Two users with bills: neither user's totals include the other's rows.
- A user with no bills: `200`, all zeros, `byCategory: []`.
- Every numeric field satisfies `typeof === 'number'` — the guard
  against raw `numeric` strings reaching the client.
- A user whose only bills are fully paid: zero debt, non-zero
  `thisMonth.paid`.
- Bills with no category produce exactly one `categoryId: null` row.

### 7.2 Web unit

- `monthGrid` returns 42 cells; first cell is a Sunday; correct for a
  month starting on each of the seven weekdays; correct across a leap
  February and a year boundary.
- Query-parameter parsing: every valid combination round-trips; every
  malformed value (`status=BANANA`, `from=2026-13-45`, `sort=nonsense`,
  `overdue=maybe`, non-UUID `billId`) yields the default and is not sent
  to the API.
- Sort comparators: each key in both directions; ties broken stably;
  `status` ordered by enum rather than alphabet.
- `q` filtering: case-insensitive, substring, no match yields empty.
- `categoryId=none` matches exactly the rows with a null category.
- `SummaryStore` refetches when `BillsStore.mutations` increments and
  when `PaymentsService.mutations` increments, and resets on sign-out.

### 7.3 Web component

- Dashboard renders each card's figures and each card's link target,
  including the clamped overdue range and the non-link zero state.
- Calendar cell shows chips, overflow count, today's marker, and the
  dimming of spill days.
- Calendar keyboard navigation moves focus as specified, including
  across a month boundary.
- `/upcoming` reflects an incoming URL into its controls and writes
  control changes back into the URL.

### 7.4 End-to-end

One Playwright journey ties the sub-project together: sign in, land on
`/dashboard`, read the overdue card, click it, arrive on `/upcoming`
already filtered to overdue, pay the bill, navigate back to the
dashboard, and observe the overdue total has dropped by that amount. A
dashboard that does not move after a payment is the failure this journey
exists to catch.

A second journey covers the calendar: navigate to a month, open a day
with a bill, pay from the drill-down, and see the chip change state.

## 8. Review focus

Input classes the spec implies that no single task's tests obviously own:

1. **A hand-edited or stale URL.** `?status=BANANA&from=garbage` must
   render the default view, not a 400 and not a blank screen (§5.1).
2. **Midnight and time zones.** With `APP_TIMEZONE` set to a non-UTC
   zone, the dashboard's overdue set and the list's overdue badges must
   name the same rows (§3.2). `TZ` is not part of the Nx cache key, so
   any timezone-varying run needs `--skip-nx-cache`.
3. **Zero rows.** Every aggregate on a fresh account renders `$0.00`,
   never `null`, `NaN`, or an empty string (§3.5, §3.7).
4. **Overdue debt older than 400 days.** The card total and the linked
   list disagree by construction; the disclosure must appear (§4.3).
5. **A month grid at a year boundary and across a leap February.** The
   grid is pure string arithmetic and must not drift (§6.1).

## 9. Open items for later sub-projects

- Notification delivery channel — real email provider or in-app only —
  not yet decided (sub-project 5).
- Pagination. Nothing is paginated, and client-side sorting (§5.3)
  depends on that. If a future sub-project paginates instances, sorting
  must move to the server in the same change.
