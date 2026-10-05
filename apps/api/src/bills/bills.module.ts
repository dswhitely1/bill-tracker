import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Bill } from './bill.entity';
import { BillInstance } from './bill-instance.entity';
import { PaymentLog } from './payment-log.entity';
import { Category } from '../categories/category.entity';
import { BillGeneratorService } from './bill-generator.service';
import { BillScheduler } from './bill.scheduler';
import { BillsService } from './bills.service';
import { BillsController } from './bills.controller';
import { BillInstancesService } from './bill-instances.service';
import { BillInstancesController } from './bill-instances.controller';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Bill, BillInstance, PaymentLog, Category])],
  // Registration order here does not matter: Express/Nest route matching
  // requires an exact path-segment count and ":id" never crosses a "/", so
  // BillInstancesController's `bill-instances/:id` (2 segments) can never
  // match a request for `bill-instances/:id/payments` (3 segments)
  // regardless of which controller is tried first. Verified empirically
  // during Task 9 by swapping the order below and re-running the e2e
  // suite — both orders pass identically.
  controllers: [BillsController, BillInstancesController, PaymentsController],
  providers: [
    BillGeneratorService,
    BillScheduler,
    BillsService,
    BillInstancesService,
    PaymentsService,
  ],
  exports: [BillGeneratorService, BillInstancesService],
})
export class BillsModule {}
