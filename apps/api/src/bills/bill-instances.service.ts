import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import type { BillInstanceResponse } from '@bill-tracker/shared-types';
import { BillInstance } from './bill-instance.entity';
import { Bill } from './bill.entity';
import { BillGeneratorService } from './bill-generator.service';
import { toInstanceResponse } from './mappers';
import { ListInstancesDto } from './dto/list-instances.dto';
import { UpdateBillInstanceDto } from './dto/update-bill-instance.dto';
import { paymentState } from './payment-state';
import { addDays, compare } from './dates';

/** The bounded range is this endpoint's pagination; there is no cursor. */
const MAX_RANGE_DAYS = 400;

@Injectable()
export class BillInstancesService {
  constructor(
    @InjectRepository(BillInstance) private readonly instances: Repository<BillInstance>,
    private readonly generator: BillGeneratorService,
  ) {}

  async findAll(userId: string, query: ListInstancesDto): Promise<BillInstanceResponse[]> {
    if (compare(query.to, query.from) < 0) {
      throw new BadRequestException('to must not be earlier than from');
    }
    if (compare(query.to, addDays(query.from, MAX_RANGE_DAYS)) > 0) {
      throw new BadRequestException(`the range must not exceed ${MAX_RANGE_DAYS} days`);
    }

    const today = this.generator.today();
    const qb = this.instances
      .createQueryBuilder('i')
      .innerJoinAndSelect('i.bill', 'b')
      .where('i.userId = :userId', { userId })
      .andWhere('i.dueDate >= :from', { from: query.from })
      .andWhere('i.dueDate <= :to', { to: query.to })
      .orderBy('i.dueDate', 'ASC')
      .addOrderBy('i.id', 'ASC'); // stable ties

    if (query.status !== undefined) {
      qb.andWhere('i.status = :status', { status: query.status });
    }
    if (query.billId !== undefined) {
      qb.andWhere('i.billId = :billId', { billId: query.billId });
    }
    if (query.overdue === true) {
      qb.andWhere("i.status <> 'PAID'").andWhere('i.dueDate < :today', { today });
    }
    if (query.overdue === false) {
      qb.andWhere("(i.status = 'PAID' OR i.dueDate >= :today)", { today });
    }

    const rows = await qb.getMany();
    return rows.map((row) => toInstanceResponse(row, row.bill as Bill, today));
  }

  async findOne(userId: string, id: string): Promise<BillInstanceResponse> {
    const row = await this.instances.findOne({
      where: { id, userId },
      relations: { bill: true },
    });
    if (!row) throw new NotFoundException('Bill instance not found');
    return toInstanceResponse(row, row.bill as Bill, this.generator.today());
  }

  async update(
    userId: string, id: string, dto: UpdateBillInstanceDto,
  ): Promise<BillInstanceResponse> {
    return this.instances.manager.transaction(async (manager) => {
      const { instance, bill } = await this.loadOwnedLocked(userId, id, manager);

      if (dto.amount !== undefined) {
        if (dto.amount <= 0) throw new BadRequestException('amount must be greater than 0');
        if (dto.amount < instance.amountPaid) {
          throw new BadRequestException(
            `amount must not be less than the ${instance.amountPaid.toFixed(2)} already paid`,
          );
        }
        instance.amount = dto.amount;
      }
      if (dto.note !== undefined) instance.note = dto.note ?? null;

      // Lowering the amount can complete a bill and raising it can un-complete
      // one, so the cached state is recomputed on every successful edit.
      await this.recompute(instance, manager);
      instance.isCustomized = true;

      const saved = await manager.getRepository(BillInstance).save(instance);
      return toInstanceResponse(saved, bill, this.generator.today());
    });
  }

  /**
   * Locks the instance row and loads its bill. Tasks 9 and 10 reuse this.
   *
   * Two queries rather than one `findOne` with `relations` and a lock:
   * TypeORM renders a relation as a LEFT JOIN, and PostgreSQL rejects
   * `FOR UPDATE` against the nullable side of an outer join. Both run on
   * `manager`, so they share the transaction's single connection — never
   * reach for `this.instances` inside here, which would draw a second
   * connection from the pool while holding a lock.
   */
  async loadOwnedLocked(
    userId: string, id: string, manager: EntityManager,
  ): Promise<{ instance: BillInstance; bill: Bill }> {
    const instance = await manager.getRepository(BillInstance).findOne({
      where: { id, userId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!instance) throw new NotFoundException('Bill instance not found');
    const bill = await manager.getRepository(Bill).findOneByOrFail({ id: instance.billId });
    return { instance, bill };
  }

  /** Mutates `instance` in place from its own payment log. */
  async recompute(instance: BillInstance, manager: EntityManager): Promise<void> {
    const events = await manager.query<Array<{ amount_paid: string; paid_at: Date }>>(
      `SELECT "amount_paid", "paid_at" FROM "payment_logs" WHERE "bill_instance_id" = $1`,
      [instance.id],
    );
    const state = paymentState(
      instance.amount,
      events.map((e) => ({ amountPaid: Number(e.amount_paid), paidAt: new Date(e.paid_at) })),
    );
    instance.amountPaid = state.amountPaid;
    instance.status = state.status;
    instance.paidAt = state.paidAt;
  }
}
