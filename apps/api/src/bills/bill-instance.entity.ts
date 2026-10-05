import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  PrimaryGeneratedColumn, Unique, UpdateDateColumn,
} from 'typeorm';
import type { BillStatus } from '@bill-tracker/shared-types';
import { User } from '../users/user.entity';
import { Bill } from './bill.entity';
import { numericTransformer } from '../common/numeric.transformer';

@Entity('bill_instances')
@Unique('UQ_bill_instances_bill_due', ['billId', 'dueDate'])
@Index(['userId', 'dueDate'])
@Index(['userId', 'status', 'dueDate'])
export class BillInstance {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'bill_id', type: 'uuid' })
  billId!: string;

  @ManyToOne(() => Bill, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bill_id' })
  bill?: Bill;

  // Denormalized deliberately: ownership checks and range queries need no
  // join through bills. A conscious normalization trade-off.
  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  @Column({ name: 'due_date', type: 'date' })
  dueDate!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2, transformer: numericTransformer })
  amount!: number;

  /** Cache of SUM(payment_logs.amount_paid), recomputed in the same transaction. */
  @Column({
    name: 'amount_paid', type: 'numeric', precision: 12, scale: 2, default: 0,
    transformer: numericTransformer,
  })
  amountPaid!: number;

  @Column({ type: 'varchar', length: 20, default: 'UNPAID' })
  status!: BillStatus;

  /** Set by a direct edit. Protects the row from template rewrites. */
  @Column({ name: 'is_customized', type: 'boolean', default: false })
  isCustomized!: boolean;

  @Column({ name: 'paid_at', type: 'timestamptz', nullable: true })
  paidAt!: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
