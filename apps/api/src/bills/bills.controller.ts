import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseBoolPipe, ParseUUIDPipe,
  Patch, Post, Query,
} from '@nestjs/common';
import { BillsService } from './bills.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@Controller('bills')
export class BillsController {
  constructor(private readonly bills: BillsService) {}

  @Get()
  findAll(
    @CurrentUser() userId: string,
    @Query('isActive', new ParseBoolPipe({ optional: true })) isActive?: boolean,
  ) {
    return this.bills.findAll(userId, isActive);
  }

  @Post()
  create(@CurrentUser() userId: string, @Body() dto: CreateBillDto) {
    return this.bills.create(userId, dto);
  }

  @Get(':id')
  findOne(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.bills.findOne(userId, id);
  }

  @Patch(':id')
  update(
    @CurrentUser() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateBillDto,
  ) {
    return this.bills.update(userId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@CurrentUser() userId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.bills.remove(userId, id);
  }
}
