import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { RecordPaymentDto } from './dto/record-payment.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('bill-instances/:id/payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get()
  list(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.list(userId, id);
  }

  @Post()
  record(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RecordPaymentDto,
  ) {
    return this.payments.record(userId, id, dto);
  }
}
