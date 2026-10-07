import { Request, expect, test } from '@playwright/test';
import { newAccount } from './support/accounts';
import { registerAndSignIn } from './support/flows';

test('several requests failing at once produce exactly one refresh', async ({ page }) => {
  const account = newAccount();
  await registerAndSignIn(page, account);

  // Reject the next response from each of these endpoints with a 401,
  // exactly as an expired access token would. Doing it this way rather
  // than by shortening JWT_ACCESS_TTL keeps the test deterministic and
  // keeps a timing knob out of the API's configuration.
  const alreadyRejected = new Set<string>();
  await page.route(/\/api\/(bills|categories|bill-instances)/, async (route) => {
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

  // A screen that loads several resources at once, so several 401s land
  // together and the single-flight path is the one under test.
  //
  // Navigating with an in-app link rather than `page.goto` on purpose:
  // `page.goto` is a hard browser reload, which re-runs the
  // `APP_INITIALIZER` (`SessionService.restore()`) and issues its own
  // refresh — a real, separate round trip, since the access token is
  // deliberately kept in memory only and never survives a reload. That
  // refresh has nothing to do with the stampede this test is about, and
  // counting it here would misrepresent what the single-flight cache
  // actually guards. Clicking the shell's "Bills" nav link instead stays
  // on the already-booted SPA, matching the realistic case: a
  // signed-in user clicking around after their access token has expired.
  await page.getByRole('link', { name: 'Bills' }).click();
  // Exact match: the empty-state's "No bills yet" heading otherwise
  // satisfies a case-insensitive substring match on "Bills" too.
  await expect(page.getByRole('heading', { name: 'Bills', exact: true })).toBeVisible();
  await expect(page.getByText('No bills yet')).toBeVisible();

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

  // Categories, not bills: the Upcoming screen (where registerAndSignIn
  // lands) now loads BillsStore too, for its bill filter — so by the time
  // these routes are installed, BillsStore is already loaded and clicking
  // "Bills" would serve its cached data without a new network call,
  // never tripping this route at all. CategoriesStore is loaded only by
  // the Bills screen, so it is still a guaranteed fresh request here.
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
