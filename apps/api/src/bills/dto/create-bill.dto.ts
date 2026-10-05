import {
  IsIn, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { BILL_FREQUENCIES } from '@bill-tracker/shared-types';
import type { BillFrequency, CreateBillRequest } from '@bill-tracker/shared-types';
import { IsIsoDate } from '../../common/validators/is-iso-date.validator';

/** The column is numeric(12,2); the DTO bound makes an oversized value a 400. */
const MAX_AMOUNT = 9999999999.99;

export class CreateBillDto implements CreateBillRequest {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  // maxDecimalPlaces rejects 142.005 rather than letting numeric(12,2)
  // silently round it; IsNumber rejects the string "1800.00".
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Max(MAX_AMOUNT)
  defaultAmount!: number;

  @IsIn(BILL_FREQUENCIES)
  frequency!: BillFrequency;

  @IsIsoDate()
  startDate!: string;

  @IsOptional()
  @IsIsoDate()
  endDate?: string | null;

  @IsOptional()
  @IsUUID()
  categoryId?: string | null;
}
