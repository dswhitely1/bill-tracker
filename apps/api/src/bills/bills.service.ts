import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { BillResponse } from '@bill-tracker/shared-types';
import { Bill } from './bill.entity';
import { Category } from '../categories/category.entity';
import { BillGeneratorService } from './bill-generator.service';
import { toBillResponse } from './mappers';
import { CreateBillDto } from './dto/create-bill.dto';
import { compare } from './dates';

export interface BillValidationFields {
  amount?: number;
  startDate: string;
  endDate: string | null;
  categoryId: string | null;
}

@Injectable()
export class BillsService {
  constructor(
    @InjectRepository(Bill) private readonly bills: Repository<Bill>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    private readonly generator: BillGeneratorService,
  ) {}

  async findAll(userId: string, isActive?: boolean): Promise<BillResponse[]> {
    const rows = await this.bills.find({
      where: isActive === undefined ? { userId } : { userId, isActive },
      order: { name: 'ASC' },
    });
    return rows.map(toBillResponse);
  }

  async findOne(userId: string, id: string): Promise<BillResponse> {
    return toBillResponse(await this.loadOwned(userId, id));
  }

  async create(userId: string, dto: CreateBillDto): Promise<BillResponse> {
    // Runs against the request-scoped repositories, BEFORE the transaction
    // below opens — it must never draw a second connection from the pool
    // while that transaction holds one.
    await this.validate(userId, {
      amount: dto.defaultAmount,
      startDate: dto.startDate,
      endDate: dto.endDate ?? null,
      categoryId: dto.categoryId ?? null,
    });

    // One transaction: a bill row with no materialized instances must never
    // be observable. Every query inside uses `manager`, never `this.bills` —
    // drawing a second connection from the pool while this one holds a
    // transaction is how a previous sub-project self-deadlocked.
    return this.bills.manager.transaction(async (manager) => {
      const bill = await manager.save(
        Bill,
        manager.create(Bill, {
          userId,
          categoryId: dto.categoryId ?? null,
          name: dto.name,
          defaultAmount: dto.defaultAmount,
          frequency: dto.frequency,
          startDate: dto.startDate,
          endDate: dto.endDate ?? null,
          isActive: true,
        }),
      );
      await this.generator.materializeForBill(bill, manager);
      return toBillResponse(bill);
    });
  }

  async remove(userId: string, id: string): Promise<void> {
    // Instances and payment logs go with it, by the foreign keys. The
    // non-destructive path is PATCH { isActive: false }.
    const result = await this.bills.delete({ id, userId });
    if (!result.affected) throw new NotFoundException('Bill not found');
  }

  /** Shared by findOne and, from Task 7, update. 404 — never 403. */
  async loadOwned(userId: string, id: string): Promise<Bill> {
    const bill = await this.bills.findOne({ where: { id, userId } });
    if (!bill) throw new NotFoundException('Bill not found');
    return bill;
  }

  /** The cross-field and ownership rules no single-field decorator can state. */
  async validate(userId: string, fields: BillValidationFields): Promise<void> {
    const { amount, startDate, endDate, categoryId } = fields;
    if (amount !== undefined && amount <= 0) {
      throw new BadRequestException('defaultAmount must be greater than 0');
    }
    if (endDate !== null && compare(endDate, startDate) < 0) {
      throw new BadRequestException('endDate must not be earlier than startDate');
    }
    if (categoryId !== null) {
      // Scoped to userId, so another user's category is indistinguishable
      // from one that does not exist.
      const owned = await this.categories.findOne({ where: { id: categoryId, userId } });
      if (!owned) throw new BadRequestException('categoryId does not name a category you own');
    }
  }
}
