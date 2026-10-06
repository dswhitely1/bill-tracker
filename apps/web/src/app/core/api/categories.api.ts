import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  CategoryResponse,
  CreateCategoryRequest,
  UpdateCategoryRequest,
} from '@bill-tracker/shared-types';
import { API_BASE } from './api.constants';

@Injectable({ providedIn: 'root' })
export class CategoriesApi {
  private readonly http = inject(HttpClient);

  list(): Observable<CategoryResponse[]> {
    return this.http.get<CategoryResponse[]>(`${API_BASE}/categories`);
  }

  create(body: CreateCategoryRequest): Observable<CategoryResponse> {
    return this.http.post<CategoryResponse>(`${API_BASE}/categories`, body);
  }

  update(id: string, body: UpdateCategoryRequest): Observable<CategoryResponse> {
    return this.http.patch<CategoryResponse>(`${API_BASE}/categories/${id}`, body);
  }

  /** 409 when any bill still references the category — bills spec §7.4. */
  remove(id: string): Observable<void> {
    return this.http.delete<void>(`${API_BASE}/categories/${id}`);
  }
}
