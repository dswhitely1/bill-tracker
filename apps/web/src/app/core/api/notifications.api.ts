import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  MarkAllReadResponse,
  NotificationListResponse,
} from '@bill-tracker/shared-types';
import { API_BASE } from './api.constants';

@Injectable({ providedIn: 'root' })
export class NotificationsApi {
  private readonly http = inject(HttpClient);

  /** No parameters: the server caps the page and says whether it did. */
  list(): Observable<NotificationListResponse> {
    return this.http.get<NotificationListResponse>(`${API_BASE}/notifications`);
  }

  markRead(id: string): Observable<void> {
    return this.http.post<void>(`${API_BASE}/notifications/${id}/read`, {});
  }

  markAllRead(): Observable<MarkAllReadResponse> {
    return this.http.post<MarkAllReadResponse>(`${API_BASE}/notifications/read-all`, {});
  }
}
