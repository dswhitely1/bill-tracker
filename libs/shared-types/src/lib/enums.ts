export const BILL_FREQUENCIES = ['ONE_TIME', 'WEEKLY', 'MONTHLY', 'ANNUALLY'] as const;
export type BillFrequency = (typeof BILL_FREQUENCIES)[number];

export const BILL_STATUSES = ['UNPAID', 'PAID', 'OVERDUE'] as const;
export type BillStatus = (typeof BILL_STATUSES)[number];
