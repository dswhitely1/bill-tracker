import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bill } from './bill.entity';
import { BillInstance } from './bill-instance.entity';
import { PaymentLog } from './payment-log.entity';
import { Category } from '../categories/category.entity';
import { BillGeneratorService } from './bill-generator.service';
import { BillsService } from './bills.service';
import { BillsController } from './bills.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Bill, BillInstance, PaymentLog, Category])],
  controllers: [BillsController],
  providers: [BillGeneratorService, BillsService],
  exports: [BillGeneratorService],
})
export class BillsModule {}
