import { expect, test } from '@playwright/test';
import { newAccount } from './support/accounts';
import { createBill, registerAndSignIn, startOfThisMonth } from './support/flows';

test('a reversed payment leaves both entries in the history', async ({ page }) => {
  const account = newAccount();
  await registerAndSignIn(page, account);

  await createBill(page, { name: 'Water', amount: '60', startDate: startOfThisMonth() });

  await page.goto('/upcoming');
  await page.getByText('Water').first().click();

  await page.getByRole('button', { name: 'Record payment' }).first().click();
  // Exact match: "Record payment" (the row's button, still in the DOM
  // behind the dialog) otherwise satisfies a substring match on "Record".
  await page.getByRole('button', { name: 'Record', exact: true }).click();
  await expect(page.getByText('Paid').first()).toBeVisible();

  await page.getByRole('button', { name: 'Reverse this payment' }).first().click();

  // The instance is unpaid again...
  await expect(page.getByText('Unpaid').first()).toBeVisible();

  // ...and both rows are still there. The log is append-only; a history
  // that netted to nothing would have discarded the fact that something
  // happened and was undone, which is the whole reason it works this way.
  await expect(page.getByTestId('payment-entry')).toHaveCount(2);
  await expect(page.getByText('Reversal')).toBeVisible();
  await expect(page.getByText('-$60.00')).toBeVisible();
});
