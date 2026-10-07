import { describe, expect, it } from 'vitest';
import type { NotificationItem } from '@bill-tracker/shared-types';
import { kindLabel, notificationLink } from './notification-text';

const item: NotificationItem = {
  id: 'n1',
  kind: 'DUE_TOMORROW',
  isRead: false,
  createdAt: '2026-10-07T08:00:00.000Z',
  billInstanceId: 'bi1',
  billId: 'b1',
  billName: 'Rent',
  dueDate: '2026-10-08',
  amountDue: 1200,
  isResolved: false,
};

describe('kindLabel', () => {
  it('names each horizon in words', () => {
    expect(kindLabel('DUE_TOMORROW')).toBe('Due tomorrow');
    expect(kindLabel('DUE_IN_3_DAYS')).toBe('Due in 3 days');
  });
});

describe('notificationLink', () => {
  it('isolates the bill on its own due date', () => {
    const params = notificationLink(item);
    expect(params).toMatchObject({ from: '2026-10-08', to: '2026-10-08', billId: 'b1' });
  });

  it('carries no leftover filter that could hide the row', () => {
    // A same-day from/to pair satisfies the parser's forwards and
    // 400-day checks trivially, and `status` must stay absent — a paid
    // reminder's row would otherwise be filtered out of the very list
    // the notification sent the user to.
    const params = notificationLink({ ...item, isResolved: true });
    expect(params['status']).toBeUndefined();
    expect(params['overdue']).toBeUndefined();
    expect(params['q']).toBeUndefined();
  });
});
