import { describe, expect, it } from 'vitest';
import { DigestItem, renderDigest } from './digest';
import type { MailMessage } from './mail/mail-transport';

const recipient = { email: 'don@example.com', name: 'Don' };

const rent: DigestItem = {
  kind: 'DUE_IN_3_DAYS',
  billName: 'Rent',
  dueDate: '2026-10-10',
  amountDue: 1200,
};
const power: DigestItem = {
  kind: 'DUE_TOMORROW',
  billName: 'Electric',
  dueDate: '2026-10-08',
  amountDue: 84.5,
};

// `renderDigest` returns `MailMessage | null` — null only for an empty list,
// which the last test below asserts directly. Every other test has a
// non-empty list, so this helper asserts the non-null case once and hands
// back a `MailMessage` instead of repeating the null check everywhere.
const render = (items: DigestItem[]): MailMessage => {
  const message = renderDigest(recipient, items);
  expect(message).not.toBeNull();
  return message as MailMessage;
};

describe('renderDigest', () => {
  it('addresses the recipient and names the count in the singular', () => {
    const message = render([rent]);
    expect(message.to).toBe('don@example.com');
    expect(message.subject).toBe('1 bill due soon');
    expect(message.text).toContain('Hi Don,');
  });

  it('pluralizes the count', () => {
    expect(render([rent, power]).subject).toBe('2 bills due soon');
  });

  it('puts the most urgent bill first, whatever order it arrives in', () => {
    // Rent is passed first but falls later. Ordering by the caller's array
    // would bury tomorrow's bill below one three days out.
    const text = render([rent, power]).text;
    expect(text.indexOf('Electric')).toBeLessThan(text.indexOf('Rent'));
  });

  it('breaks a same-day tie by bill name, so two runs read identically', () => {
    const water: DigestItem = { ...power, billName: 'Water' };
    const cable: DigestItem = { ...power, billName: 'Cable' };
    const text = render([water, cable]).text;
    expect(text.indexOf('Cable')).toBeLessThan(text.indexOf('Water'));
  });

  it('states each bill with its horizon in words, its date, and its balance', () => {
    const message = render([power]);
    expect(message.text).toContain('Tomorrow (2026-10-08) — Electric — $84.50');
  });

  it('says "In 3 days" for the earlier reminder', () => {
    expect(render([rent]).text).toContain('In 3 days (2026-10-10) — Rent — $1,200.00');
  });

  it('formats the balance as currency rather than a bare number', () => {
    const text = render([{ ...rent, amountDue: 1234.5 }]).text;
    expect(text).toContain('$1,234.50');
    expect(text).not.toContain('1234.5 ');
  });

  it('shows the balance outstanding, which a partial payment has reduced', () => {
    // The caller passes `amount - amount_paid`; this asserts the renderer
    // does not re-derive or round it away.
    expect(render([{ ...rent, amountDue: 200 }]).text).toContain('$200.00');
  });

  it('renders nothing for an empty list rather than an empty-bodied email', () => {
    // The run never calls this with an empty list, because `RETURNING`
    // decides the recipients. Returning null makes a future caller's
    // mistake visible instead of mailing a blank page.
    expect(renderDigest(recipient, [])).toBeNull();
  });
});
