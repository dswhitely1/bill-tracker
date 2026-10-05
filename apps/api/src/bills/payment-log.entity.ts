import {
  Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/user.entity';
import { BillInstance } from './bill-instance.entity';
import { numericTransformer } from '../common/numeric.transformer';

/** Append-only. Rows are never updated or deleted; a reversal is a new row. */
@Entity('payment_logs')
@Index(['billInstanceId'])
@Index(['userId', 'paidAt'])
export class PaymentLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'bill_instance_id', type: 'uuid' })
  billInstanceId!: string;

  @ManyToOne(() => BillInstance, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'bill_instance_id' })
  billInstance?: BillInstance;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user?: User;

  /** Negative on a reversal row. */
  @Column({
    name: 'amount_paid', type: 'numeric', precision: 12, scale: 2,
    transformer: numericTransformer,
  })
  amountPaid!: number;

  @Column({ name: 'paid_at', type: 'timestamptz' })
  paidAt!: Date;

  @Column({ type: 'varchar', length: 255, nullable: true })
  note!: string | null;

  @Column({ name: 'reverses_payment_id', type: 'uuid', nullable: true })
  reversesPaymentId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
