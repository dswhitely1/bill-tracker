import { describe, expect, it } from 'vitest';
import { numericTransformer } from './numeric.transformer';

describe('numericTransformer', () => {
  it('converts the string PostgreSQL returns into a number', () => {
    expect(numericTransformer.from('142.00')).toBe(142);
    expect(numericTransformer.from('0.00')).toBe(0);
    expect(numericTransformer.from('1950.55')).toBe(1950.55);
  });

  it('passes null through in both directions', () => {
    expect(numericTransformer.from(null)).toBeNull();
    expect(numericTransformer.to(null)).toBeNull();
  });

  it('writes numbers out unchanged', () => {
    expect(numericTransformer.to(1950.55)).toBe(1950.55);
  });
});
