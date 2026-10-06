import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  BillResponse,
  CreateBillRequest,
  UpdateBillRequest,
} from '@bill-tracker/shared-types';
import { API_BASE } from './api.constants';

@Injectable({ providedIn: 'root' })
export class BillsApi {
  private readonly http = inject(HttpClient);

  /**
   * `isActive` is checked against `undefined`, not for truthiness: `false`
   * is a meaningful filter ("show me only the deactivated ones") and a
   * truthiness check would turn it into no filter at all.
   */
  list(isActive?: boolean): Observable<BillResponse[]> {
    const params =
      isActive === undefined ? new HttpParams() : new HttpParams().set('isActive', isActive);
    return this.http.get<BillResponse[]>(`${API_BASE}/bills`, { params });
  }

  get(id: string): Observable<BillResponse> {
    return this.http.get<BillResponse>(`${API_BASE}/bills/${id}`);
  }

  create(body: CreateBillRequest): Observable<BillResponse> {
    return this.http.post<BillResponse>(`${API_BASE}/bills`, body);
  }

  update(id: string, body: UpdateBillRequest): Observable<BillResponse> {
    return this.http.patch<BillResponse>(`${API_BASE}/bills/${id}`, body);
  }

  /** A real delete, cascading through instances and payment logs. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE}/bills/${id}`);
  }
}
