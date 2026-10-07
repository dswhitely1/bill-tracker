import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SKIP_AUTH_RETRY } from '../auth/auth.tokens';
import { AuthApi } from './auth.api';
import { BillInstancesApi } from './bill-instances.api';
import { BillsApi } from './bills.api';
import { CategoriesApi } from './categories.api';
import { NotificationsApi } from './notifications.api';
import { UsersApi } from './users.api';

let http: HttpTestingController;

beforeEach(() => {
  TestBed.configureTestingModule({
    providers: [provideZonelessChangeDetection(), provideHttpClient(), provideHttpClientTesting()],
  });
  http = TestBed.inject(HttpTestingController);
});

afterEach(() => {
  http.verify();
});

describe('AuthApi', () => {
  it('posts credentials to the login route', () => {
    TestBed.inject(AuthApi).login({ email: 'a@b.c', password: 'hunter22' }).subscribe();
    const req = http.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'a@b.c', password: 'hunter22' });
    req.flush({});
  });

  it('posts an empty body to refresh, since the cookie carries the credential', () => {
    TestBed.inject(AuthApi).refresh().subscribe();
    const req = http.expectOne('/api/auth/refresh');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ accessToken: 'token' });
  });

  it('posts to logout', () => {
    TestBed.inject(AuthApi).logout().subscribe();
    const req = http.expectOne('/api/auth/logout');
    expect(req.request.method).toBe('POST');
    req.flush(null);
  });
});

describe('UsersApi', () => {
  it('reads the profile', () => {
    TestBed.inject(UsersApi).me().subscribe();
    const req = http.expectOne('/api/users/me');
    expect(req.request.method).toBe('GET');
    expect(req.request.context.get(SKIP_AUTH_RETRY)).toBe(false);
    req.flush({});
  });

  it('marks the profile read as retry-exempt when asked', () => {
    TestBed.inject(UsersApi).me({ skipAuthRetry: true }).subscribe();
    const req = http.expectOne('/api/users/me');
    expect(req.request.context.get(SKIP_AUTH_RETRY)).toBe(true);
    req.flush({});
  });

  it('patches the profile', () => {
    TestBed.inject(UsersApi).updateProfile({ name: 'Ada' }).subscribe();
    const req = http.expectOne('/api/users/me');
    expect(req.request.method).toBe('PATCH');
    req.flush({});
  });

  it('patches the password at its own path', () => {
    TestBed.inject(UsersApi)
      .changePassword({ currentPassword: 'old-one-here', newPassword: 'new-one-here' })
      .subscribe();
    const req = http.expectOne('/api/users/me/password');
    expect(req.request.method).toBe('PATCH');
    req.flush(null);
  });
});

describe('CategoriesApi', () => {
  it('lists, creates, updates, and deletes at the right paths and methods', () => {
    const api = TestBed.inject(CategoriesApi);

    api.list().subscribe();
    expect(http.expectOne('/api/categories').request.method).toBe('GET');
    http.verify();

    api.create({ name: 'Insurance' }).subscribe();
    expect(http.expectOne('/api/categories').request.method).toBe('POST');
    http.verify();

    api.update('cat-1', { name: 'Renamed' }).subscribe();
    expect(http.expectOne('/api/categories/cat-1').request.method).toBe('PATCH');
    http.verify();

    api.remove('cat-1').subscribe();
    expect(http.expectOne('/api/categories/cat-1').request.method).toBe('DELETE');
  });
});

describe('BillsApi', () => {
  it('lists without a query parameter when isActive is omitted', () => {
    TestBed.inject(BillsApi).list().subscribe();
    const req = http.expectOne((r) => r.url === '/api/bills');
    expect(req.request.params.has('isActive')).toBe(false);
    req.flush([]);
  });

  it('sends isActive=false, not an omitted parameter', () => {
    // `false` is falsy, and a truthiness check here would silently list
    // every bill instead of only the inactive ones.
    TestBed.inject(BillsApi).list(false).subscribe();
    const req = http.expectOne((r) => r.url === '/api/bills');
    expect(req.request.params.get('isActive')).toBe('false');
    req.flush([]);
  });

  it('creates, reads, updates, and deletes', () => {
    const api = TestBed.inject(BillsApi);

    api.create({ name: 'Rent', defaultAmount: 1200, frequency: 'MONTHLY', startDate: '2026-01-01' }).subscribe();
    expect(http.expectOne('/api/bills').request.method).toBe('POST');
    http.verify();

    api.get('bill-1').subscribe();
    expect(http.expectOne('/api/bills/bill-1').request.method).toBe('GET');
    http.verify();

    api.update('bill-1', { defaultAmount: 1300 }).subscribe();
    expect(http.expectOne('/api/bills/bill-1').request.method).toBe('PATCH');
    http.verify();

    api.remove('bill-1').subscribe();
    expect(http.expectOne('/api/bills/bill-1').request.method).toBe('DELETE');
  });
});

describe('BillInstancesApi', () => {
  it('sends from and to as query parameters', () => {
    TestBed.inject(BillInstancesApi).list({ from: '2026-10-01', to: '2026-10-31' }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/bill-instances');
    expect(req.request.params.get('from')).toBe('2026-10-01');
    expect(req.request.params.get('to')).toBe('2026-10-31');
    req.flush([]);
  });

  it('omits every optional filter that was not supplied', () => {
    TestBed.inject(BillInstancesApi).list({ from: '2026-10-01', to: '2026-10-31' }).subscribe();
    const req = http.expectOne((r) => r.url === '/api/bill-instances');
    expect(req.request.params.has('status')).toBe(false);
    expect(req.request.params.has('overdue')).toBe(false);
    expect(req.request.params.has('billId')).toBe(false);
    req.flush([]);
  });

  it('sends overdue=false rather than dropping it', () => {
    // The API reads overdue=false as the exact negation — "paid, or not
    // yet due". Dropping it would mean "no filter", a different question.
    TestBed.inject(BillInstancesApi)
      .list({ from: '2026-10-01', to: '2026-10-31', overdue: false })
      .subscribe();
    const req = http.expectOne((r) => r.url === '/api/bill-instances');
    expect(req.request.params.get('overdue')).toBe('false');
    req.flush([]);
  });

  it('sends every filter when all are supplied', () => {
    TestBed.inject(BillInstancesApi)
      .list({
        from: '2026-10-01',
        to: '2026-10-31',
        status: 'UNPAID',
        overdue: true,
        billId: 'bill-1',
      })
      .subscribe();
    const req = http.expectOne((r) => r.url === '/api/bill-instances');
    expect(req.request.params.get('status')).toBe('UNPAID');
    expect(req.request.params.get('overdue')).toBe('true');
    expect(req.request.params.get('billId')).toBe('bill-1');
    req.flush([]);
  });

  it('records a payment with an empty body when no amount is given', () => {
    // An empty body means "pay the remaining balance", computed by the
    // server under a row lock. The client must never compute it.
    TestBed.inject(BillInstancesApi).recordPayment('inst-1').subscribe();
    const req = http.expectOne('/api/bill-instances/inst-1/payments');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({});
  });

  it('records a partial payment with the amount it was given', () => {
    TestBed.inject(BillInstancesApi).recordPayment('inst-1', { amount: 40 }).subscribe();
    const req = http.expectOne('/api/bill-instances/inst-1/payments');
    expect(req.request.body).toEqual({ amount: 40 });
    req.flush({});
  });

  it('reverses a payment at its nested path', () => {
    TestBed.inject(BillInstancesApi).reversePayment('inst-1', 'pay-1').subscribe();
    const req = http.expectOne('/api/bill-instances/inst-1/payments/pay-1/reverse');
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('clears payments at the unpay path', () => {
    TestBed.inject(BillInstancesApi).unpay('inst-1').subscribe();
    const req = http.expectOne('/api/bill-instances/inst-1/unpay');
    expect(req.request.method).toBe('POST');
    req.flush({});
  });

  it('lists payments oldest first, as the API returns them', () => {
    TestBed.inject(BillInstancesApi).payments('inst-1').subscribe();
    const req = http.expectOne('/api/bill-instances/inst-1/payments');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });
});

describe('NotificationsApi', () => {
  it('lists at the plain notifications path', () => {
    TestBed.inject(NotificationsApi).list().subscribe();
    const req = http.expectOne('/api/notifications');
    expect(req.request.method).toBe('GET');
    req.flush({ items: [], unreadCount: 0, truncated: false });
  });

  it('marks one notification read at its nested path', () => {
    TestBed.inject(NotificationsApi).markRead('note-1').subscribe();
    const req = http.expectOne('/api/notifications/note-1/read');
    expect(req.request.method).toBe('POST');
    req.flush(null);
  });

  it('marks every notification read at the read-all path', () => {
    TestBed.inject(NotificationsApi).markAllRead().subscribe();
    const req = http.expectOne('/api/notifications/read-all');
    expect(req.request.method).toBe('POST');
    req.flush({ updated: 0 });
  });
});
