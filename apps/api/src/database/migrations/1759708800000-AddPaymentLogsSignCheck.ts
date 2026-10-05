import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Closes a gap left by the Task 10 reversal logic: both `reverse()` and
 * `unpay()` classify a row as "a reversal" solely by
 * `reverses_payment_id IS NOT NULL`, and otherwise treat it as an
 * unreversed positive payment. Nothing in the schema enforced that a row
 * with a NULL `reverses_payment_id` is actually positive — that held only
 * because `record()` happens to be the sole writer of such rows today and
 * validates `amount > 0` itself. A future write path that skipped the
 * service (an admin script, a data-fix migration, a bulk import) could
 * insert a negative-amount row with no `reverses_payment_id`, and both
 * `reverse()` and `unpay()` would then append a *positive* "reversal" of
 * it — compounding the balance instead of undoing it, silently.
 *
 * Spec §3 justifies `UQ_payment_logs_reverses` in exactly these terms:
 * "the database guarantee that a payment is reversed at most once,
 * independent of any service-level check." This constraint is the same
 * guarantee applied to the sign invariant: a row is either a reversal
 * (has `reverses_payment_id`) or it must be positive. A reversal row's
 * own sign is intentionally left unconstrained here — the service always
 * produces negative reversals, but nothing downstream depends on the
 * database also enforcing that direction.
 */
export class AddPaymentLogsSignCheck1759708800000 implements MigrationInterface {
  name = 'AddPaymentLogsSignCheck1759708800000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      ALTER TABLE "payment_logs"
        ADD CONSTRAINT "CHK_payment_logs_sign"
        CHECK ("reverses_payment_id" IS NOT NULL OR "amount_paid" > 0)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "payment_logs" DROP CONSTRAINT "CHK_payment_logs_sign"`);
  }
}
