# Design: Angular Shell (Sub-project 3)

**Date:** 2026-10-06
**Status:** Approved
**Sub-project:** 3 of 5

## 1. Purpose

Build the Angular client against the API delivered by sub-projects 1 and
2: an application shell with routing and silent token refresh, the
authentication screens, and the screens for managing bill templates,
reading generated instances, and recording payments.

The two goals from the foundation spec still set the bar. This is a tool
its author will use to track household bills, and it is a showcase of
Angular + NestJS + PostgreSQL work. The functionality must actually work,
and the code must survive review.

### Success criteria

- A visitor can register, sign in, sign out, and return the next day to a
  working session without re-entering a password.
- A hard browser refresh restores the session from the refresh cookie
  without showing the login screen.
- An expired access token refreshes silently. Several requests failing at
  once produce exactly one refresh call.
- A user can create, edit, deactivate, and delete bill templates, manage
  categories, see the instances the server generated, and record,
  reverse, and clear payments.
- No date value in the client is ever produced by passing a `YYYY-MM-DD`
  string to `new Date()`.
- Server validation failures attach to the form controls that caused
  them.

### Non-goals

Dashboard summary cards and the calendar view — sub-project 4, which
also owns sorting, saved views, and any filtering beyond the three
parameters `GET /api/bill-instances` already accepts. Those three
(`status`, `overdue`, `billId`) are in scope here: they are one query
parameter each, and an instance list with no way to hide paid rows is
not usable. Notification delivery — sub-project 5. Server-side rendering,
progressive-web-app installation, and offline support are out of scope
entirely; this application is a browser client for a localhost API.

## 2. Context and scope

The foundation spec's decomposition (§2) assigns this sub-project
"routing, auth interceptor, login/register, bill list and form", leaving
dashboard, calendar, filtering, and sorting to sub-project 4.

**That boundary is widened here, deliberately.** Taken literally it ships
an application in which a user can create a bill but can never see what
is due or mark anything paid — not working software, and it would leave
sub-project 4 carrying both the instance data layer and every view built
on it. This sub-project therefore also covers the instance list and the
payment flows. Sub-project 4 becomes what its name says: presentation
over a data layer that already exists.

Sub-project 5 is unaffected.

### 2.1 Amendment to the foundation spec

Foundation spec §10 states that `ValidationPipe` failures "map to `400`
with per-field detail, so the Angular reactive forms in sub-project 3 can
attach errors to individual controls".

The implementation does not do this. `configure-app.ts` constructs
`ValidationPipe` with no `exceptionFactory`, so the default applies and
the response body is:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": ["name must be longer than or equal to 1 characters"],
  "path": "/api/bills",
  "timestamp": "2026-10-06T12:00:00.000Z"
}
```

`message` is a flat `string[]`. There is no field map, and the client can
recover one only by matching each sentence against a leading property
name.

That works today. Every message the API currently produces does begin
with its property — class-validator's built-ins interpolate `$property`,
and all three custom validators (`IsIsoDate`, `IsIsoTimestamp`,
`MaxBytes`) follow the convention. The objection is not that the parsing
fails now; it is that it is a convention, not a contract. Any
`{ message: 'Enter a valid email' }` override on any decorator, now or
later, silently stops attaching to its field, and the failure is
invisible — the message still renders in the form-level banner, so
nothing looks broken.

Parsing prose to recover structure the server had and discarded is the
wrong direction, and the foundation spec already promised the structured
form.

**The API is amended rather than the client made to guess.**
`configure-app.ts` gains an `exceptionFactory` that produces a body with
one added key:

```json
{
  "statusCode": 400,
  "error": "Bad Request",
  "message": ["name must be longer than or equal to 1 characters"],
  "errors": { "name": ["name must be longer than or equal to 1 characters"] },
  "path": "/api/bills",
  "timestamp": "2026-10-06T12:00:00.000Z"
}
```

`errors` keys on the dotted property path, taken from
`ValidationError.property` walked recursively through `children`. The
existing `message` array is unchanged in shape, content, and order, so
every existing e2e assertion continues to pass and no consumer breaks.

`ErrorResponse` and `ValidationErrorResponse` interfaces are added to
`libs/shared-types` so the client types the body it parses instead of
re-declaring it.

This is the only change to merged API code in this sub-project.

## 3. Stack

Versions verified against the npm registry on 2026-10-06.

| Component | Version |
|---|---|
| Angular | 22.2.1 |
| Angular Material + CDK | 22.2.1 |
| `@nx/angular` | 23.2.0 |
| `@nx/playwright` | 23.2.0 |

`@nx/angular` is pinned to **23.2.0**, matching every other `@nx/*`
package installed in the workspace, not the 23.2.1 the foundation spec
named. Its peer range for `@angular/build` is `>= 20.0.0 < 23.0.0`, so
Angular 22 is accepted.

Unit tests run on Vitest through Angular's own `@angular/build:unit-test`
builder (`--unitTestRunner=vitest-angular`). Linting uses oxlint,
formatting uses Prettier, end-to-end tests use Playwright. The generator
accepts all three directly, so the workspace's existing toolchain carries
over with no adapters and no second linter.

### 3.1 Generation

```bash
nx g @nx/angular:application web \
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
  --prefix=app
```

`--backendProject=api` writes `proxy.conf.json` so the dev server
forwards `/api` to port 3000. This keeps the browser on one origin during
development, which means the refresh cookie is first-party and
`SameSite=Lax` behaves exactly as the foundation spec §7 describes.

`--zoneless` is not optional and not deferred. Adding zoneless after
components exist means auditing every one of them; starting zoneless
means any component that depends on zone patching fails on the commit
that introduces it.

Two post-generation adjustments are required and are not the generator's
doing:

- `apps/web/tsconfig.json` adds a project reference to
  `../../libs/shared-types`, and the root `tsconfig.json` adds
  `apps/web` to its `references` array alongside `apps/api`.
- `tsconfig.base.json` sets `"lib": ["es2022"]` with no `dom`. The
  application tsconfig must add it. The base file is not changed — the
  API has no business seeing DOM types.

## 4. Workspace layout

```
apps/
├── api/                      unchanged but for §2.1
├── web/
│   └── src/app/
│       ├── core/
│       │   ├── api/          one typed HTTP client per resource
│       │   ├── state/        one signal store per resource
│       │   ├── auth/         session service, interceptor, guards
│       │   └── date/         calendar-date functions, pipe, adapter
│       ├── shared/           presentational components, dialogs
│       ├── auth/             login, register
│       ├── bills/            template list and form
│       ├── instances/        the upcoming screen and payment flows
│       ├── categories/       category management
│       └── settings/         profile, notifications, password
└── web-e2e/                  Playwright
```

One application with feature folders, not Nx feature libraries. The
foundation spec §4 declined to scaffold Angular two milestones early
because it "adds weight to every `nx affected` run for no benefit"; the
same reasoning applies to splitting a single-consumer client into
libraries whose boundaries nothing yet needs enforced. Promoting a folder
to a library later is mechanical; the reverse is not.

`libs/shared-types` is unchanged apart from the two error interfaces in
§2.1.

## 5. Routing

Every route lazily loads its component.

| Path | Screen | Guard |
|---|---|---|
| `''` | redirect to `/upcoming` | — |
| `/upcoming` | bill instances over a date range | auth |
| `/bills` | bill template list | auth |
| `/bills/new` | template form | auth |
| `/bills/:id` | template form | auth |
| `/categories` | category management | auth |
| `/settings` | name, notification toggles, password | auth |
| `/login` | sign in | guest |
| `/register` | create an account | guest |
| `**` | not found | — |

`''` redirects to `/upcoming` because what is due is the question this
application is opened to answer.

`authGuard` redirects to `/login` carrying a `returnUrl`. `guestGuard`
redirects an already-authenticated visitor to `/upcoming`, so a
bookmarked `/login` does not present a sign-in form to someone signed in.

Both guards read `SessionService`, which is already settled by the time
any guard runs — see §6.

`/settings` is the only screen here that is not load-bearing. If the
implementation plan runs long, it is the one to cut.

## 6. Session and the authentication loop

### 6.1 What the API provides

From foundation spec §7, unchanged:

- The access token is a 15-minute JWT, held **in memory only**. It is
  never written to `localStorage` or `sessionStorage`.
- The refresh token is an opaque `httpOnly` cookie scoped to
  `Path=/api/auth`, which the client cannot read and must not try to.
- `POST /api/auth/refresh` rotates it and returns `{ accessToken }` —
  the access token alone, with no user.
- A rotated token stays redeemable for a 30-second grace window, which
  exists so that a client that does not single-flight its refreshes is
  not punished for it.

### 6.2 Session restore at boot

Because the access token lives only in memory, every hard refresh begins
with no credential and a cookie the client cannot inspect. The session
must be reconstructed before the first route activates, or `authGuard`
will bounce a signed-in user to `/login` on every reload.

`provideAppInitializer` blocks bootstrap on `SessionService.restore()`:

1. `POST /api/auth/refresh`.
2. On 200, store the access token, then `GET /api/users/me` and store the
   profile.
3. On 401, resolve as anonymous.

**`restore()` never rejects.** A 401 here is the ordinary state of a
visitor who is not signed in, not an error, and a rejected initializer
fails application bootstrap outright.

Two round trips are needed because `RefreshResponse` carries only
`accessToken`. Amending the API so that refresh also returns the user was
considered and rejected: it saves one request at boot and costs a second
change to merged code.

Blocking bootstrap costs a brief blank frame. The alternative — letting
routes resolve and correcting afterwards — flashes the login screen on
every reload of an authenticated session.

### 6.3 The interceptor

One functional interceptor, `authInterceptor`. Its rules are stated
exhaustively because this is the unit most likely to carry a subtle bug.

**Requests whose URL does not target the API pass through untouched.** No
header, no credentials. Attaching a bearer token to a third-party request
leaks it.

**API requests are cloned with `withCredentials: true`** and an
`Authorization: Bearer` header when a token is held. `withCredentials` is
required for the refresh cookie to travel; the cookie's `Path=/api/auth`
means it is only ever actually sent to the four auth routes.

**`/api/auth/login`, `/api/auth/register`, `/api/auth/refresh`, and
`/api/auth/logout` are exempt from refresh handling.** Refreshing after a
rejected sign-in is meaningless, and refreshing after a rejected refresh
is an infinite loop.

**A 401 from any other route joins a single-flight refresh.**
`SessionService` holds at most one in-flight refresh observable, built
with `shareReplay({ bufferSize: 1, refCount: true })` and cleared when it
settles, so ten simultaneous 401s produce exactly one
`POST /api/auth/refresh`. The server's grace window makes client
correctness optional; depending on it is still the wrong instinct, and
single-flighting means the window is never exercised in normal operation.

**A retried request is structurally ineligible for a second retry.** The
retry carries an `HttpContextToken`, `SKIP_AUTH_RETRY`, which the
interceptor checks before entering the 401 branch. A boolean guarantee in
the request itself, rather than a flag someone has to remember to reset.

**When the refresh fails, the session clears and the application
navigates to `/login`.** Every waiting request fails with the original
error; none are silently swallowed.

Ownership failures need no handling here: the API returns **404, never
403**, for another user's resource (bills spec §7), so a 401 from a
non-auth route can only mean a token problem.

### 6.4 Sign-out and password change

Signing out calls `POST /api/auth/logout`, clears the in-memory token and
every store, and navigates to `/login`. The stores are cleared explicitly
rather than left to garbage collection, so a second user signing in on
the same browser tab cannot see the first one's rows.

Changing a password revokes every refresh token for that user (foundation
spec §7). The current access token stays valid for up to fifteen more
minutes, after which the session dies with no explanation. The client
therefore signs the user out deliberately on success and sends them to
`/login` with a message saying why.

## 7. Data layer

### 7.1 API clients

`core/api/` holds one client per resource, each a thin typed wrapper with
a method per endpoint and no state: `AuthApi`, `UsersApi`,
`CategoriesApi`, `BillsApi`, `BillInstancesApi`. Request and response
types come from `libs/shared-types`; no client re-declares a shape.

`BillInstancesApi.list()` takes the required `from` and `to` plus the
optional `status`, `overdue`, and `billId` filters. **There is no cursor
parameter, because the API has none** — the bounded range is the
pagination, capped at 400 days (bills spec §7.2). The client enforces the
cap before sending so an over-wide range is a message rather than a 400.

### 7.2 Stores

`core/state/` holds a signal store per resource: private `signal()`
state, public `computed()` reads, async methods, and an `error` signal.
No new dependency. Angular 22's signals are sufficient for state this
shape, and the API's design removes most of what a caching library would
otherwise buy.

**Payment mutations patch a row rather than refetch a range.** `POST
/payments`, `POST /payments/:id/reverse`, and `POST /unpay` all return
the updated instance alongside the log row (bills spec §7.3), so the
store replaces one element and no round trip follows.

**Three operations invalidate the instance range instead**, because their
effect on instances is computed by the server and cannot be predicted
locally:

| Operation | Why |
|---|---|
| `POST /api/bills` | generates instances synchronously |
| `PATCH /api/bills/:id` | rewrites untouched future instances per bills spec §5.4 |
| `DELETE /api/bills/:id` | cascades through instances and payment logs |

Reimplementing the rewrite rule in the client to avoid a refetch would
duplicate a business rule across two codebases, and the duplicate would
drift. The server decides; the client asks again.

## 8. Dates

### 8.1 The rule

`dueDate`, `startDate`, and `endDate` are bare `YYYY-MM-DD` calendar
days. **No stored date string is ever passed to `new Date()`.** Doing so
parses it as UTC midnight and renders it in local time, which moves the
date backwards for every user west of Greenwich — the exact off-by-one
the API's own date handling exists to avoid.

`core/date/` therefore holds pure functions over strings: `addDays`,
`addMonths` with anchor-based clamping, `startOfMonth`, `endOfMonth`,
`compare`, and `daysBetween`.

`today()` is the single permitted use of a `Date` object, and it formats
rather than parses: `Intl.DateTimeFormat('en-CA')` over the current
instant yields `YYYY-MM-DD` in the browser's zone. Formatting now is
safe; parsing a stored string is not.

Display goes through `CalendarDatePipe`, which splits the string and
indexes a month-name table.

This duplicates a fraction of the API's `apps/api/src/bills/dates.ts`.
The duplication is accepted and stated rather than hidden: the client
needs roughly a fifth of what the server does — no occurrence generation,
no rolling horizon — and the server remains authoritative for every date
it produces. The alternative, promoting calendar arithmetic into
`libs/shared-types`, would put runtime code into a library the foundation
spec §4 deliberately keeps free of it.

### 8.2 `isOverdue` is read, never computed

`BillInstanceResponse.isOverdue` is derived server-side against
`APP_TIMEZONE`, not the browser's zone. Recomputing it locally would
disagree with the API for any user outside that zone, and the two
answers would differ on exactly the rows a user cares most about.

It also goes stale at midnight. `/upcoming` compares `today()` against
the value it last rendered with when the window regains focus, and
refetches when the day has changed.

### 8.3 The Material date adapter

Angular Material's datepicker is generic over its date type.
`CalendarDateAdapter extends DateAdapter<string>` implements it directly
over `YYYY-MM-DD` strings — roughly twenty small methods — and is
provided alongside a matching `MAT_DATE_FORMATS`. No `Date` object exists
anywhere between the picker and the wire.

This is the riskiest single unit in the sub-project and carries the
heaviest unit tests, including the month-end clamping case the API
already proved matters: adding one month to `2026-01-31` yields
`2026-02-28`, and adding two yields `2026-03-31`, not `2026-03-28`.

A native `<input type="date">` was considered. Its value is already
`YYYY-MM-DD`, so it would need no adapter at all, but it does not style
consistently inside `mat-form-field` and gives up the calendar overlay
that makes choosing a due date pleasant.

## 9. Money

Money crosses the wire as `number` (bills spec §8).

Display uses `Intl.NumberFormat` with the currency defined as one
constant, not repeated at each call site.

Amount inputs validate `> 0` and `<= 9999999999.99` client-side,
mirroring the DTO bound from bills spec §7.1, so an oversized figure
produces a message beside the field instead of a 400 from the server.

**The remaining balance is displayed locally and computed remotely.**
Rendering `amount - amountPaid` is fine. Submitting it is not: `POST
/payments` with an empty body means "pay the remaining balance", and the
server computes that value under a row lock. A client-computed figure
races every other writer.

## 10. Forms and error presentation

Forms are typed reactive forms built with `FormBuilder.nonNullable`.

`applyServerErrors(form, body)` maps the `errors` object from §2.1 onto
controls by dotted path, setting `{ server: message }`. **Anything that
matches no control lands in a form-level banner**, so no server message
is ever silently dropped — the failure mode where a form rejects a
submission and shows nothing.

`errors` is present only on `ValidationPipe` failures. A 400 raised by a
service carries no field information at all — a `categoryId` naming a
category the user does not own is one (bills spec §7.1) — and those go to
the banner in full. The client branches on the key's presence, never on
the status code alone.

Two API behaviors get specific interfaces rather than a generic snackbar:

- **Deleting a category in use returns 409** with a message naming the
  count (bills spec §7.4). That message is shown in a dialog, not a
  toast.
- **Deleting a bill cascades** through its instances and payment logs
  (bills spec §7.1). The confirmation says so in those terms, and
  **"Deactivate instead" is the default action**, since `PATCH {
  isActive: false }` is the non-destructive path the API offers and the
  README already documents the distinction.

Transient failures use `MatSnackBar` through one `NotificationService`,
so retry and dismissal behave the same everywhere.

## 11. Screens

**`/upcoming`** lists instances over a date range defaulting to the
current month, with range controls and the `status`, `overdue`, and
`billId` filters the API supports. Each row shows the bill name, due
date, amount, amount paid, and status, flags overdue rows from the
server's own `isOverdue`, and offers record payment, reverse a single payment, and clear all
payments (`POST /unpay`).
Recording a payment defaults to the full remaining balance via an empty
body and accepts a partial amount, a date, and a note. A row expands to
its payment history from `GET /api/bill-instances/:id/payments`,
including reversal rows, since an append-only log is only useful if it
can be read.

**`/bills`** lists templates with their frequency, amount, category, and
active state. The form creates and edits, with the frequency, dates, and
category drawn from the contracts. Editing warns that changes rewrite
untouched future unpaid instances, because that is the rule from bills
spec §5.4 and a user who does not expect it will be surprised by it.

**`/categories`** lists, creates, edits, and deletes categories with a
color.

**`/settings`** edits the name and the two notification toggles, and
changes the password under §6.4's sign-out behavior.

The shell is a Material toolbar and side navigation, responsive to a
single breakpoint, with the signed-in user's name and a sign-out action.

## 12. Testing

Development follows the same test-first discipline as sub-projects 1
and 2.

### 12.1 Unit and component tests

Vitest, through `@angular/build:unit-test`. Covering:

- every function in `core/date/`, including month-end clamping and the
  timezone cases, run under a non-UTC `TZ` as well as UTC
- `CalendarDateAdapter`, exhaustively — it is the §8.3 risk
- the three interceptor rules: single-flight, exemption of `/api/auth/*`,
  and refusal to retry twice
- `SessionService.restore()` for both the 200 and the 401 path,
  asserting the 401 path resolves rather than rejects
- `applyServerErrors`, including the unmatched-path banner
- each store's patch-versus-invalidate behavior from §7.2

Component tests use Angular Material's CDK test harnesses rather than
querying the DOM, so a Material internal change does not break them.

### 12.2 End-to-end journeys

Playwright, against a running API and a real database. Three journeys:

1. **The working path.** Register, create a bill, see the generated
   instances on `/upcoming`, record a partial payment, observe
   `PARTIALLY_PAID`, pay the rest, observe `PAID`.
2. **Silent refresh.** Sign in against an API started with
   `JWT_ACCESS_TTL=2s`, wait out the access token, navigate to a screen
   that loads several resources at once, and assert that every request
   succeeds **and that exactly one `POST /api/auth/refresh` was
   issued.** The count comes from a `page.on('request')` listener
   installed before the navigation. Asserting it is the point: a journey
   that passes with three refreshes has proved the application works and
   that single-flighting is broken.
3. **Reversal.** Record a payment, reverse it, confirm the instance
   returns to `UNPAID` and the payment history still lists both rows —
   the log is append-only and the UI must show that.

Playwright runs against its own database, `bills_web_e2e`, separate from
the `bills_test` database `api-e2e` truncates between tests, so the two
suites cannot destroy each other's fixtures and can run concurrently.
Its `webServer` configuration starts the API against that database and
the web dev server against the API.

The short `JWT_ACCESS_TTL` journey 2 requires is set in the Playwright
`webServer` environment only, never in `.env` or `.env.example`. Leaking
it into development configuration would sign the author out every few
seconds while working.

## 13. Risks

**`shared-types` resolution.** The library sets `"type": "module"` with
`moduleResolution: nodenext`, and its sources carry `.js` suffixes on
relative imports. Angular's esbuild bundler must resolve those to `.ts`
sources through the package's `exports` map and the `@org/source`
custom condition. **A real contract import is wired and built in the
first task**, not the last, so a resolution problem surfaces while it is
cheap.

**Zoneless with Material.** Material 22 supports zoneless, but any
component relying on zone patching misbehaves without a clear error.
Zoneless from the first commit means the offending commit is the one that
fails.

**The date adapter.** Twenty small methods, each trivially wrong in a way
that shifts a date by one day. Mitigated only by tests; see §12.1.

**Two servers under Playwright.** The web e2e suite needs the API, the
web dev server, and a database. Sub-project 2 lost time to a flaky build
gate; the plan starts the Playwright configuration with one trivial
journey and adds the real three once the harness is proven green.

## 14. Open items

- **Currency is hard-coded to USD** in one constant. Multi-currency is
  not in any sub-project and is not designed for.
- **No pagination beyond the range cap.** A user with hundreds of
  instances in one month renders them all. Virtual scrolling is a
  sub-project 4 concern if it becomes one.
- **`/settings` is the designated cut** if the implementation plan runs
  long. Nothing else depends on it.
