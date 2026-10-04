export interface UserProfile {
  id: string;
  email: string;
  name: string;
  notifyEmail: boolean;
  notifyInApp: boolean;
}

export interface UpdateProfileRequest {
  name?: string;
  notifyEmail?: boolean;
  notifyInApp?: boolean;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}
