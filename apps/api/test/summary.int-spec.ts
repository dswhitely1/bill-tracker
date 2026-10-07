import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app/app.module';
import { BillGeneratorService } from '../src/bills/bill-generator.service';
import { SummaryService } from '../src/summary/summary.service';
import { Bill } from '../src/bills/bill.entity';
import { BillInstance } from '../src/bills/bill-instance.entity';
import { Category } from '../src/categories/category.entity';
import { User } from '../src/users/user.entity';
import { getTestDataSource, truncateAll } from './db';

let moduleRef: TestingModule;
let summary: SummaryService;
let generator: BillGeneratorService;
let ds: DataSource;

/** Every test pins the clock here so the buckets have fixed edges. */
const AS_OF = '2026-10-15';

beforeAll(async () => {
  process.env.ENV_FILE = '.env.test';
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  summary = moduleRef.get(SummaryService);
  generator = moduleRef.get(BillGeneratorService);
  ds = await getTestDataSource();
});

beforeEach(async () => {
  await truncateAll(ds);
  vi.spyOn(generator, 'today').mockReturnValue(AS_OF);
});

afterAll(async () => {
  vi.restoreAllMocks();
  await moduleRef?.close();
  if (ds?.isInitialized) await ds.destroy();
});

async function seedUser(): Promise<string> {
  const repo = ds.getRepository(User);
  const user = await repo.save(
    repo.create({
      email: `u${Math.random()}@example.com`,
      passwordHash: 'x'.repeat(60),
      name: 'U',
    }),
  );
  return user.id;
}

async function seedBill(userId: string, categoryId: string | null = null): Promise<string> {
  const repo = ds.getRepository(Bill);
  const bill = await repo.save(
    repo.create({
      userId,
      categoryId,
      name: 'Rent',
      defaultAmount: 100,
      frequency: 'MONTHLY',
      startDate: '2026-01-01',
      endDate: null,
      isActive: true,
    }),
  );
  return bill.id;
}

interface InstanceSeed {
  dueDate: string;
  amount?: number;
  amountPaid?: number;
  status?: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
}

async function seedInstance(userId: string, billId: string, seed: InstanceSeed): Promise<void> {
  const repo = ds.getRepository(BillInstance);
  await repo.save(
    repo.create({
      userId,
      billId,
      dueDate: seed.dueDate,
      amount: seed.amount ?? 100,
      amountPaid: seed.amountPaid ?? 0,
      status: seed.status ?? 'UNPAID',
      isCustomized: false,
      paidAt: null,
      note: null,
    }),
  );
}

describe('SummaryService buckets', () => {
  it('counts an instance due before asOf as overdue', async () => {
    const userId = await seedUser();
    const billId = await seedBill(userId);
    await seedInstance(userId, billId, { dueDate: '2026-10-14' });

    const result = await summary.get(userId);

    expect(result.asOf).toBe(AS_OF);
    expect(result.overdue.count).toBe(1);
    expect(result.overdue.amount).toBe(100);
    expect(result.next7Days.count).toBe(0);
  });

  it('treats an instance due exactly on asOf as not overdue but inside the next seven days', async () => {
    const userId = await seedUser();
    const billId = await seedBill(userId);
    await seedInstance(userId, billId, { dueDate: AS_OF });

    const result = await summary.get(userId);

    expect(result.overdue.count).toBe(0);
    expect(result.next7Days.count).toBe(1);
    expect(result.next7Days.amount).toBe(100);
  });

  it('includes asOf + 6 in the next seven days and excludes asOf + 7', async () => {
    const userId = await seedUser();
    const billId = await seedBill(userId);
    await seedInstance(userId, billId, { dueDate: '2026-10-21' }); // asOf + 6
    await seedInstance(userId, billId, { dueDate: '2026-10-22' }); // asOf + 7

    const result = await summary.get(userId);

    expect(result.next7Days.count).toBe(1);
    expect(result.next7Days.amount).toBe(100);
  });

  it('excludes a paid instance from both debt buckets but keeps it in the month', async () => {
    const userId = await seedUser();
    const billId = await seedBill(userId);
    await seedInstance(userId, billId, {
      dueDate: '2026-10-14',
      amountPaid: 100,
      status: 'PAID',
    });

    const result = await summary.get(userId);

    expect(result.overdue.count).toBe(0);
    expect(result.next7Days.count).toBe(0);
    expect(result.thisMonth.count).toBe(1);
    expect(result.thisMonth.total).toBe(100);
    expect(result.thisMonth.paid).toBe(100);
  });

  it('sums the unpaid remainder for a partly paid instance, not its face amount', async () => {
    const userId = await seedUser();
    const billId = await seedBill(userId);
    await seedInstance(userId, billId, {
      dueDate: '2026-10-14',
      amount: 100,
      amountPaid: 40,
      status: 'PARTIALLY_PAID',
    });

    const result = await summary.get(userId);

    expect(result.overdue.amount).toBe(60);
    expect(result.thisMonth.total).toBe(100);
    expect(result.thisMonth.paid).toBe(40);
  });

  it('bounds thisMonth to asOf’s calendar month', async () => {
    const userId = await seedUser();
    const billId = await seedBill(userId);
    await seedInstance(userId, billId, { dueDate: '2026-09-30' });
    await seedInstance(userId, billId, { dueDate: '2026-10-01' });
    await seedInstance(userId, billId, { dueDate: '2026-10-31' });
    await seedInstance(userId, billId, { dueDate: '2026-11-01' });

    const result = await summary.get(userId);

    expect(result.thisMonth.count).toBe(2);
  });

  it('reports the oldest unpaid overdue due date, as a YYYY-MM-DD string', async () => {
    const userId = await seedUser();
    const billId = await seedBill(userId);
    await seedInstance(userId, billId, { dueDate: '2025-03-04' });
    await seedInstance(userId, billId, { dueDate: '2026-10-14' });

    const result = await summary.get(userId);

    // A `date` column read through a raw query can arrive as a JS Date
    // unless it is cast. This asserts the cast, not merely the value.
    expect(typeof result.overdue.earliestDueDate).toBe('string');
    expect(result.overdue.earliestDueDate).toBe('2025-03-04');
  });

  it('reports a null earliest due date when nothing is overdue', async () => {
    const userId = await seedUser();
    const billId = await seedBill(userId);
    await seedInstance(userId, billId, { dueDate: '2026-10-20' });

    const result = await summary.get(userId);

    expect(result.overdue.earliestDueDate).toBeNull();
  });

  it('returns zeros rather than nulls for an account with no instances', async () => {
    const userId = await seedUser();

    const result = await summary.get(userId);

    expect(result.overdue).toEqual({ count: 0, amount: 0, earliestDueDate: null });
    expect(result.next7Days).toEqual({ count: 0, amount: 0 });
    expect(result.thisMonth).toEqual({ count: 0, total: 0, paid: 0 });
    expect(result.byCategory).toEqual([]);
  });
});

describe('SummaryService byCategory', () => {
  it('groups the month by category, ordered by total descending', async () => {
    const userId = await seedUser();
    const repo = ds.getRepository(Category);
    const small = await repo.save(repo.create({ userId, name: 'Small', color: '#111111' }));
    const large = await repo.save(repo.create({ userId, name: 'Large', color: '#222222' }));

    await seedInstance(userId, await seedBill(userId, small.id), {
      dueDate: '2026-10-05',
      amount: 25,
    });
    await seedInstance(userId, await seedBill(userId, large.id), {
      dueDate: '2026-10-06',
      amount: 300,
      amountPaid: 100,
      status: 'PARTIALLY_PAID',
    });

    const result = await summary.get(userId);

    expect(result.byCategory).toEqual([
      { categoryId: large.id, categoryName: 'Large', color: '#222222', total: 300, paid: 100 },
      { categoryId: small.id, categoryName: 'Small', color: '#111111', total: 25, paid: 0 },
    ]);
  });

  it('collects bills with no category into one null row', async () => {
    const userId = await seedUser();
    const billA = await seedBill(userId, null);
    const billB = await seedBill(userId, null);
    await seedInstance(userId, billA, { dueDate: '2026-10-05', amount: 10 });
    await seedInstance(userId, billB, { dueDate: '2026-10-06', amount: 20 });

    const result = await summary.get(userId);

    expect(result.byCategory).toEqual([
      { categoryId: null, categoryName: null, color: null, total: 30, paid: 0 },
    ]);
  });
});

describe('SummaryService user scoping', () => {
  it('scopes both the scalar buckets and byCategory to the requesting user, not the whole table', async () => {
    const categories = ds.getRepository(Category);

    const userA = await seedUser();
    const catA = await categories.save(categories.create({ userId: userA, name: 'CatA', color: '#aaaaaa' }));
    const billA = await seedBill(userA, catA.id);
    // Due before AS_OF (2026-10-15): lands in overdue and in thisMonth.
    await seedInstance(userA, billA, { dueDate: '2026-10-14', amount: 100 });

    const userB = await seedUser();
    const catB = await categories.save(categories.create({ userId: userB, name: 'CatB', color: '#bbbbbb' }));
    const billB = await seedBill(userB, catB.id);
    // Different amount so a cross-tenant leak produces a visibly wrong
    // number rather than a coincidentally equal one.
    await seedInstance(userB, billB, { dueDate: '2026-10-14', amount: 500 });

    const resultA = await summary.get(userA);
    expect(resultA.overdue).toEqual({ count: 1, amount: 100, earliestDueDate: '2026-10-14' });
    expect(resultA.thisMonth).toEqual({ count: 1, total: 100, paid: 0 });
    expect(resultA.byCategory).toEqual([
      { categoryId: catA.id, categoryName: 'CatA', color: '#aaaaaa', total: 100, paid: 0 },
    ]);

    const resultB = await summary.get(userB);
    expect(resultB.overdue).toEqual({ count: 1, amount: 500, earliestDueDate: '2026-10-14' });
    expect(resultB.thisMonth).toEqual({ count: 1, total: 500, paid: 0 });
    expect(resultB.byCategory).toEqual([
      { categoryId: catB.id, categoryName: 'CatB', color: '#bbbbbb', total: 500, paid: 0 },
    ]);
  });
});
