import { FormControl } from '@angular/forms';
import { describe, expect, it } from 'vitest';
import { MAX_AMOUNT, MIN_AMOUNT, amountValidators, formatMoney } from './money';

describe('formatMoney', () => {
  it('renders two decimal places and a currency symbol', () => {
    expect(formatMoney(1200)).toBe('$1,200.00');
  });

  it('renders cents', () => {
    expect(formatMoney(12.5)).toBe('$12.50');
  });

  it('renders zero', () => {
    expect(formatMoney(0)).toBe('$0.00');
  });
});

describe('amountValidators', () => {
  function validate(value: unknown) {
    return new FormControl(value, amountValidators).errors;
  }

  it('accepts a positive amount', () => {
    expect(validate(1200)).toBeNull();
  });

  it('accepts the smallest representable amount', () => {
    expect(validate(MIN_AMOUNT)).toBeNull();
  });

  it('rejects zero, because an amount must be greater than zero', () => {
    expect(validate(0)).not.toBeNull();
  });

  it('rejects a negative amount', () => {
    expect(validate(-1)).not.toBeNull();
  });

  it('rejects an amount past the column capacity, so it is a message and not a 400', () => {
    expect(validate(MAX_AMOUNT + 0.01)).not.toBeNull();
  });

  it('accepts the largest amount the column holds', () => {
    expect(validate(MAX_AMOUNT)).toBeNull();
  });

  it('rejects an empty value', () => {
    expect(validate(null)).not.toBeNull();
  });
});
