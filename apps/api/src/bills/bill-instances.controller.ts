import {
  Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query,
} from '@nestjs/common';
import { BillInstancesService } from './bill-instances.service';
import { PaymentsService } from './payments.service';
import { ListInstancesDto } from './dto/list-instances.dto';
import { UpdateBillInstanceDto } from './dto/update-bill-instance.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('bill-instances')
export class BillInstancesController {
  constructor(
    private readonly instances: BillInstancesService,
    private readonly payments: PaymentsService,
  ) {}

  @Get()
  findAll(@CurrentUser() userId: string, @Query() query: ListInstancesDto) {
    return this.instances.findAll(userId, query);
  }

  @Get(':id')
  findOne(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.instances.findOne(userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBillInstanceDto,
  ) {
    return this.instances.update(userId, id, dto);
  }

  @Post(':id/unpay')
  @HttpCode(HttpStatus.OK)
  unpay(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.payments.unpay(userId, id);
  }
}
