import { randomUUID } from 'node:crypto';

export interface TestAccount {
  email: string;
  name: string;
  password: string;
}

/**
 * A fresh account per journey.
 *
 * Journeys isolate themselves by registering rather than by truncating, so
 * no run can destroy another run's data and the suite never needs a
 * destructive database operation.
 */
export function newAccount(): TestAccount {
  return {
    email: `e2e-${randomUUID()}@example.test`,
    name: 'Playwright Tester',
    password: 'hunter22-e2e',
  };
}
