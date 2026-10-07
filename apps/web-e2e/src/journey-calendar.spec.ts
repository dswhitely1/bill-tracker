import { expect, test } from '@playwright/test';
import { newAccount } from './support/accounts';
import { createBill, registerAndSignIn, startOfThisMonth } from './support/flows';

test('a bill appears on its day and can be paid from the calendar', async ({ page }) => {
  const account = newAccount();
  await registerAndSignIn(page, account);

  const due = startOfThisMonth();
  await createBill(page, { name: 'Water', amount: '80', startDate: due });

  await page.goto('/calendar');

  const cell = page.locator(`[data-date="${due}"]`);
  await expect(cell).toContainText('Water');

  await cell.click();
  const panel = page.locator('app-day-detail');
  await expect(panel).toContainText('Water');
  await expect(panel).toContainText('$80.00');

  await panel.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByLabel('Pay the full remaining balance')).toBeChecked();
  // Exact match: "Record payment" (the row's button, still in the DOM
  // behind the dialog) otherwise satisfies a substring match on "Record".
  await page.getByRole('button', { name: 'Record', exact: true }).click();

  // Exact match here too: the row's status chip reads "Unpaid" right up
  // until the payment lands, and `getByText('Paid')` without `exact`
  // matches that substring immediately, before the request completes.
  await expect(panel.getByText('Paid', { exact: true }).first()).toBeVisible();
});

test('the calendar grid is reachable and operable from the keyboard', async ({ page }) => {
  const account = newAccount();
  await registerAndSignIn(page, account);
  await createBill(page, { name: 'Water', amount: '80', startDate: startOfThisMonth() });

  await page.goto('/calendar');

  // Exactly one cell is in the tab order; arrows do the rest.
  const grid = page.locator('[role="grid"]');
  await expect(grid.locator('[data-date][tabindex="0"]')).toHaveCount(1);

  await grid.locator('[data-date][tabindex="0"]').focus();
  await page.keyboard.press('ArrowRight');
  await expect(grid.locator('[data-date][tabindex="0"]')).toHaveCount(1);
  await expect(page.locator('[data-date]:focus')).toHaveCount(1);

  await page.keyboard.press('Enter');
  await expect(page.locator('app-day-detail')).toBeVisible();
});
