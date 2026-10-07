import { expect, test } from '@playwright/test';
import { newAccount } from './support/accounts';
import { createBill, registerAndSignIn, startOfThisMonth } from './support/flows';

/**
 * The journey that proves the sub-project hangs together: a figure on the
 * dashboard, the list of rows behind it, a payment, and the figure moving.
 *
 * A dashboard that does not move after a payment is the failure this
 * exists to catch — it is the one that looks authoritative while being
 * wrong.
 */
test('a dashboard figure leads to its rows, and moves when one is paid', async ({ page }) => {
  const account = newAccount();
  await registerAndSignIn(page, account);

  await createBill(page, { name: 'Rent', amount: '1200', startDate: startOfThisMonth() });

  await page.goto('/dashboard');
  const monthCard = page.locator('mat-card', { hasText: 'Due this month' });
  await expect(monthCard).toContainText('$1,200.00');
  await expect(monthCard).toContainText('$0.00 paid');

  // The card links into exactly the rows it counted.
  await monthCard.getByRole('link', { name: 'View this month' }).click();
  await expect(page).toHaveURL(/\/upcoming\?/);
  await expect(page.getByText('Rent').first()).toBeVisible();

  await page.getByText('Rent').first().click();
  await page.getByRole('button', { name: 'Record payment' }).first().click();
  await expect(page.getByLabel('Pay the full remaining balance')).toBeChecked();
  // Exact match: "Record payment" (the row's button, still in the DOM
  // behind the dialog) otherwise satisfies a substring match on "Record".
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  // Exact match here too: the row's own status chip reads "Unpaid" right
  // up until the payment lands, and `getByText('Paid')` without `exact`
  // matches that substring immediately — satisfied before the request
  // completes, which would let the next navigation race ahead of it and
  // abort the still-in-flight payment. An exact match on "Paid" can only
  // be satisfied once the chip's text has actually become "Paid".
  await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();

  await page.goto('/dashboard');
  await expect(page.locator('mat-card', { hasText: 'Due this month' })).toContainText(
    '$1,200.00 paid',
  );
});

test('the filters a dashboard link sets survive a reload', async ({ page }) => {
  const account = newAccount();
  await registerAndSignIn(page, account);
  await createBill(page, { name: 'Rent', amount: '1200', startDate: startOfThisMonth() });

  await page.goto('/dashboard');
  await page.getByRole('link', { name: 'View this month' }).click();
  await expect(page).toHaveURL(/\/upcoming\?/);

  const filtered = page.url();
  await page.reload();

  // The URL is the single source of truth, so a reload restores the view.
  expect(page.url()).toBe(filtered);
  await expect(page.getByText('Rent').first()).toBeVisible();
});
