import { HttpClient, HttpContext } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  ChangePasswordRequest,
  UpdateProfileRequest,
  UserProfile,
} from '@bill-tracker/shared-types';
import { SKIP_AUTH_RETRY } from '../auth/auth.tokens';
import { API_BASE } from './api.constants';

@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly http = inject(HttpClient);

  /**
   * `skipAuthRetry` is for `SessionService.restore()` only: during boot a
   * 401 here means "not signed in", and triggering a refresh would race
   * the one restore has already performed.
   */
  me(options: { skipAuthRetry?: boolean } = {}): Observable<UserProfile> {
    return this.http.get<UserProfile>(`${API_BASE}/users/me`, {
      context: new HttpContext().set(SKIP_AUTH_RETRY, options.skipAuthRetry ?? false),
    });
  }

  updateProfile(body: UpdateProfileRequest): Observable<UserProfile> {
    return this.http.patch<UserProfile>(`${API_BASE}/users/me`, body);
  }

  changePassword(body: ChangePasswordRequest): Observable<void> {
    return this.http.patch<void>(`${API_BASE}/users/me/password`, body);
  }
}
