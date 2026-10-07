import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import type { NotificationKind } from '@bill-tracker/shared-types';

/**
 * Deliberately carries no bill name, amount, or due date. A notification
 * is a pointer; every label is joined at read time (spec §3.2), the same
 * discipline `BillScheduler` states for overdue. Rename a bill and its
 * old reminders say the new name, which is what keeps the bell from ever
 * contradicting the dashboard.
 */
@Entity('notifications')
@Index(['userId', 'readAt'])
export class Notification {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @Column({ name: 'bill_instance_id', type: 'uuid' })
  billInstanceId!: string;

  @Column({ type: 'varchar', length: 20 })
  kind!: NotificationKind;

  @Column({ name: 'read_at', type: 'timestamptz', nullable: true })
  readAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
