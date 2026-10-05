import { IsBoolean, IsIn, IsOptional, IsUUID } from 'class-validator';
import { Transform } from 'class-transformer';
import { BILL_STATUSES } from '@bill-tracker/shared-types';
import type { BillStatus } from '@bill-tracker/shared-types';
import { IsIsoDate } from '../../common/validators/is-iso-date.validator';

export class ListInstancesDto {
  @IsIsoDate()
  from!: string;

  @IsIsoDate()
  to!: string;

  @IsOptional()
  @IsIn(BILL_STATUSES)
  status?: BillStatus;

  // Query strings carry 'true'/'false', never booleans. Anything else stays
  // a string and fails @IsBoolean with a 400 rather than silently meaning false.
  @IsOptional()
  @Transform(({ value }) =>
    value === 'true' ? true : value === 'false' ? false : value)
  @IsBoolean()
  overdue?: boolean;

  @IsOptional()
  @IsUUID()
  billId?: string;
}
