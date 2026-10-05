import { IsISO8601, IsNumber, IsOptional, IsString, Max, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { RecordPaymentRequest } from '@bill-tracker/shared-types';

const MAX_AMOUNT = 9999999999.99;

export class RecordPaymentDto implements RecordPaymentRequest {
  /**
   * Omitted means the full remaining balance, which is what makes one-click
   * "mark paid" and a partial payment the same endpoint — spec §6.2.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2, allowNaN: false, allowInfinity: false })
  @Max(MAX_AMOUNT)
  amount?: number;

  @IsOptional()
  @IsISO8601()
  paidAt?: string;

  @IsOptional()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MaxLength(255)
  note?: string | null;
}
