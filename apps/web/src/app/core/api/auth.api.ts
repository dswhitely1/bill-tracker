import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  AuthResponse,
  LoginRequest,
  RefreshResponse,
  RegisterRequest,
} from '@bill-tracker/shared-types';
import { API_BASE } from './api.constants';

@Injectable({ providedIn: 'root' })
export class AuthApi {
  private readonly http = inject(HttpClient);

  register(body: RegisterRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${API_BASE}/auth/register`, body);
  }

  login(body: LoginRequest): Observable<AuthResponse> {
    return this.http.post<AuthResponse>(`${API_BASE}/auth/login`, body);
  }

  /** The refresh token is an httpOnly cookie; there is nothing to send. */
  refresh(): Observable<RefreshResponse> {
    return this.http.post<RefreshResponse>(`${API_BASE}/auth/refresh`, {});
  }

  logout(): Observable<void> {
    return this.http.post<void>(`${API_BASE}/auth/logout`, {});
  }
}
