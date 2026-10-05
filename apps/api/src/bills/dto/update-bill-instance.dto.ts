import { IsNumber, IsOptional, IsString, Max, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { UpdateBillInstanceRequest } from '@bill-tracker/shared-types';

const MAX_AMOUNT = 9999999999.99;

/**
 * `dueDate` is deliberately absent — spec §7.2. Vacating a date would let
 * the generator re-create it on the next run; moving an occurrence is done
 * by editing the template. The global ValidationPipe runs with
 * `whitelist: true`, so a `dueDate` in the body is stripped, not applied.
 */
export class UpdateBillInstanceDto implements UpdateBillInstanceRequest {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Max(MAX_AMOUNT)
  amount?: number;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(255)
  note?: string | null;
}
