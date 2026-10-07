import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { SchedulerRegistry } from '@nestjs/schedule';
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

describe('scheduling under NODE_ENV=test', () => {
  it('registers no cron jobs, so no spec races a background write', async () => {
    const registry = moduleRef.get(SchedulerRegistry);
    expect(registry.getCronJobs().size).toBe(0);
  });

  it('rolls the horizon forward when called directly', async () => {
    const bill = await seedBill({ frequency: 'MONTHLY', startDate: '2026-01-01' });
    await generator.materializeAll();
    const first = (await instancesOf(bill)).length;

    // A second sweep on the same day adds nothing — the horizon has not moved.
    await generator.materializeAll();
    expect((await instancesOf(bill)).length).toBe(first);
  });

  it('provides the reminder scheduler even though it schedules nothing here', async () => {
    // If NotificationsModule were simply missing from AppModule, the
    // registry would also be empty — and the test above would pass for
    // the wrong reason.
    const { ReminderScheduler } = await import('../src/notifications/reminder.scheduler.js');
    expect(moduleRef.get(ReminderScheduler)).toBeInstanceOf(ReminderScheduler);
  });
});
