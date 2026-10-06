import { describe, expect, it } from 'vitest';
import { paymentState } from './payment-state';

const at = (iso: string) => new Date(iso);

describe('paymentState', () => {
  it('is UNPAID with no events', () => {
    expect(paymentState(100, [])).toEqual({
      amountPaid: 0, status: 'UNPAID', paidAt: null,
    });
  });

  it('is PARTIALLY_PAID below the amount', () => {
    const state = paymentState(100, [{ amountPaid: 40, paidAt: at('2026-10-01T10:00:00Z') }]);
    expect(state).toEqual({ amountPaid: 40, status: 'PARTIALLY_PAID', paidAt: null });
  });

  it('is PAID at the amount, stamped with the crossing event', () => {
    const state = paymentState(100, [
      { amountPaid: 40, paidAt: at('2026-10-01T10:00:00Z') },
      { amountPaid: 60, paidAt: at('2026-10-03T10:00:00Z') },
    ]);
    expect(state.status).toBe('PAID');
    expect(state.amountPaid).toBe(100);
    expect(state.paidAt?.toISOString()).toBe('2026-10-03T10:00:00.000Z');
  });

  it('sums in paid_at order regardless of the order given', () => {
    const state = paymentState(100, [
      { amountPaid: 60, paidAt: at('2026-10-03T10:00:00Z') },
      { amountPaid: 40, paidAt: at('2026-10-01T10:00:00Z') },
    ]);
    expect(state.paidAt?.toISOString()).toBe('2026-10-03T10:00:00.000Z');
  });

  it('walks back to PARTIALLY_PAID after a reversal, clearing paid_at', () => {
    const state = paymentState(100, [
      { amountPaid: 40, paidAt: at('2026-10-01T10:00:00Z') },
      { amountPaid: 60, paidAt: at('2026-10-03T10:00:00Z') },
      { amountPaid: -60, paidAt: at('2026-10-04T10:00:00Z') },
    ]);
    expect(state).toMatchObject({ amountPaid: 40, status: 'PARTIALLY_PAID', paidAt: null });
  });

  it('walks all the way back to UNPAID when everything is reversed', () => {
    const state = paymentState(100, [
      { amountPaid: 100, paidAt: at('2026-10-01T10:00:00Z') },
      { amountPaid: -100, paidAt: at('2026-10-02T10:00:00Z') },
    ]);
    expect(state).toEqual({ amountPaid: 0, status: 'UNPAID', paidAt: null });
  });

  it('stamps the LATEST crossing when a bill is paid, reversed, and paid again', () => {
    const state = paymentState(100, [
      { amountPaid: 100, paidAt: at('2026-10-01T10:00:00Z') },
      { amountPaid: -100, paidAt: at('2026-10-02T10:00:00Z') },
      { amountPaid: 100, paidAt: at('2026-10-05T10:00:00Z') },
    ]);
    expect(state.status).toBe('PAID');
    expect(state.paidAt?.toISOString()).toBe('2026-10-05T10:00:00.000Z');
  });

  it('accumulates cents without floating-point drift', () => {
    const events = Array.from({ length: 10 }, (_, i) => ({
      amountPaid: 0.1, paidAt: at(`2026-10-0${(i % 9) + 1}T10:00:00Z`),
    }));
    expect(paymentState(1, events).amountPaid).toBe(1);
    expect(paymentState(1, events).status).toBe('PAID');
  });
});
