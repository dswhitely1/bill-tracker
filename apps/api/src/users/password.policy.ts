import { BadRequestException } from '@nestjs/common';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_BYTES = 72;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function assertPasswordPolicy(plain: string): void {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new BadRequestException(
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
  if (Buffer.byteLength(plain, 'utf8') > MAX_PASSWORD_BYTES) {
    throw new BadRequestException(
      `Password must not exceed ${MAX_PASSWORD_BYTES} bytes`,
    );
  }
}
