import { describe, expect, it } from 'vitest';
import { BILL_FREQUENCIES, BILL_STATUSES } from './enums.js';

describe('bill enums', () => {
  it('exposes exactly the four frequencies the schema CHECK allows', () => {
    expect(BILL_FREQUENCIES).toEqual(['ONE_TIME', 'WEEKLY', 'MONTHLY', 'ANNUALLY']);
  });

  it('describes payment progress only, with no OVERDUE member', () => {
    expect(BILL_STATUSES).toEqual(['UNPAID', 'PARTIALLY_PAID', 'PAID']);
    expect(BILL_STATUSES).not.toContain('OVERDUE');
  });
});
