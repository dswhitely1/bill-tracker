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
  // A second bill on the same day. Without it this journey cannot tell a
  // list filtered to the reminded bill from a list that happens to hold
  // only one row — which is why dropping billId from the link changed
  // nothing when this journey was first written.
  await createBill(page, { name: 'Water', amount: '31.00', startDate: dueDate });

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
  // The filter actually filtered: Water is due the same day and would be
  // in an unfiltered list for this range. Scoped to the rows accordion,
  // not the whole page — the "Bill" filter select also has a "Water"
  // option, and the bell's own menu overlay (a separate CDK layer) could
  // in principle still be attached; neither is the thing being asserted
  // on here.
  await expect(page.locator('mat-accordion').getByText('Water')).toHaveCount(0);

  // Clicking the reminder acknowledged it, so the badge is gone.
  await expect(bell).toHaveAttribute('aria-label', 'Reminders, none unread');

  // And the full list agrees, rather than the bell and the page
  // disagreeing about the same row.
  await page.goto('/notifications');
  await expect(page.getByTestId('notification-row')).toHaveCount(1);
  await expect(page.getByTestId('mark-all-read')).toHaveCount(0);
});
