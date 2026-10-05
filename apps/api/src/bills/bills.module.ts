import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bill } from './bill.entity';
import { BillInstance } from './bill-instance.entity';
import { PaymentLog } from './payment-log.entity';
import { BillGeneratorService } from './bill-generator.service';

@Module({
  imports: [TypeOrmModule.forFeature([Bill, BillInstance, PaymentLog])],
  providers: [BillGeneratorService],
  exports: [BillGeneratorService],
})
export class BillsModule {}
