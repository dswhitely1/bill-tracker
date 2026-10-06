import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBillTables1759622400000 implements MigrationInterface {
  name = 'AddBillTables1759622400000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE "bills" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "category_id" uuid REFERENCES "categories"("id") ON DELETE SET NULL,
        "name" varchar(100) NOT NULL,
        "default_amount" numeric(12,2) NOT NULL,
        "frequency" varchar(20) NOT NULL,
        "start_date" date NOT NULL,
        "end_date" date,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_bills_frequency"
          CHECK ("frequency" IN ('ONE_TIME','WEEKLY','MONTHLY','ANNUALLY')),
        CONSTRAINT "CHK_bills_default_amount" CHECK ("default_amount" > 0),
        CONSTRAINT "CHK_bills_end_date"
          CHECK ("end_date" IS NULL OR "end_date" >= "start_date")
      )`);
    await q.query(`CREATE INDEX "IDX_bills_user_id" ON "bills" ("user_id")`);

    await q.query(`
      CREATE TABLE "bill_instances" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "bill_id" uuid NOT NULL REFERENCES "bills"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "due_date" date NOT NULL,
        "amount" numeric(12,2) NOT NULL,
        "amount_paid" numeric(12,2) NOT NULL DEFAULT 0,
        "status" varchar(20) NOT NULL DEFAULT 'UNPAID',
        "is_customized" boolean NOT NULL DEFAULT false,
        "paid_at" timestamptz,
        "note" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_bill_instances_bill_due" UNIQUE ("bill_id","due_date"),
        CONSTRAINT "CHK_bill_instances_status"
          CHECK ("status" IN ('UNPAID','PARTIALLY_PAID','PAID')),
        CONSTRAINT "CHK_bill_instances_amount" CHECK ("amount" > 0)
      )`);
    await q.query(
      `CREATE INDEX "IDX_bill_instances_user_due" ON "bill_instances" ("user_id","due_date")`,
    );
    await q.query(
      `CREATE INDEX "IDX_bill_instances_user_status_due"
         ON "bill_instances" ("user_id","status","due_date")`,
    );
    await q.query(
      `CREATE INDEX "IDX_bill_instances_bill_id" ON "bill_instances" ("bill_id")`,
    );

    await q.query(`
      CREATE TABLE "payment_logs" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "bill_instance_id" uuid NOT NULL
          REFERENCES "bill_instances"("id") ON DELETE CASCADE,
        "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "amount_paid" numeric(12,2) NOT NULL,
        "paid_at" timestamptz NOT NULL,
        "note" varchar(255),
        "reverses_payment_id" uuid REFERENCES "payment_logs"("id") ON DELETE CASCADE,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CHK_payment_logs_amount_nonzero" CHECK ("amount_paid" <> 0)
      )`);
    await q.query(
      `CREATE INDEX "IDX_payment_logs_instance" ON "payment_logs" ("bill_instance_id")`,
    );
    await q.query(
      `CREATE INDEX "IDX_payment_logs_user_paid_at" ON "payment_logs" ("user_id","paid_at")`,
    );
    // Partial unique: the database guarantee that a payment is reversed at
    // most once, independent of any service-level check.
    await q.query(`
      CREATE UNIQUE INDEX "UQ_payment_logs_reverses"
        ON "payment_logs" ("reverses_payment_id")
        WHERE "reverses_payment_id" IS NOT NULL`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE "payment_logs"`);
    await q.query(`DROP TABLE "bill_instances"`);
    await q.query(`DROP TABLE "bills"`);
  }
}
