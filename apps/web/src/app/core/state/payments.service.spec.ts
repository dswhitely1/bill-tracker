import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionService } from '../auth/session.service';
import { InstancesStore } from './instances.store';
import { PaymentsService } from './payments.service';

let http: HttpTestingController;
let payments: PaymentsService;
let instances: InstancesStore;

const instance = {
  id: 'inst-1',
  billId: 'bill-1',
  billName: 'Rent',
  categoryId: null,
  dueDate: '2026-10-01',
  amount: 1200,
  amountPaid: 0,
  status: 'UNPAID' as const,
  isOverdue: false,
  isCustomized: false,
  paidAt: null,
  note: null,
};

const payment = {
  id: 'pay-1',
  billInstanceId: 'inst-1',
  amountPaid: 1200,
  paidAt: '2026-10-01T12:00:00.000Z',
  note: null,
  reversesPaymentId: null,
};

beforeEach(async () => {
  TestBed.configureTestingModule({
    providers: [
      provideZonelessChangeDetection(),
      provideRouter([]),
      provideHttpClient(),
      provideHttpClientTesting(),
    ],
  });
  http = TestBed.inject(HttpTestingController);
  TestBed.inject(SessionService).signIn({
    accessToken: 'token-1',
    user: { id: 'user-1', email: 'a@b.c', name: 'Ada', notifyEmail: true, notifyInApp: true },
  });
  instances = TestBed.inject(InstancesStore);
  payments = TestBed.inject(PaymentsService);

  const loaded = instances.setQuery({ from: '2026-10-01', to: '2026-10-31' });
  http.expectOne((r) => r.url === '/api/bill-instances').flush([instance]);
  await loaded;
});

afterEach(() => {
  http.verify();
});

describe('record', () => {
  it('sends an empty body for a full payment and patches the row from the response', async () => {
    const done = payments.record('inst-1');
    const req = http.expectOne('/api/bill-instances/inst-1/payments');
    expect(req.request.body).toEqual({});
    req.flush({ instance: { ...instance, status: 'PAID', amountPaid: 1200 }, payment });
    await done;

    expect(instances.instances()[0].status).toBe('PAID');
    // No follow-up read — the endpoint already returned the row.
    expect(http.match((r) => r.url === '/api/bill-instances')).toHaveLength(0);
  });

  it('sends a partial amount when one is given', async () => {
    const done = payments.record('inst-1', { amount: 500 });
    const req = http.expectOne('/api/bill-instances/inst-1/payments');
    expect(req.request.body).toEqual({ amount: 500 });
    req.flush({
      instance: { ...instance, status: 'PARTIALLY_PAID', amountPaid: 500 },
      payment: { ...payment, amountPaid: 500 },
    });
    await done;

    expect(instances.instances()[0].status).toBe('PARTIALLY_PAID');
    expect(instances.instances()[0].amountPaid).toBe(500);
  });

  it('leaves the row untouched when the request fails', async () => {
    const done = payments.record('inst-1', { amount: 99999 });
    http
      .expectOne('/api/bill-instances/inst-1/payments')
      .flush({ message: 'too much' }, { status: 400, statusText: 'Bad Request' });

    await expect(done).rejects.toBeDefined();
    expect(instances.instances()[0].status).toBe('UNPAID');
  });
});

describe('reverse', () => {
  it('posts to the nested path and patches the row', async () => {
    // Put the store in a state the response will visibly change. Flushing
    // an instance identical to the seeded one proves nothing: the
    // assertion would pass even if patch() were never called.
    instances.patch({ ...instance, status: 'PAID', amountPaid: 1200 });
    expect(instances.instances()[0].status).toBe('PAID');

    const done = payments.reverse('inst-1', 'pay-1');
    const req = http.expectOne('/api/bill-instances/inst-1/payments/pay-1/reverse');
    expect(req.request.method).toBe('POST');
    req.flush({
      instance,
      payment: { ...payment, id: 'pay-2', amountPaid: -1200, reversesPaymentId: 'pay-1' },
    });
    await done;

    expect(instances.instances()[0].status).toBe('UNPAID');
    expect(instances.instances()[0].amountPaid).toBe(0);
  });

  it('rejects a second reversal with the server message intact', async () => {
    // Review Focus 3. The API's partial unique index makes "reversed at
    // most once" a database guarantee, so this is a 409 and not a
    // silently ignored no-op.
    const done = payments.reverse('inst-1', 'pay-1');
    http.expectOne('/api/bill-instances/inst-1/payments/pay-1/reverse').flush(
      { message: 'This payment has already been reversed' },
      { status: 409, statusText: 'Conflict' },
    );

    await expect(done).rejects.toMatchObject({ status: 409 });
  });
});

describe('unpay', () => {
  it('patches the row from a bare instance, not a result pair', async () => {
    // Same reasoning as the reverse test above: seed a state the bare
    // instance response will visibly overwrite.
    instances.patch({ ...instance, status: 'PAID', amountPaid: 1200 });
    expect(instances.instances()[0].status).toBe('PAID');

    const done = payments.unpay('inst-1');
    const req = http.expectOne('/api/bill-instances/inst-1/unpay');
    expect(req.request.method).toBe('POST');
    req.flush(instance);
    await done;

    expect(instances.instances()[0].status).toBe('UNPAID');
    expect(instances.instances()[0].amountPaid).toBe(0);
  });
});

describe('history and reload', () => {
  it('reads the log oldest first', async () => {
    const done = payments.history('inst-1');
    const req = http.expectOne('/api/bill-instances/inst-1/payments');
    expect(req.request.method).toBe('GET');
    const older = { ...payment, id: 'pay-0', paidAt: '2026-09-01T12:00:00.000Z' };
    req.flush([older, payment]);

    expect((await done).map((p) => p.id)).toEqual(['pay-0', 'pay-1']);
  });

  it('reloads one instance and patches it in, for recovering from a conflict', async () => {
    const done = payments.reload('inst-1');
    http
      .expectOne('/api/bill-instances/inst-1')
      .flush({ ...instance, status: 'PAID', amountPaid: 1200 });
    await done;

    expect(instances.instances()[0].status).toBe('PAID');
  });
});
