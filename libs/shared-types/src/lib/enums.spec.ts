import { describe, expect, it } from 'vitest';
import { BILL_FREQUENCIES, BILL_STATUSES } from './enums';

describe('bill enums', () => {
  it('exposes exactly the four frequencies the schema CHECK allows', () => {
    expect(BILL_FREQUENCIES).toEqual(['ONE_TIME', 'WEEKLY', 'MONTHLY', 'ANNUALLY']);
  });

  it('exposes exactly the three statuses the schema CHECK allows', () => {
    expect(BILL_STATUSES).toEqual(['UNPAID', 'PAID', 'OVERDUE']);
  });
});
