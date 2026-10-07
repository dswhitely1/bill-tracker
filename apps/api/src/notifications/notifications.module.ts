import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillsModule } from '../bills/bills.module';
import { Notification } from './notification.entity';
import { RemindersService } from './reminders.service';
import { mailTransportProvider } from './mail/mail-transport.provider';

/**
 * `BillsModule` is imported for `BillGeneratorService`, which it exports.
 * Re-providing the generator here would give the reminder run its own
 * instance and its own answer to "what day is it" — the one thing the
 * timezone rule forbids.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Notification]), BillsModule],
  providers: [RemindersService, mailTransportProvider],
  exports: [RemindersService],
})
export class NotificationsModule {}
