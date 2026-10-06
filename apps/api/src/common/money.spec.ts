import { describe, expect, it } from 'vitest';
import { deriveStatus, round2 } from './money';

describe('round2', () => {
  it('removes binary floating-point dust', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
    expect(round2(142.005)).toBe(142.01);
    expect(round2(1950.5549999)).toBe(1950.55);
  });
});

describe('deriveStatus', () => {
  it('is UNPAID at zero and below', () => {
    expect(deriveStatus(100, 0)).toBe('UNPAID');
    expect(deriveStatus(100, -5)).toBe('UNPAID');
  });

  it('is PARTIALLY_PAID strictly between zero and the amount', () => {
    expect(deriveStatus(100, 0.01)).toBe('PARTIALLY_PAID');
    expect(deriveStatus(100, 99.99)).toBe('PARTIALLY_PAID');
  });

  it('is PAID at exactly the amount and above', () => {
    expect(deriveStatus(100, 100)).toBe('PAID');
    expect(deriveStatus(100, 100.01)).toBe('PAID');
  });
});
