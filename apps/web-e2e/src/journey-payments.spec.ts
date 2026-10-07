import { expect, test } from '@playwright/test';
import { newAccount } from './support/accounts';
import { createBill, registerAndSignIn, startOfThisMonth } from './support/flows';

test('a bill becomes partly paid and then paid', async ({ page }) => {
  const account = newAccount();
  await registerAndSignIn(page, account);

  await createBill(page, { name: 'Rent', amount: '1200', startDate: startOfThisMonth() });

  await page.goto('/upcoming');
  await expect(page.getByText('Rent').first()).toBeVisible();
  await expect(page.getByText('Unpaid').first()).toBeVisible();

  await page.getByText('Rent').first().click();

  // A partial payment: the amount is typed, so the server is told what it is.
  await page.getByRole('button', { name: 'Record payment' }).first().click();
  // The dialog's open animation briefly leaves the checkbox reporting
  // `checked=false` before Angular's own binding writes `true` — waiting
  // for the real state first avoids a `.uncheck()` that sees it as already
  // unchecked and never clicks.
  const payInFull = page.getByLabel('Pay the full remaining balance');
  await expect(payInFull).toBeChecked();
  await payInFull.uncheck();
  await page.getByLabel('Amount').fill('500');
  // Exact match: "Record payment" (the row's button, still in the DOM
  // behind the dialog) otherwise satisfies a substring match on "Record".
  await page.getByRole('button', { name: 'Record', exact: true }).click();

  await expect(page.getByText('Partly paid').first()).toBeVisible();
  await expect(page.getByText('$700.00').first()).toBeVisible();

  // The rest, as a full payment: no amount is sent at all, and the server
  // computes the balance under its row lock.
  await page.getByRole('button', { name: 'Record payment' }).first().click();
  await expect(page.getByLabel('Pay the full remaining balance')).toBeChecked();
  await page.getByRole('button', { name: 'Record', exact: true }).click();

  await expect(page.getByText('Paid').first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
});
