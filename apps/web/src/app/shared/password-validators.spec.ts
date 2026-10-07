import { FormControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { maxBytesValidator } from './password-validators';

function validate(value: string) {
  return new FormControl(value, [maxBytesValidator(72)]).errors;
}

describe('maxBytesValidator', () => {
  it('accepts a short password', () => {
    expect(validate('hunter22')).toBeNull();
  });

  it('accepts exactly the limit in ASCII', () => {
    expect(validate('a'.repeat(72))).toBeNull();
  });

  it('rejects one ASCII character past the limit', () => {
    expect(validate('a'.repeat(73))).not.toBeNull();
  });

  it('counts bytes, not characters', () => {
    // bcrypt truncates at 72 *bytes*. Twenty-five four-byte emoji are 25
    // characters and 100 bytes: a length check would accept them, and the
    // server would silently authenticate a shorter prefix.
    const emoji = '😀'.repeat(25);
    expect(emoji.length).toBe(50);
    expect(validate(emoji)).not.toBeNull();
  });

  it('reports the limit and the actual size, so the message can say both', () => {
    expect(validate('a'.repeat(80))).toEqual({ maxBytes: { limit: 72, actual: 80 } });
  });

  it('accepts an empty value and leaves required to Validators.required', () => {
    expect(validate('')).toBeNull();
  });
});
