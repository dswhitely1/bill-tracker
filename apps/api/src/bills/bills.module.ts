import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bill } from './bill.entity';
import { BillInstance } from './bill-instance.entity';
import { PaymentLog } from './payment-log.entity';
import { Category } from '../categories/category.entity';
import { BillGeneratorService } from './bill-generator.service';
import { BillsService } from './bills.service';
import { BillsController } from './bills.controller';
import { BillInstancesService } from './bill-instances.service';
import { BillInstancesController } from './bill-instances.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Bill, BillInstance, PaymentLog, Category])],
  controllers: [BillsController, BillInstancesController],
  providers: [BillGeneratorService, BillsService, BillInstancesService],
  exports: [BillGeneratorService, BillInstancesService],
})
export class BillsModule {}
