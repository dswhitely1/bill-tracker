import { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';

const ENCODER = new TextEncoder();

/**
 * bcrypt silently truncates input beyond 72 **bytes**, so the API caps
 * passwords there (foundation spec §7). A character-length check would
 * accept a 50-character string of four-byte emoji — 200 bytes — and the
 * server would authenticate a 72-byte prefix of it without telling anyone.
 */
export function maxBytesValidator(limit: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = control.value;
    if (typeof value !== 'string' || value === '') return null;

    const actual = ENCODER.encode(value).length;
    return actual > limit ? { maxBytes: { limit, actual } } : null;
  };
}
