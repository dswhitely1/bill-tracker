import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  PrimaryGeneratedColumn, UpdateDateColumn,
} from 'typeorm';
import type { BillFrequency } from '@bill-tracker/shared-types';
import { User } from '../users/user.entity';
import { Category } from '../categories/category.entity';
import { numericTransformer } from '../common/numeric.transformer';

@Entity('bills')
@Index(['userId'])
export class Bill {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => Category, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'category_id' })
  category?: Category | null;

  @Column({ type: 'varchar', length: 100 })
  name!: string;

  @Column({
    name: 'default_amount', type: 'numeric', precision: 12, scale: 2,
    transformer: numericTransformer,
  })
  defaultAmount!: number;

  @Column({ type: 'varchar', length: 20 })
  frequency!: BillFrequency;

  // `date` columns are strings end to end. Never a Date.
  @Column({ name: 'start_date', type: 'date' })
  startDate!: string;

  @Column({ name: 'end_date', type: 'date', nullable: true })
  endDate!: string | null;

  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
