import type { BillResponse } from '@bill-tracker/shared-types';
import { Bill } from './bill.entity';

export const toBillResponse = (bill: Bill): BillResponse => ({
  id: bill.id,
  categoryId: bill.categoryId,
  name: bill.name,
  defaultAmount: bill.defaultAmount,
  frequency: bill.frequency,
  startDate: bill.startDate,
  endDate: bill.endDate,
  isActive: bill.isActive,
});
