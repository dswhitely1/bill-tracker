export interface CategoryResponse {
  id: string;
  name: string;
  color: string | null;
}

export interface CreateCategoryRequest {
  name: string;
  color?: string | null;
}

export interface UpdateCategoryRequest {
  name?: string;
  color?: string | null;
}
