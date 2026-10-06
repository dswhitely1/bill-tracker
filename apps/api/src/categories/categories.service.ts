import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Category } from './category.entity';
import { Bill } from '../bills/bill.entity';
import type {
  CategoryResponse, CreateCategoryRequest, UpdateCategoryRequest,
} from '@bill-tracker/shared-types';

const toResponse = (c: Category): CategoryResponse => ({
  id: c.id, name: c.name, color: c.color,
});

@Injectable()
export class CategoriesService {
  constructor(
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    @InjectRepository(Bill) private readonly bills: Repository<Bill>,
  ) {}

  async findAll(userId: string): Promise<CategoryResponse[]> {
    const rows = await this.categories.find({ where: { userId }, order: { name: 'ASC' } });
    return rows.map(toResponse);
  }

  async create(userId: string, dto: CreateCategoryRequest): Promise<CategoryResponse> {
    const saved = await this.categories.save(
      this.categories.create({ userId, name: dto.name, color: dto.color ?? null }),
    );
    return toResponse(saved);
  }

  async update(
    userId: string, id: string, dto: UpdateCategoryRequest,
  ): Promise<CategoryResponse> {
    const existing = await this.categories.findOne({ where: { id, userId } });
    if (!existing) throw new NotFoundException('Category not found');
    if (dto.name !== undefined) existing.name = dto.name;
    if (dto.color !== undefined) existing.color = dto.color ?? null;
    return toResponse(await this.categories.save(existing));
  }

  async remove(userId: string, id: string): Promise<void> {
    // Scoped to userId: another user's bill must never make this user's
    // category undeletable.
    const used = await this.bills.count({ where: { categoryId: id, userId } });
    if (used > 0) {
      throw new ConflictException(
        `This category is used by ${used} bill(s). Reassign or delete them first.`,
      );
    }
    const result = await this.categories.delete({ id, userId });
    if (!result.affected) throw new NotFoundException('Category not found');
  }
}
