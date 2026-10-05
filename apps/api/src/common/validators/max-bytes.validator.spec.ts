import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';
import { MaxBytes } from './max-bytes.validator';

class Subject {
  @MaxBytes(72)
  value!: string;
}

const check = async (value: unknown) => {
  const subject = new Subject();
  (subject as { value: unknown }).value = value;
  return validate(subject);
};

describe('MaxBytes', () => {
  it('accepts a 72-byte ASCII string', async () => {
    expect(await check('a'.repeat(72))).toHaveLength(0);
  });

  it('rejects a 73-byte ASCII string', async () => {
    expect(await check('a'.repeat(73))).not.toHaveLength(0);
  });

  it('rejects a string legal in characters but illegal in bytes', async () => {
    // 72 three-byte characters = 216 bytes. String.length would allow this.
    const multibyte = '中'.repeat(72);
    expect(multibyte).toHaveLength(72);
    expect(Buffer.byteLength(multibyte, 'utf8')).toBe(216);
    expect(await check(multibyte)).not.toHaveLength(0);
  });

  it('rejects a non-string value rather than throwing', async () => {
    expect(await check(12345)).not.toHaveLength(0);
  });
});
