import { describe, expect, it } from 'vitest';
import { assertPasswordPolicy, normalizeEmail } from './password.policy';

describe('assertPasswordPolicy', () => {
  it('accepts an ordinary 8-character password', () => {
    expect(() => assertPasswordPolicy('hunter22')).not.toThrow();
  });

  it('rejects a 7-character password', () => {
    expect(() => assertPasswordPolicy('hunter2')).toThrow(/8/);
  });

  it('rejects a password over 72 BYTES even when its character count is legal', () => {
    // 25 four-byte emoji = 100 bytes, but only 25 JS code points.
    const emojiPassword = '\u{1F512}'.repeat(25);
    expect(emojiPassword.length).toBeLessThan(72);
    expect(Buffer.byteLength(emojiPassword, 'utf8')).toBeGreaterThan(72);
    expect(() => assertPasswordPolicy(emojiPassword)).toThrow(/72 bytes/);
  });

  it('accepts a password of exactly 72 bytes', () => {
    expect(() => assertPasswordPolicy('a'.repeat(72))).not.toThrow();
  });

  it('rejects a password of 73 bytes', () => {
    expect(() => assertPasswordPolicy('a'.repeat(73))).toThrow(/72 bytes/);
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims so case and padding cannot create a second account', () => {
    expect(normalizeEmail('  Don@Example.COM  ')).toBe('don@example.com');
  });

  it('is idempotent', () => {
    expect(normalizeEmail(normalizeEmail(' A@B.Co '))).toBe('a@b.co');
  });
});
