import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import type { DataSource } from 'typeorm';
import { AppModule } from '../src/app/app.module';
import { PaymentsService } from '../src/bills/payments.service';
import { Bill } from '../src/bills/bill.entity';
import { BillInstance } from '../src/bills/bill-instance.entity';
import { User } from '../src/users/user.entity';
import { getTestDataSource, truncateAll } from './db';

let moduleRef: TestingModule;
let payments: PaymentsService;
let ds: DataSource;

beforeAll(async () => {
  process.env.ENV_FILE = '.env.test';
  moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  await moduleRef.init();
  payments = moduleRef.get(PaymentsService);
  ds = await getTestDataSource();
});

beforeEach(async () => {
  await truncateAll(ds);
});

afterAll(async () => {
  await moduleRef?.close();
  if (ds?.isInitialized) await ds.destroy();
});

/** A fresh user, bill, and single instance — not through HTTP, so specs cannot interfere. */
const seedInstance = async (
  overrides: { amount: number },
): Promise<{ userId: string; instanceId: string }> => {
  const user = await ds.getRepository(User).save(
    ds.getRepository(User).create({
      email: `u${Math.random()}@example.com`, passwordHash: 'x'.repeat(60), name: 'U',
    }),
  );
  const bill = await ds.getRepository(Bill).save(
    ds.getRepository(Bill).create({
      userId: user.id, categoryId: null, name: 'Rent', defaultAmount: overrides.amount,
      frequency: 'MONTHLY', startDate: '2026-01-01', endDate: null, isActive: true,
    }),
  );
  const instance = await ds.getRepository(BillInstance).save(
    ds.getRepository(BillInstance).create({
      billId: bill.id, userId: user.id, dueDate: '2026-01-01', amount: overrides.amount,
    }),
  );
  return { userId: user.id, instanceId: instance.id };
};

describe('concurrent payments on one instance', () => {
  it('keeps amount_paid equal to the log sum and does not overpay', async () => {
    // A double-clicked "pay" button. The FOR UPDATE lock in
    // loadOwnedLocked is the only thing preventing both from seeing a
    // full balance and each paying it.
    const { instanceId, userId } = await seedInstance({ amount: 100 });

    const results = await Promise.allSettled([
      payments.record(userId, instanceId, {}),
      payments.record(userId, instanceId, {}),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(1); // the loser sees a zero balance and 400s

    const [row] = await ds.query(
      `SELECT bi.amount_paid::float8 AS cached,
              coalesce(sum(pl.amount_paid), 0)::float8 AS logged
         FROM bill_instances bi
         LEFT JOIN payment_logs pl ON pl.bill_instance_id = bi.id
        WHERE bi.id = $1 GROUP BY bi.amount_paid`,
      [instanceId],
    );
    expect(row.cached).toBe(row.logged);
    expect(row.cached).toBe(100);
  });

  it('keeps the cache equal to the log across many sequential partial payments', async () => {
    const { instanceId, userId } = await seedInstance({ amount: 10 });
    for (let i = 0; i < 10; i += 1) {
      await payments.record(userId, instanceId, { amount: 1 });
    }
    const [row] = await ds.query(
      `SELECT amount_paid::float8 AS cached, status FROM bill_instances WHERE id = $1`,
      [instanceId],
    );
    expect(row.cached).toBe(10);
    expect(row.status).toBe('PAID');
  });
});

describe('reversal uniqueness', () => {
  it('rejects a duplicate reversal at the database level, not just in the service', async () => {
    const { instanceId, userId: uid } = await seedInstance({ amount: 100 });
    const { payment } = await payments.record(uid, instanceId, { amount: 100 });
    await payments.reverse(uid, instanceId, payment.id);

    await expect(
      ds.query(
        `INSERT INTO "payment_logs"
           ("bill_instance_id","user_id","amount_paid","paid_at","reverses_payment_id")
         VALUES ($1, $2, -100, now(), $3)`,
        [instanceId, uid, payment.id],
      ),
    ).rejects.toThrow(/UQ_payment_logs_reverses|duplicate key/);
  });
});

describe('payment_logs sign invariant', () => {
  it('rejects a negative amount with no reverses_payment_id, at the database level', async () => {
    // A row with a NULL reverses_payment_id is, by the service's own
    // reading (see reverse() and unpay()), an unreversed positive payment.
    // Nothing stopped a non-service writer from inserting a negative one
    // before CHK_payment_logs_sign — this proves the database itself now
    // refuses that shape, independent of record()'s own `amount > 0` check.
    const { instanceId, userId: uid } = await seedInstance({ amount: 100 });

    await expect(
      ds.query(
        `INSERT INTO "payment_logs"
           ("bill_instance_id","user_id","amount_paid","paid_at","reverses_payment_id")
         VALUES ($1, $2, -50, now(), NULL)`,
        [instanceId, uid],
      ),
    ).rejects.toThrow(/CHK_payment_logs_sign|violates check constraint/);
  });
});

// Whether the constraint above rejects anything legitimate is proven by the
// rest of this suite and payments.e2e-spec.ts, not by a dedicated test here:
// record() inserts positive, null-reverses_payment_id rows throughout
// "concurrent payments on one instance" above, and reverse()/unpay() insert
// negative, non-null-reverses_payment_id rows throughout payments.e2e-spec.ts
// — both shapes the constraint must accept, and both already pass.
