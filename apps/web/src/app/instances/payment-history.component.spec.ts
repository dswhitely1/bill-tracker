import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../core/auth/session.service';
import { PaymentsService } from '../core/state/payments.service';
import { PaymentHistoryComponent } from './payment-history.component';

let http: HttpTestingController;

const paid = {
  id: 'pay-1',
  billInstanceId: 'inst-1',
  amountPaid: 1200,
  paidAt: '2026-10-01T12:00:00.000Z',
  note: 'Bank transfer',
  reversesPaymentId: null,
};

const reversal = {
  id: 'pay-2',
  billInstanceId: 'inst-1',
  amountPaid: -1200,
  paidAt: '2026-10-02T12:00:00.000Z',
  note: null,
  reversesPaymentId: 'pay-1',
};

function render() {
  const fixture = TestBed.createComponent(PaymentHistoryComponent);
  fixture.componentRef.setInput('instanceId', 'inst-1');
  return fixture;
}

beforeEach(() => {
  TestBed.configureTestingModule({
    imports: [PaymentHistoryComponent],
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
    ],
  });
  http = TestBed.inject(HttpTestingController);
  TestBed.inject(SessionService).signIn({
    accessToken: 'token-1',
    user: { id: 'user-1', email: 'a@b.c', name: 'Ada', notifyEmail: true, notifyInApp: true },
  });
});

afterEach(() => {
  http.verify();
});

describe('PaymentHistoryComponent', () => {
  it('lists a payment with its amount and note', async () => {
    const fixture = render();
    await fixture.whenStable();
    http.expectOne('/api/bill-instances/inst-1/payments').flush([paid]);
    await fixture.whenStable();
    // Twice: the store resumes its `load()` one microtask after
    // `flush()` returns, because `firstValueFrom` wraps the
    // response in a native promise. The first `whenStable()` can
    // settle before that continuation runs; the second observes
    // the render it produced.
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('$1,200.00');
    expect(fixture.nativeElement.textContent).toContain('Bank transfer');
  });

  it('shows a reversal as its own row rather than hiding the payment it undid', async () => {
    // The log is append-only. A history that renders a net of zero has
    // thrown away the fact that something happened and was undone.
    const fixture = render();
    await fixture.whenStable();
    http.expectOne('/api/bill-instances/inst-1/payments').flush([paid, reversal]);
    await fixture.whenStable();
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Reversal');
    expect(text).toContain('-$1,200.00');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="payment-entry"]')).toHaveLength(2);
  });

  it('offers no reverse action on a row that is itself a reversal', async () => {
    const fixture = render();
    await fixture.whenStable();
    http.expectOne('/api/bill-instances/inst-1/payments').flush([paid, reversal]);
    await fixture.whenStable();
    await fixture.whenStable();

    const buttons = fixture.nativeElement.querySelectorAll('[data-testid="reverse"]');
    expect(buttons).toHaveLength(1);
  });

  it('says so when there are no payments yet', async () => {
    const fixture = render();
    await fixture.whenStable();
    http.expectOne('/api/bill-instances/inst-1/payments').flush([]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('No payments recorded');
  });

  it('shows the server message when a reversal is refused as already reversed', async () => {
    const fixture = render();
    await fixture.whenStable();
    http.expectOne('/api/bill-instances/inst-1/payments').flush([paid]);
    await fixture.whenStable();
    await fixture.whenStable();

    const done = fixture.componentInstance.reverse(paid);
    http.expectOne('/api/bill-instances/inst-1/payments/pay-1/reverse').flush(
      { message: 'This payment has already been reversed' },
      { status: 409, statusText: 'Conflict' },
    );
    // The local view disagrees with the server, so both the row and the
    // log are re-read rather than left stale beside the error. Each hop
    // of that recovery chain is a fresh `firstValueFrom` promise, so two
    // `whenStable()` calls are needed between flushes — one for the
    // rejection to resume the awaiting service method, one more for that
    // method's own promise to settle and let the caller's `await` resume
    // — before the next request is asserted.
    await fixture.whenStable();
    await fixture.whenStable();
    http.expectOne('/api/bill-instances/inst-1').flush({
      id: 'inst-1',
      billId: 'bill-1',
      billName: 'Rent',
      categoryId: null,
      dueDate: '2026-10-01',
      amount: 1200,
      amountPaid: 0,
      status: 'UNPAID',
      isOverdue: false,
      isCustomized: false,
      paidAt: null,
      note: null,
    });
    await fixture.whenStable();
    await fixture.whenStable();
    http.expectOne('/api/bill-instances/inst-1/payments').flush([paid, reversal]);
    await done;
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.componentInstance.error()).toContain('already been reversed');
    expect(fixture.nativeElement.textContent).toContain('already been reversed');
  });

  it('does not reject when the post-conflict reload itself fails', async () => {
    // Regression: reverse()'s catch block awaited payments.reload() with
    // nothing to catch a failure there — a second error on the recovery
    // path used to escape as an unhandled rejection from a template click
    // handler instead of surfacing in this component's own error signal.
    const fixture = render();
    await fixture.whenStable();
    http.expectOne('/api/bill-instances/inst-1/payments').flush([paid]);
    await fixture.whenStable();
    await fixture.whenStable();

    const done = fixture.componentInstance.reverse(paid);
    http.expectOne('/api/bill-instances/inst-1/payments/pay-1/reverse').flush(
      { message: 'This payment has already been reversed' },
      { status: 409, statusText: 'Conflict' },
    );
    await fixture.whenStable();
    await fixture.whenStable();
    http
      .expectOne('/api/bill-instances/inst-1')
      .flush({ message: 'Instance not found' }, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    await fixture.whenStable();
    http.expectOne('/api/bill-instances/inst-1/payments').flush([paid]);

    // reverse() must settle, not reject, even though both the original
    // request and its recovery failed.
    await expect(done).resolves.toBeUndefined();
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.componentInstance.error()).toContain('Instance not found');
  });

  it('re-fetches an open history after a payment is recorded elsewhere', async () => {
    // The payment dialog and this history component are siblings under
    // the same expanded row. Recording a payment there patches only the
    // instance row (bills spec §7.3) — nothing refetches this log unless
    // something tells it to. `PaymentsService.mutations` is that signal;
    // dropping `this.payments.mutations()` from the component's effect
    // makes this test fail because the second GET below never happens.
    const fixture = render();
    await fixture.whenStable();
    http.expectOne('/api/bill-instances/inst-1/payments').flush([]);
    await fixture.whenStable();
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toContain('No payments recorded');

    const payments = TestBed.inject(PaymentsService);
    const done = payments.record('inst-1');
    http.expectOne('/api/bill-instances/inst-1/payments').flush({
      instance: {
        id: 'inst-1',
        billId: 'bill-1',
        billName: 'Rent',
        categoryId: null,
        dueDate: '2026-10-01',
        amount: 1200,
        amountPaid: 1200,
        status: 'PAID',
        isOverdue: false,
        isCustomized: false,
        paidAt: '2026-10-01T12:00:00.000Z',
        note: null,
      },
      payment: paid,
    });
    await done;
    await fixture.whenStable();
    await fixture.whenStable();

    http.expectOne('/api/bill-instances/inst-1/payments').flush([paid]);
    await fixture.whenStable();
    await fixture.whenStable();

    expect(fixture.nativeElement.textContent).toContain('$1,200.00');
    expect(fixture.nativeElement.querySelectorAll('[data-testid="payment-entry"]')).toHaveLength(1);
  });
});
