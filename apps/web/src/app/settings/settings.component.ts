import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { firstValueFrom } from 'rxjs';
import { UsersApi } from '../core/api/users.api';
import { SessionService } from '../core/auth/session.service';
import { FieldErrorsComponent } from '../shared/field-errors.component';
import { NotificationService } from '../shared/notification.service';
import { maxBytesValidator } from '../shared/password-validators';
import { applyServerErrors } from '../shared/server-errors';

@Component({
  selector: 'app-settings',
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    FieldErrorsComponent,
  ],
  template: `
    <h1>Settings</h1>

    <mat-card>
      <mat-card-header><mat-card-title>Profile</mat-card-title></mat-card-header>
      <mat-card-content>
        @for (message of profileErrors(); track message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        <form [formGroup]="profileForm" (ngSubmit)="saveProfile()">
          <mat-form-field>
            <mat-label>Name</mat-label>
            <input matInput formControlName="name" />
            <app-field-errors [control]="profileForm.controls.name" label="Name" />
          </mat-form-field>

          <mat-checkbox formControlName="notifyEmail">Email me about due bills</mat-checkbox>
          <mat-checkbox formControlName="notifyInApp">Notify me in the app</mat-checkbox>

          <button matButton="filled" type="submit">Save profile</button>
        </form>
      </mat-card-content>
    </mat-card>

    <mat-card>
      <mat-card-header><mat-card-title>Password</mat-card-title></mat-card-header>
      <mat-card-content>
        <p class="muted">
          Changing your password signs you out everywhere, including here.
        </p>
        @for (message of passwordErrors(); track message) {
          <p class="form-error" role="alert">{{ message }}</p>
        }
        <form [formGroup]="passwordForm" (ngSubmit)="changePassword()">
          <mat-form-field>
            <mat-label>Current password</mat-label>
            <input
              matInput
              type="password"
              formControlName="currentPassword"
              autocomplete="current-password"
            />
            <app-field-errors
              [control]="passwordForm.controls.currentPassword"
              label="Current password"
            />
          </mat-form-field>

          <mat-form-field>
            <mat-label>New password</mat-label>
            <input
              matInput
              type="password"
              formControlName="newPassword"
              autocomplete="new-password"
            />
            <app-field-errors [control]="passwordForm.controls.newPassword" label="New password" />
          </mat-form-field>

          <button matButton="filled" type="submit">Change password</button>
        </form>
      </mat-card-content>
    </mat-card>
  `,
  styles: `
    mat-card {
      max-width: 36rem;
      margin-bottom: 1.5rem;
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      align-items: flex-start;
    }
    mat-form-field {
      width: 100%;
    }
    .muted {
      color: var(--mat-sys-on-surface-variant);
    }
    .form-error {
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsComponent {
  private readonly fb = inject(FormBuilder);
  private readonly usersApi = inject(UsersApi);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly notifications = inject(NotificationService);

  readonly profileErrors = signal<string[]>([]);
  readonly passwordErrors = signal<string[]>([]);

  readonly profileForm = this.fb.nonNullable.group({
    name: [this.session.user()?.name ?? '', [Validators.required, Validators.maxLength(100)]],
    notifyEmail: [this.session.user()?.notifyEmail ?? true],
    notifyInApp: [this.session.user()?.notifyInApp ?? true],
  });

  readonly passwordForm = this.fb.nonNullable.group({
    currentPassword: ['', [Validators.required]],
    newPassword: ['', [Validators.required, Validators.minLength(8), maxBytesValidator(72)]],
  });

  saveProfile(): void {
    if (this.profileForm.invalid) {
      this.profileForm.markAllAsTouched();
      return;
    }
    this.profileErrors.set([]);

    this.usersApi.updateProfile(this.profileForm.getRawValue()).subscribe({
      next: (profile) => {
        this.session.setUser(profile);
        this.notifications.success('Profile saved');
      },
      error: (error: unknown) => {
        this.profileErrors.set(applyServerErrors(this.profileForm, error));
      },
    });
  }

  /**
   * The API revokes every refresh token on success, so this session is
   * already dead — it just has up to fifteen minutes of access token left
   * to discover that. Signing out here makes the consequence visible at
   * the moment it is caused, instead of as an unexplained logout later.
   */
  async changePassword(): Promise<void> {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    this.passwordErrors.set([]);

    try {
      await firstValueFrom(this.usersApi.changePassword(this.passwordForm.getRawValue()));
    } catch (error: unknown) {
      this.passwordErrors.set(applyServerErrors(this.passwordForm, error));
      return;
    }

    await this.session.signOut();
    this.notifications.success('Password changed. Please sign in again.');
    void this.router.navigateByUrl('/login');
  }
}
