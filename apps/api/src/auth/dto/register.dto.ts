import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';
import type { RegisterRequest } from '@bill-tracker/shared-types';
import { MaxBytes } from '../../common/validators/max-bytes.validator';
import { MAX_PASSWORD_BYTES, MIN_PASSWORD_LENGTH } from '../../users/password.policy';

export class RegisterDto implements RegisterRequest {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  @IsString()
  @MinLength(MIN_PASSWORD_LENGTH)
  @MaxBytes(MAX_PASSWORD_BYTES)
  password!: string;
}
