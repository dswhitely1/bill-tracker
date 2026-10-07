import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AuthApi } from '../core/api/auth.api';
import { SessionService } from '../core/auth/session.service';
import { FieldErrorsComponent } from '../shared/field-errors.component';
import { maxBytesValidator } from '../shared/password-validators';
import { applyServerErrors } from '../shared/server-errors';

@Component({
  selector: 'app-register',
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    FieldErrorsComponent,
  ],
  template: `
    <main class="auth-page">
      <mat-card>
        @if (submitting()) {
          <mat-progress-bar mode="indeterminate" />
        }
        <mat-card-header>
          <h1 mat-card-title>Create an account</h1>
        </mat-card-header>
        <mat-card-content>
          @for (message of formErrors(); track message) {
            <p class="form-error" role="alert">{{ message }}</p>
          }

          <form [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field>
              <mat-label>Email</mat-label>
              <input matInput type="email" formControlName="email" autocomplete="username" />
              <app-field-errors [control]="form.controls.email" label="Email" />
            </mat-form-field>

            <mat-form-field>
              <mat-label>Name</mat-label>
              <input matInput formControlName="name" autocomplete="name" />
              <app-field-errors [control]="form.controls.name" label="Name" />
            </mat-form-field>

            <mat-form-field>
              <mat-label>Password</mat-label>
              <input
                matInput
                type="password"
                formControlName="password"
                autocomplete="new-password"
              />
              <mat-hint>At least 8 characters. No symbol requirements.</mat-hint>
              <app-field-errors [control]="form.controls.password" label="Password" />
            </mat-form-field>

            <button matButton="filled" type="submit" [disabled]="submitting()">
              Create account
            </button>
          </form>
        </mat-card-content>
        <mat-card-actions>
          <a routerLink="/login">I already have an account</a>
        </mat-card-actions>
      </mat-card>
    </main>
  `,
  styles: `
    .auth-page {
      display: grid;
      place-items: center;
      min-height: 100dvh;
      padding: 1rem;
    }
    mat-card {
      width: min(28rem, 100%);
    }
    form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }
    .form-error {
      margin: 0 0 1rem;
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RegisterComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authApi = inject(AuthApi);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);

  /**
   * The password rules mirror the API's, which follow NIST guidance: a
   * length floor, no composition rules, and a 72-byte ceiling because
   * bcrypt truncates there.
   */
  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    name: ['', [Validators.required, Validators.maxLength(100)]],
    password: ['', [Validators.required, Validators.minLength(8), maxBytesValidator(72)]],
  });

  readonly submitting = signal(false);
  readonly formErrors = signal<string[]>([]);

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.formErrors.set([]);

    this.authApi.register(this.form.getRawValue()).subscribe({
      next: (response) => {
        this.session.signIn(response);
        this.submitting.set(false);
        void this.router.navigateByUrl('/dashboard');
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.formErrors.set(applyServerErrors(this.form, error));
      },
    });
  }
}
