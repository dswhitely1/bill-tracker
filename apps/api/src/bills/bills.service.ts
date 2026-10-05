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
    await this.validate(userId, dto.defaultAmount, dto.startDate, dto.endDate ?? null,
      dto.categoryId ?? null);

    const bill = await this.bills.save(
      this.bills.create({
        userId,
        categoryId: dto.categoryId ?? null,
        name: dto.name,
        defaultAmount: dto.defaultAmount,
        frequency: dto.frequency,
        startDate: dto.startDate,
        endDate: dto.endDate ?? null,
        isActive: dto.isActive ?? true,
      }),
    );
    await this.generator.materializeForBill(bill);
    return toBillResponse(bill);
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
  async validate(
    userId: string, amount: number | undefined, startDate: string,
    endDate: string | null, categoryId: string | null,
  ): Promise<void> {
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
