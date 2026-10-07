import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BillInstance } from '../bills/bill-instance.entity';
import { BillsModule } from '../bills/bills.module';
import { SummaryController } from './summary.controller';
import { SummaryService } from './summary.service';

/**
 * `BillsModule` is imported for `BillGeneratorService`, which it exports.
 * Re-providing the generator here would give the summary its own instance
 * and its own answer to "what day is it" — the one thing §3.2 forbids.
 */
@Module({
  imports: [TypeOrmModule.forFeature([BillInstance]), BillsModule],
  controllers: [SummaryController],
  providers: [SummaryService],
  exports: [SummaryService],
})
export class SummaryModule {}
