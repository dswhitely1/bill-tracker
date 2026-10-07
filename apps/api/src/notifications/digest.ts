import type { NotificationKind } from '@bill-tracker/shared-types';
import type { MailMessage } from './mail/mail-transport';

export interface DigestRecipient {
  email: string;
  name: string;
}

export interface DigestItem {
  kind: NotificationKind;
  billName: string;
  /** `YYYY-MM-DD`. Never parsed — only printed. */
  dueDate: string;
  /** The outstanding balance, already computed by the caller. */
  amountDue: number;
}

const HORIZON: Record<NotificationKind, string> = {
  DUE_TOMORROW: 'Tomorrow',
  DUE_IN_3_DAYS: 'In 3 days',
};

const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/**
 * Pure: no database, no clock, no configuration. Everything it needs is
 * in its arguments, which is what lets `digest.spec.ts` assert the exact
 * bytes of the message.
 *
 * Returns null for an empty list. The run decides its recipients from the
 * `RETURNING` set, so it never calls this with nothing; null makes a
 * future caller's mistake visible rather than mailing a blank page.
 */
export function renderDigest(
  recipient: DigestRecipient,
  items: DigestItem[],
): MailMessage | null {
  if (items.length === 0) return null;

  // Sorted here rather than in SQL so the ordering is a property of the
  // message and is testable without a database. `localeCompare` breaks the
  // same-day tie, which keeps two runs over the same data byte-identical.
  const ordered = [...items].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || a.billName.localeCompare(b.billName),
  );

  const lines = ordered.map(
    (item) =>
      `  ${HORIZON[item.kind]} (${item.dueDate}) — ${item.billName} — ${MONEY.format(item.amountDue)}`,
  );

  const noun = items.length === 1 ? 'bill' : 'bills';

  return {
    to: recipient.email,
    subject: `${items.length} ${noun} due soon`,
    text: [
      `Hi ${recipient.name},`,
      '',
      `${items.length} ${noun} ${items.length === 1 ? 'is' : 'are'} coming up:`,
      '',
      ...lines,
      '',
      'Open Bill Tracker to record a payment.',
      '',
      '— Bill Tracker',
    ].join('\n'),
  };
}
