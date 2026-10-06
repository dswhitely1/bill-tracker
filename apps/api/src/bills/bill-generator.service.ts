import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Bill } from './bill.entity';
import { occurrenceDates } from './occurrences';
import { today } from './dates';
import type { Env } from '../config/env.schema';

@Injectable()
export class BillGeneratorService {
  private readonly logger = new Logger(BillGeneratorService.name);

  constructor(
    @InjectRepository(Bill) private readonly bills: Repository<Bill>,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /** The single point where the application asks what day it is. */
  today(): string {
    return today(this.config.get('APP_TIMEZONE', { infer: true }));
  }

  /**
   * Inserts every occurrence the bill should have and returns how many rows
   * were new. `ON CONFLICT DO NOTHING` is what makes this idempotent and
   * what makes two processes running it concurrently safe — existing rows
   * are left exactly as they are, never reset.
   */
  async materializeForBill(bill: Bill, manager?: EntityManager): Promise<number> {
    const em = manager ?? this.bills.manager;
    if (!bill.isActive) return 0;

    const dates = occurrenceDates(
      { frequency: bill.frequency, startDate: bill.startDate, endDate: bill.endDate },
      this.today(),
    );
    if (dates.length === 0) return 0;

    // Parameterized multi-row insert. $1-$3 are shared; each date gets its own.
    const params: unknown[] = [bill.id, bill.userId, bill.defaultAmount];
    const tuples = dates.map((date) => {
      params.push(date);
      return `($1, $2, $${params.length}, $3)`;
    });

    const inserted: unknown[] = await em.query(
      `INSERT INTO "bill_instances" ("bill_id", "user_id", "due_date", "amount")
       VALUES ${tuples.join(', ')}
       ON CONFLICT ("bill_id", "due_date") DO NOTHING
       RETURNING "id"`,
      params,
    );
    return inserted.length;
  }

  /**
   * Materializes every active bill, isolating failures so one bad bill
   * cannot abort the sweep for the rest. This runs unattended (startup and
   * nightly, via `BillScheduler`) where there is no caller left to retry a
   * thrown error — the old all-or-nothing loop meant a single failing bill
   * silently stopped every bill after it in iteration order. Each failure
   * is logged with the bill's id and name so it can be found and fixed,
   * and a summary warning fires at the end if any bill failed, so a sweep
   * that materialized instances for every other bill never reports as a
   * clean, fully-successful run.
   */
  async materializeAll(): Promise<number> {
    const active = await this.bills.find({ where: { isActive: true } });
    let total = 0;
    let failures = 0;
    for (const bill of active) {
      try {
        total += await this.materializeForBill(bill);
      } catch (error) {
        failures += 1;
        this.logger.error(
          `materializeForBill failed for bill ${bill.id} ("${bill.name}")`,
          error as Error,
        );
      }
    }
    if (failures > 0) {
      this.logger.warn(
        `materializeAll completed with ${failures} failure(s) out of ${active.length} bill(s)`,
      );
    }
    return total;
  }

  /**
   * An instance is **rewritable** when it is in the future, untouched by
   * payment, and not individually customized. Template changes rewrite
   * those and nothing else — spec §5.4.
   *
   * `due_date > today` is strict, not `>=`: an occurrence that is already
   * due was billed at the old amount, and that is a historical fact. The
   * escape hatch for a genuine typo is PATCH on the instance itself.
   *
   * Amendment (spec §5.4): a fully reversed payment returns an instance to
   * `amount_paid = 0`, `status = 'UNPAID'`, `is_customized = false` —
   * satisfying every clause of REWRITABLE even though it has payment_logs
   * history. Deleting that row would cascade-delete that history, which
   * contradicts §6's append-only guarantee. So step 1's DELETE carries an
   * extra condition — no payment_logs row at all — that step 2's UPDATE
   * deliberately does not: repricing a genuinely unpaid future occurrence
   * is correct even if it was once paid and reversed, but deleting a row
   * destroys a record. Do not fold this into REWRITABLE itself; it must
   * apply to the DELETE only.
   */
  async rewriteForBill(bill: Bill, manager: EntityManager): Promise<void> {
    const t = this.today();
    const target = bill.isActive
      ? occurrenceDates(
          { frequency: bill.frequency, startDate: bill.startDate, endDate: bill.endDate },
          t,
        )
      : [];

    const REWRITABLE = `"due_date" > $2
        AND "status" = 'UNPAID'
        AND "amount_paid" = 0
        AND "is_customized" = false`;

    // 1. Drop rewritable instances whose date is no longer an occurrence.
    //    With an empty target (a deactivated bill) `= ANY('{}')` is false,
    //    so NOT(...) is true and every rewritable future row goes.
    //    The NOT EXISTS guard is the item-2 fix: an instance with any
    //    payment_logs row — even a fully reversed one — is never deleted,
    //    because payment_logs.bill_instance_id is ON DELETE CASCADE and
    //    that history is append-only truth, never erased.
    await manager.query(
      `DELETE FROM "bill_instances"
        WHERE "bill_id" = $1 AND ${REWRITABLE}
          AND NOT ("due_date" = ANY($3::date[]))
          AND NOT EXISTS (
            SELECT 1 FROM "payment_logs" pl
             WHERE pl."bill_instance_id" = "bill_instances"."id")`,
      [bill.id, t, target],
    );

    // 2. Repoint the amount on rewritable instances that remain, preserving
    //    their ids so a client holding one does not get a 404.
    await manager.query(
      `UPDATE "bill_instances" SET "amount" = $4, "updated_at" = now()
        WHERE "bill_id" = $1 AND ${REWRITABLE}
          AND "due_date" = ANY($3::date[])`,
      [bill.id, t, target, bill.defaultAmount],
    );

    // 3. Insert whatever the target set still lacks. ON CONFLICT DO NOTHING
    //    means a date already held by a paid or customized row stays as is.
    await this.materializeForBill(bill, manager);
  }
}
