import { expect, test } from '@playwright/test';
import { newAccount } from './support/accounts';

test('an anonymous visitor lands on the sign-in screen', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});

test('registering signs the visitor in and shows the dashboard', async ({ page }) => {
  const account = newAccount();

  await page.goto('/register');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Name').fill(account.name);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
});
