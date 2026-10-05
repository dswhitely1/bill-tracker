import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Bill } from './bill.entity';
import { occurrenceDates } from './occurrences';
import { today } from './dates';
import type { Env } from '../config/env.schema';

@Injectable()
export class BillGeneratorService {
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

  async materializeAll(): Promise<number> {
    const active = await this.bills.find({ where: { isActive: true } });
    let total = 0;
    for (const bill of active) {
      total += await this.materializeForBill(bill);
    }
    return total;
  }
}
