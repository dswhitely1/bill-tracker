import { Request, expect, test } from '@playwright/test';
import { newAccount } from './support/accounts';
import { registerAndSignIn } from './support/flows';

test('several requests failing at once produce exactly one refresh', async ({ page }) => {
  // Regression (fix round 2): clicking an in-app "Bills" link used to be
  // this test's stampede, back when the Bills screen was the only one
  // that loaded BillsStore. Now Upcoming loads BillsStore too (for its
  // bill filter), so by the time a test clicked into Bills, BillsStore
  // was already warm from landing on Upcoming first — leaving only
  // CategoriesStore's one request to 401, and `toBe(1)` passing with a
  // single caller, proving nothing about single-flighting. Verified by
  // temporarily removing SessionService.refresh()'s in-flight cache: the
  // old shape of this test still passed.
  //
  // The genuine stampede is the *first* arrival at /upcoming, where
  // BillsStore and InstancesStore both load concurrently, both cold.
  // Getting two requests to land together means the counter and the
  // interception have to be in place before that landing happens, so
  // registration is driven inline here rather than through
  // registerAndSignIn.
  const account = newAccount();

  // A hard load, deliberately before the counter or the route
  // interception exist: the boot-time APP_INITIALIZER (`restore()`)
  // refresh against an absent cookie is real, but it is not the stampede
  // under test, and counting it would misrepresent what single-flighting
  // guards.
  await page.goto('/register');

  // Reject the next response from each of these endpoints with a 401,
  // exactly as an expired access token would. Doing it this way rather
  // than by shortening JWT_ACCESS_TTL keeps the test deterministic and
  // keeps a timing knob out of the API's configuration.
  const alreadyRejected = new Set<string>();
  await page.route(/\/api\/(bills|bill-instances)/, async (route) => {
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

  // Submitting registration signs the visitor in and navigates to
  // /upcoming via the Angular Router — client-side, not a hard reload —
  // so this is not a second boot-time refresh. It is where
  // UpcomingComponent's constructor fires BillsStore.load() and
  // InstancesStore's load() together, both cold, both intercepted above.
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Name').fill(account.name);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  // Registration now lands on the dashboard, which loads only
  // SummaryStore — neither of the two stores this stampede needs. The
  // cold concurrent load is one navigation later, on arrival at
  // /upcoming, where BillsStore and InstancesStore load together. The
  // counter and the interception are already installed, so that landing
  // is still the first time either endpoint is called.
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByRole('link', { name: 'Upcoming', exact: true }).click();

  await expect(page).toHaveURL(/\/upcoming/);
  // Exact match: the sidenav's "Upcoming" nav link is a link, not a
  // heading, but exactness costs nothing and keeps this honest.
  await expect(page.getByRole('heading', { name: 'Upcoming', exact: true })).toBeVisible();

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

  // Categories, not bills: registerAndSignIn now lands on the dashboard,
  // which loads neither BillsStore nor CategoriesStore — so by the time
  // these routes are installed, both are still cold. CategoriesStore is
  // loaded only by the Bills screen, so routing the 401 there (rather
  // than on bills, which Upcoming would otherwise have already warmed in
  // the old topology) is still a guaranteed fresh request here.
  await page.route(/\/api\/categories(\?|$)/, (route) => route.fulfill(unauthorized));
  await page.route(/\/api\/auth\/refresh/, (route) => route.fulfill(unauthorized));

  // Same reasoning as the test above: an in-app navigation, not a hard
  // reload. A `page.goto` here would also re-run `SessionService.restore()`
  // at boot, which would hit this test's blanket 401-on-refresh route
  // before the visitor ever had a session to lose — landing on `/login`
  // via the plain "not authenticated" guard redirect instead of the
  // interceptor's failed-retry path, with no "session expired" reason.
  await page.getByRole('link', { name: 'Bills' }).click();

  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByText('Your session expired')).toBeVisible();
});
