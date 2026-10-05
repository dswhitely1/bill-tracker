import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app/app.module';
import { BillGeneratorService } from '../src/bills/bill-generator.service';
import { BillsService } from '../src/bills/bills.service';
import type { UpdateBillDto } from '../src/bills/dto/update-bill.dto';
import { Bill } from '../src/bills/bill.entity';
import { BillInstance } from '../src/bills/bill-instance.entity';
import { User } from '../src/users/user.entity';
import { addMonths } from '../src/bills/dates';
import { getTestDataSource, truncateAll } from './db';

let moduleRef: TestingModule;
let generator: BillGeneratorService;
let billsService: BillsService;
let ds: DataSource;

beforeAll(async () => {
  process.env.ENV_FILE = '.env.test';
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  generator = moduleRef.get(BillGeneratorService);
  billsService = moduleRef.get(BillsService);
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

const update = (bill: Bill, dto: UpdateBillDto) => billsService.update(bill.userId, bill.id, dto);

/**
 * The rewrite predicate is:
 *   due_date > today AND status = 'UNPAID' AND amount_paid = 0
 *     AND is_customized = false
 * Each test below plants one instance that violates exactly one condition
 * and asserts it survives an amount change. Testing the conditions
 * separately would let a single wrong operator pass.
 */
describe('rewriteForBill', () => {
  const T = () => generator.today();

  const plant = async (
    bill: Bill, dueDate: string, patch: Partial<BillInstance> = {},
  ): Promise<BillInstance> =>
    ds.getRepository(BillInstance).save(
      ds.getRepository(BillInstance).create({
        billId: bill.id, userId: bill.userId, dueDate, amount: 100, ...patch,
      }),
    );

  it('rewrites a plain future unpaid instance', async () => {
    // Anchored on T() so addMonths(T(), 2) lands exactly on an occurrence of
    // the bill's own monthly sequence regardless of today's day-of-month —
    // seedBill's day-1 default would only coincide with T() on the 1st.
    const bill = await seedBill({ defaultAmount: 100, startDate: T() });
    const future = await plant(bill, addMonths(T(), 2));
    await update(bill, { defaultAmount: 250 });
    const row = await ds.getRepository(BillInstance).findOneByOrFail({ id: future.id });
    expect(row.amount).toBe(250);
    expect(row.id).toBe(future.id); // id preserved — no delete-and-reinsert
  });

  it('protects every other kind of instance in one pass', async () => {
    const bill = await seedBill({ defaultAmount: 100 });
    const protectedRows = {
      paid: await plant(bill, addMonths(T(), 3), {
        status: 'PAID', amountPaid: 100, paidAt: new Date(),
      }),
      partial: await plant(bill, addMonths(T(), 4), {
        status: 'PARTIALLY_PAID', amountPaid: 40,
      }),
      customized: await plant(bill, addMonths(T(), 5), { isCustomized: true, amount: 77 }),
      past: await plant(bill, addMonths(T(), -2)),
      dueToday: await plant(bill, T()),
      // Deliberately inconsistent with amount_paid, so this row is excluded
      // ONLY by the status clause. Without it, `paid` (amount_paid: 100)
      // and `partial` (amount_paid: 40) are both already excluded by
      // `amount_paid = 0` alone, and dropping `status = 'UNPAID'` from the
      // predicate would leave every other test in this file green.
      paidZeroBalance: await plant(bill, addMonths(T(), 7), { status: 'PAID', amountPaid: 0 }),
      // Deliberately inconsistent the other way: status stayed UNPAID but
      // amount_paid is nonzero. Every other fixture with amount_paid != 0
      // also has a non-UNPAID status, so the status clause alone would
      // protect them; this one isolates `amount_paid = 0` by itself.
      unpaidWithBalance: await plant(bill, addMonths(T(), 8), { status: 'UNPAID', amountPaid: 1 }),
    };

    await update(bill, { defaultAmount: 250 });

    for (const [kind, row] of Object.entries(protectedRows)) {
      const after = await ds.getRepository(BillInstance).findOneByOrFail({ id: row.id });
      expect(after.amount, `${kind} must not be rewritten`).toBe(row.amount);
      expect(after.status, `${kind} must keep its status`).toBe(row.status);
    }
  });

  it('deletes rewritable instances whose date leaves the occurrence set', async () => {
    const bill = await seedBill({ frequency: 'MONTHLY', startDate: '2026-01-10' });
    await generator.materializeForBill(bill);
    const before = await instancesOf(bill);
    expect(before.length).toBeGreaterThan(1);

    await update(bill, { frequency: 'ANNUALLY' });

    const after = await instancesOf(bill);
    expect(after.length).toBeLessThan(before.length);
    // The already-due monthly occurrence (due_date <= today) is historical
    // and is never touched by the rewrite — its date need not, and in
    // general will not, match the new annual pattern. Only the still-future
    // rows are required to track the new occurrence set.
    const future = after.filter((r) => r.dueDate > T());
    expect(future.length).toBeGreaterThan(0);
    expect(future.every((r) => r.dueDate.endsWith('-01-10'))).toBe(true);
  });

  it('keeps a protected instance even when its date leaves the set', async () => {
    const bill = await seedBill({ frequency: 'MONTHLY', startDate: '2026-01-10' });
    await generator.materializeForBill(bill);
    // Pick an actual materialized future row that will NOT survive the
    // switch to ANNUALLY (any month but January, anchored on the 10th).
    // Computing it independently via addMonths(T(), n) would only land on
    // day 10 when today's day-of-month happens to be 10.
    const future = (await instancesOf(bill)).filter((r) => r.dueDate > T());
    const orphan = future.find((r) => !r.dueDate.endsWith('-01-10'));
    if (!orphan) throw new Error('fixture expected a non-January future monthly row');
    const orphanDate = orphan.dueDate;
    await ds.getRepository(BillInstance).update(
      { id: orphan.id },
      { status: 'PAID', amountPaid: 100, paidAt: new Date() },
    );

    await update(bill, { frequency: 'ANNUALLY' });

    const survivor = await ds.getRepository(BillInstance).findOne({
      where: { billId: bill.id, dueDate: orphanDate },
    });
    expect(survivor).not.toBeNull();
    expect(survivor?.status).toBe('PAID');
  });

  it('removes future rewritable instances when the bill is deactivated', async () => {
    const bill = await seedBill();
    await generator.materializeForBill(bill);
    await plant(bill, addMonths(T(), 6), { status: 'PAID', amountPaid: 100 });

    await update(bill, { isActive: false });

    const after = await instancesOf(bill);
    expect(after.every((r) => r.status === 'PAID' || r.dueDate <= T())).toBe(true);
    expect(after.some((r) => r.status === 'PAID')).toBe(true);
  });

  it('regenerates when the bill is reactivated', async () => {
    const bill = await seedBill();
    await generator.materializeForBill(bill);
    await update(bill, { isActive: false });
    expect((await instancesOf(bill)).filter((r) => r.dueDate > T())).toHaveLength(0);

    await update(bill, { isActive: true });
    expect((await instancesOf(bill)).filter((r) => r.dueDate > T()).length).toBeGreaterThan(0);
  });

  it('extends the set when end_date is removed', async () => {
    const bill = await seedBill({ endDate: addMonths(T(), 2) });
    await generator.materializeForBill(bill);
    const before = (await instancesOf(bill)).length;
    await update(bill, { endDate: null });
    expect((await instancesOf(bill)).length).toBeGreaterThan(before);
  });
});
