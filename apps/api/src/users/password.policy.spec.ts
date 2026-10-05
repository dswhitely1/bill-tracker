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
    // 25 emoji: 100 bytes in UTF-8, but .length is 50 (UTF-16 surrogate pairs).
    // Both measures sit on opposite sides of the 72 threshold, which is what
    // makes this test able to distinguish byteLength from length.
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
