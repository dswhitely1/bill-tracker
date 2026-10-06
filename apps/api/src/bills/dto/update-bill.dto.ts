import { IsBoolean, IsOptional } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { CreateBillDto } from './create-bill.dto';
import type { UpdateBillRequest } from '@bill-tracker/shared-types';

/**
 * Every template field is patchable, including isActive.
 *
 * `isActive` is deliberately NOT on `CreateBillRequest`/`CreateBillDto` — a
 * created bill is always active (spec §5.2's "every field" list for PATCH
 * is the only place it appears). `PartialType(CreateBillDto)` therefore
 * carries no `isActive` property at all, and the global
 * `ValidationPipe({ whitelist: true })` would silently drop an `isActive`
 * sent in a PATCH body before it ever reached the service. It is declared
 * explicitly here so it survives the whitelist.
 */
export class UpdateBillDto extends PartialType(CreateBillDto) implements UpdateBillRequest {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
