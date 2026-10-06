import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  BillInstanceResponse,
  BillStatus,
  PaymentLogResponse,
  PaymentResultResponse,
  RecordPaymentRequest,
  UpdateBillInstanceRequest,
} from '@bill-tracker/shared-types';
import type { CalendarDate } from '../date/calendar-date';
import { API_BASE } from './api.constants';

/**
 * `from` and `to` are required, and they are the pagination: there is no
 * cursor. The span is capped at 400 days by the API; the client checks it
 * before sending so an over-wide range is a message, not a 400.
 */
export interface BillInstanceQuery {
  from: CalendarDate;
  to: CalendarDate;
  status?: BillStatus;
  overdue?: boolean;
  billId?: string;
}

@Injectable({ providedIn: 'root' })
export class BillInstancesApi {
  private readonly http = inject(HttpClient);

  list(query: BillInstanceQuery): Observable<BillInstanceResponse[]> {
    let params = new HttpParams().set('from', query.from).set('to', query.to);
    if (query.status !== undefined) params = params.set('status', query.status);
    // `overdue: false` is the exact negation of overdue, not the absence
    // of a filter, so it is compared against undefined rather than tested
    // for truthiness.
    if (query.overdue !== undefined) params = params.set('overdue', query.overdue);
    if (query.billId !== undefined) params = params.set('billId', query.billId);

    return this.http.get<BillInstanceResponse[]>(`${API_BASE}/bill-instances`, { params });
  }

  get(id: string): Observable<BillInstanceResponse> {
    return this.http.get<BillInstanceResponse>(`${API_BASE}/bill-instances/${id}`);
  }

  /** Any successful patch sets `isCustomized` and opts the row out of template rewrites. */
  update(id: string, body: UpdateBillInstanceRequest): Observable<BillInstanceResponse> {
    return this.http.patch<BillInstanceResponse>(`${API_BASE}/bill-instances/${id}`, body);
  }

  payments(id: string): Observable<PaymentLogResponse[]> {
    return this.http.get<PaymentLogResponse[]>(`${API_BASE}/bill-instances/${id}/payments`);
  }

  /**
   * An empty body means "pay the remaining balance". The server computes
   * that figure under a row lock; a client-computed one races every other
   * writer.
   */
  recordPayment(id: string, body: RecordPaymentRequest = {}): Observable<PaymentResultResponse> {
    return this.http.post<PaymentResultResponse>(`${API_BASE}/bill-instances/${id}/payments`, body);
  }

  reversePayment(id: string, paymentId: string): Observable<PaymentResultResponse> {
    return this.http.post<PaymentResultResponse>(
      `${API_BASE}/bill-instances/${id}/payments/${paymentId}/reverse`,
      {},
    );
  }

  /** Returns the instance alone — there is no payment row to return. */
  unpay(id: string): Observable<BillInstanceResponse> {
    return this.http.post<BillInstanceResponse>(`${API_BASE}/bill-instances/${id}/unpay`, {});
  }
}
