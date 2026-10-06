import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import type { CategoryResponse } from '@bill-tracker/shared-types';
import { FieldErrorsComponent } from '../shared/field-errors.component';

export interface CategoryDialogData {
  category: CategoryResponse | null;
}

export interface CategoryDialogResult {
  name: string;
  color: string | null;
}

@Component({
  selector: 'app-category-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    FieldErrorsComponent,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.category ? 'Edit category' : 'New category' }}</h2>
    <mat-dialog-content>
      <form [formGroup]="form" class="dialog-form">
        <mat-form-field>
          <mat-label>Name</mat-label>
          <input matInput formControlName="name" cdkFocusInitial />
          <app-field-errors [control]="form.controls.name" label="Name" />
        </mat-form-field>

        <mat-form-field>
          <mat-label>Colour</mat-label>
          <input matInput type="color" formControlName="color" />
          <mat-hint>Used to tint this category in lists.</mat-hint>
        </mat-form-field>
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close>Cancel</button>
      <button matButton="filled" [disabled]="form.invalid" (click)="save()">Save</button>
    </mat-dialog-actions>
  `,
  styles: `
    .dialog-form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      min-width: 20rem;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoryDialogComponent {
  private readonly fb = inject(FormBuilder);
  protected readonly data = inject<CategoryDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef =
    inject<MatDialogRef<CategoryDialogComponent, CategoryDialogResult | undefined>>(MatDialogRef);

  readonly form = this.fb.nonNullable.group({
    name: [
      this.data.category?.name ?? '',
      [Validators.required, Validators.maxLength(50)],
    ],
    color: [this.data.category?.color ?? '#2f80ed'],
  });

  readonly saving = signal(false);

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.dialogRef.close(this.form.getRawValue());
  }
}
