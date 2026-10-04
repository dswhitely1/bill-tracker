import type { UserProfile } from './user.contracts.js';

export interface RegisterRequest {
  email: string;
  name: string;
  password: string;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface AuthResponse {
  accessToken: string;
  user: UserProfile;
}

export interface RefreshResponse {
  accessToken: string;
}
