import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { DataSource } from 'typeorm';
import { Bill } from '../src/bills/bill.entity';
import { BillInstance } from '../src/bills/bill-instance.entity';
import { User } from '../src/users/user.entity';
import { getTestDataSource, truncateAll } from './db';

let ds: DataSource;

beforeAll(async () => {
  ds = await getTestDataSource();
});
beforeEach(async () => {
  await truncateAll(ds);
});
afterAll(async () => {
  if (ds?.isInitialized) await ds.destroy();
});

const seedUser = async () =>
  ds.getRepository(User).save(
    ds.getRepository(User).create({
      email: 'e@example.com', passwordHash: 'x'.repeat(60), name: 'E',
    }),
  );

describe('bill entities', () => {
  it('round-trips money as a number, not a string', async () => {
    const user = await seedUser();
    const bill = await ds.getRepository(Bill).save(
      ds.getRepository(Bill).create({
        userId: user.id, categoryId: null, name: 'Rent', defaultAmount: 1950.55,
        frequency: 'MONTHLY', startDate: '2026-10-01', endDate: null,
      }),
    );
    const reloaded = await ds.getRepository(Bill).findOneByOrFail({ id: bill.id });
    expect(typeof reloaded.defaultAmount).toBe('number');
    expect(reloaded.defaultAmount).toBe(1950.55);
  });

  it('round-trips dates as YYYY-MM-DD strings, not Dates', async () => {
    const user = await seedUser();
    const bill = await ds.getRepository(Bill).save(
      ds.getRepository(Bill).create({
        userId: user.id, categoryId: null, name: 'Rent', defaultAmount: 100,
        frequency: 'MONTHLY', startDate: '2026-01-31', endDate: '2027-01-31',
      }),
    );
    const reloaded = await ds.getRepository(Bill).findOneByOrFail({ id: bill.id });
    expect(reloaded.startDate).toBe('2026-01-31');
    expect(reloaded.endDate).toBe('2027-01-31');
  });

  it('refuses a duplicate (bill_id, due_date)', async () => {
    const user = await seedUser();
    const bill = await ds.getRepository(Bill).save(
      ds.getRepository(Bill).create({
        userId: user.id, categoryId: null, name: 'Rent', defaultAmount: 100,
        frequency: 'MONTHLY', startDate: '2026-10-01', endDate: null,
      }),
    );
    const row = { billId: bill.id, userId: user.id, dueDate: '2026-10-01', amount: 100 };
    await ds.getRepository(BillInstance).save(ds.getRepository(BillInstance).create(row));
    await expect(
      ds.getRepository(BillInstance).save(ds.getRepository(BillInstance).create(row)),
    ).rejects.toThrow(/UQ_bill_instances_bill_due|duplicate key/);
  });
});
