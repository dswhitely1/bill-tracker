import { IsString, MaxLength, MinLength } from 'class-validator';
import type { ChangePasswordRequest } from '@bill-tracker/shared-types';
import { MaxBytes } from '../../common/validators/max-bytes.validator';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from '../password.policy';

export class ChangePasswordDto implements ChangePasswordRequest {
  @IsString() @MaxLength(200) currentPassword!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxBytes(MAX_PASSWORD_BYTES)
  newPassword!: string;
}
