import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app/app.module';
import { BillGeneratorService } from '../src/bills/bill-generator.service';
import { Bill } from '../src/bills/bill.entity';
import { BillInstance } from '../src/bills/bill-instance.entity';
import { User } from '../src/users/user.entity';
import { getTestDataSource, truncateAll } from './db';

let moduleRef: TestingModule;
let generator: BillGeneratorService;
let ds: DataSource;

beforeAll(async () => {
  process.env.ENV_FILE = '.env.test';
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  generator = moduleRef.get(BillGeneratorService);
  ds = await getTestDataSource();
});

beforeEach(async () => {
  await truncateAll(ds);
});

afterAll(async () => {
  await moduleRef?.close();
  if (ds?.isInitialized) await ds.destroy();
});

const seedBill = async (overrides: Partial<Bill> = {}): Promise<Bill> => {
  const user = await ds.getRepository(User).save(
    ds.getRepository(User).create({
      email: `u${Math.random()}@example.com`, passwordHash: 'x'.repeat(60), name: 'U',
    }),
  );
  return ds.getRepository(Bill).save(
    ds.getRepository(Bill).create({
      userId: user.id, categoryId: null, name: 'Rent', defaultAmount: 1800,
      frequency: 'MONTHLY', startDate: '2026-01-01', endDate: null, isActive: true,
      ...overrides,
    }),
  );
};

const instancesOf = (bill: Bill) =>
  ds.getRepository(BillInstance).find({ where: { billId: bill.id }, order: { dueDate: 'ASC' } });

describe('BillGeneratorService.materializeForBill', () => {
  it('materializes the occurrence set with the template amount', async () => {
    const bill = await seedBill();
    const inserted = await generator.materializeForBill(bill);
    const rows = await instancesOf(bill);
    expect(rows).toHaveLength(inserted);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.amount === 1800)).toBe(true);
    expect(rows.every((r) => r.status === 'UNPAID')).toBe(true);
    expect(rows.every((r) => r.amountPaid === 0)).toBe(true);
    expect(rows.every((r) => r.isCustomized === false)).toBe(true);
    expect(rows.every((r) => r.userId === bill.userId)).toBe(true);
  });

  it('is idempotent — the second run inserts nothing', async () => {
    const bill = await seedBill();
    const first = await generator.materializeForBill(bill);
    const before = await instancesOf(bill);
    const second = await generator.materializeForBill(bill);
    const after = await instancesOf(bill);

    expect(second).toBe(0);
    expect(after).toHaveLength(first);
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id)); // same rows, not replaced
  });

  it('leaves an existing instance untouched rather than resetting it', async () => {
    const bill = await seedBill();
    await generator.materializeForBill(bill);
    const [first] = await instancesOf(bill);
    await ds.getRepository(BillInstance).update(first.id, {
      amount: 42, status: 'PAID', amountPaid: 42, isCustomized: true,
    });

    await generator.materializeForBill(bill);

    const reloaded = await ds.getRepository(BillInstance).findOneByOrFail({ id: first.id });
    expect(reloaded.amount).toBe(42);
    expect(reloaded.status).toBe('PAID');
    expect(reloaded.isCustomized).toBe(true);
  });

  it('materializes nothing for an inactive bill', async () => {
    const bill = await seedBill({ isActive: false });
    expect(await generator.materializeForBill(bill)).toBe(0);
    expect(await instancesOf(bill)).toHaveLength(0);
  });

  it('materializes nothing for a bill starting beyond the horizon', async () => {
    const bill = await seedBill({ startDate: '2099-01-01' });
    expect(await generator.materializeForBill(bill)).toBe(0);
  });

  it('survives two concurrent generations of the same bill', async () => {
    // The UNIQUE constraint plus ON CONFLICT DO NOTHING is the whole
    // mechanism; two API processes running the nightly job must not collide.
    const bill = await seedBill();
    const results = await Promise.all([
      generator.materializeForBill(bill),
      generator.materializeForBill(bill),
    ]);
    const rows = await instancesOf(bill);
    expect(results[0] + results[1]).toBe(rows.length);
    expect(new Set(rows.map((r) => r.dueDate)).size).toBe(rows.length);
  });
});

describe('BillGeneratorService.materializeAll', () => {
  it('covers every active bill and skips inactive ones', async () => {
    const active = await seedBill();
    const inactive = await seedBill({ isActive: false, name: 'Old gym' });
    await generator.materializeAll();
    expect((await instancesOf(active)).length).toBeGreaterThan(0);
    expect(await instancesOf(inactive)).toHaveLength(0);
  });
});
