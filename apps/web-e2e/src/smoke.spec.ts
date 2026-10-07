import { expect, test } from '@playwright/test';
import { newAccount } from './support/accounts';

test('an anonymous visitor lands on the sign-in screen', async ({ page }) => {
  await page.goto('/');

  // Not getByRole('heading', ...): `mat-card-title` renders as a plain
  // element with no ARIA heading role (Angular Material's MatCardTitle
  // sets none), unlike the Upcoming screen's actual `<h1>` asserted below.
  await expect(page.locator('mat-card-title')).toHaveText('Sign in');
  await expect(page).toHaveURL(/\/login/);
});

test('registering signs the visitor in and shows the upcoming screen', async ({ page }) => {
  const account = newAccount();

  await page.goto('/register');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Name').fill(account.name);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/upcoming/);
  await expect(page.getByRole('heading', { name: 'Upcoming' })).toBeVisible();
});
