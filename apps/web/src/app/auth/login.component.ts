import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { AuthApi } from '../core/api/auth.api';
import { SessionService } from '../core/auth/session.service';
import { FieldErrorsComponent } from '../shared/field-errors.component';
import { applyServerErrors } from '../shared/server-errors';
import { safeReturnUrl } from '../shared/return-url';

@Component({
  selector: 'app-login',
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
          <h1 mat-card-title>Sign in</h1>
        </mat-card-header>
        <mat-card-content>
          @if (expired()) {
            <p class="notice" role="status">
              Your session expired. Please sign in again.
            </p>
          }
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
              <mat-label>Password</mat-label>
              <input
                matInput
                type="password"
                formControlName="password"
                autocomplete="current-password"
              />
              <app-field-errors [control]="form.controls.password" label="Password" />
            </mat-form-field>

            <button matButton="filled" type="submit" [disabled]="submitting()">Sign in</button>
          </form>
        </mat-card-content>
        <mat-card-actions>
          <a routerLink="/register">Create an account</a>
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
    .notice,
    .form-error {
      margin: 0 0 1rem;
    }
    .form-error {
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoginComponent {
  private readonly fb = inject(FormBuilder);
  private readonly authApi = inject(AuthApi);
  private readonly session = inject(SessionService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly form = this.fb.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  readonly submitting = signal(false);
  readonly formErrors = signal<string[]>([]);
  readonly expired = signal(this.route.snapshot.queryParams['reason'] === 'expired');

  submit(): void {
    if (this.form.invalid || this.submitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    this.formErrors.set([]);

    this.authApi.login(this.form.getRawValue()).subscribe({
      next: (response) => {
        this.session.signIn(response);
        this.submitting.set(false);
        void this.router.navigateByUrl(
          safeReturnUrl(this.route.snapshot.queryParams['returnUrl'], '/upcoming'),
        );
      },
      error: (error: unknown) => {
        this.submitting.set(false);
        this.formErrors.set(applyServerErrors(this.form, error));
      },
    });
  }
}
