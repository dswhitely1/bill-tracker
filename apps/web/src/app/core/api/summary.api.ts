import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { SummaryResponse } from '@bill-tracker/shared-types';
import { API_BASE } from './api.constants';

@Injectable({ providedIn: 'root' })
export class SummaryApi {
  private readonly http = inject(HttpClient);

  /** No parameters: the figures are defined against the server's own day. */
  get(): Observable<SummaryResponse> {
    return this.http.get<SummaryResponse>(`${API_BASE}/summary`);
  }
}
