import { Page, expect } from '@playwright/test';
import { TestAccount } from './accounts';

export async function registerAndSignIn(page: Page, account: TestAccount): Promise<void> {
  await page.goto('/register');
  await page.getByLabel('Email').fill(account.email);
  await page.getByLabel('Name').fill(account.name);
  await page.getByLabel('Password').fill(account.password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * The first of the current month, as a bare `YYYY-MM-DD`.
 *
 * The API generates occurrences from the current period forward, so a bill
 * starting here produces an instance the default range already shows. The
 * server runs in UTC under this harness (`APP_TIMEZONE=UTC` in
 * `playwright.config.ts`), so `toISOString` agrees with it.
 */
export function startOfThisMonth(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}

/**
 * A calendar day `n` days from today, in the browser's zone. Good enough
 * for a journey: the API's APP_TIMEZONE is UTC under e2e, and the suite
 * does not run across a midnight boundary.
 */
export function daysFromToday(n: number): string {
  const date = new Date();
  date.setDate(date.getDate() + n);
  return date.toISOString().slice(0, 10);
}

export interface BillInput {
  name: string;
  amount: string;
  startDate: string;
}

export async function createBill(page: Page, bill: BillInput): Promise<void> {
  await page.goto('/bills/new');
  await page.getByLabel('Name').fill(bill.name);
  await page.getByLabel('Amount').fill(bill.amount);
  await page.getByLabel('Starts').fill(bill.startDate);
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page).toHaveURL(/\/bills$/);
  await expect(page.getByText(bill.name)).toBeVisible();
}
