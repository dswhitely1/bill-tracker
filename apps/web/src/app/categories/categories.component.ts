import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { firstValueFrom } from 'rxjs';
import type { CategoryResponse } from '@bill-tracker/shared-types';
import { errorMessage } from '../core/api/api-error';
import { CategoriesStore } from '../core/state/categories.store';
import { ConfirmDialogComponent, ConfirmDialogResult } from '../shared/confirm-dialog.component';
import { EmptyStateComponent } from '../shared/empty-state.component';
import { NotificationService } from '../shared/notification.service';
import {
  CategoryDialogComponent,
  CategoryDialogResult,
} from './category-dialog.component';

@Component({
  selector: 'app-categories',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatListModule,
    MatProgressBarModule,
    EmptyStateComponent,
  ],
  template: `
    <header class="page-header">
      <h1>Categories</h1>
      <button matButton="filled" (click)="openCreate()">
        <mat-icon>add</mat-icon>
        New category
      </button>
    </header>

    @if (store.loading()) {
      <mat-progress-bar mode="indeterminate" />
    }

    @if (store.error(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    } @else if (store.isEmpty()) {
      <app-empty-state
        icon="label"
        title="No categories yet"
        message="Categories group your bills. Create one to start sorting them."
      />
    } @else {
      <mat-list>
        @for (category of store.categories(); track category.id) {
          <mat-list-item>
            <span
              matListItemIcon
              class="swatch"
              [style.background]="category.color ?? 'transparent'"
              aria-hidden="true"
            ></span>
            <span matListItemTitle>{{ category.name }}</span>
            <span matListItemMeta>
              <button
                matIconButton
                [attr.aria-label]="'Edit ' + category.name"
                (click)="openEdit(category)"
              >
                <mat-icon>edit</mat-icon>
              </button>
              <button
                matIconButton
                [attr.aria-label]="'Delete ' + category.name"
                (click)="confirmRemove(category)"
              >
                <mat-icon>delete</mat-icon>
              </button>
            </span>
          </mat-list-item>
        }
      </mat-list>
    }

    @if (lastError(); as message) {
      <p class="error" role="alert">{{ message }}</p>
    }
  `,
  styles: `
    .page-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .swatch {
      width: 1.25rem;
      height: 1.25rem;
      border-radius: 50%;
      border: 1px solid var(--mat-sys-outline-variant);
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CategoriesComponent {
  protected readonly store = inject(CategoriesStore);
  private readonly dialog = inject(MatDialog);
  private readonly notifications = inject(NotificationService);

  readonly lastError = signal<string | null>(null);

  constructor() {
    void this.store.load();
  }

  async openCreate(): Promise<void> {
    const result = await this.openDialog(null);
    if (!result) return;

    try {
      await this.store.create(result);
      this.notifications.success(`Created ${result.name}`);
      this.lastError.set(null);
    } catch (error: unknown) {
      this.lastError.set(errorMessage(error));
    }
  }

  async openEdit(category: CategoryResponse): Promise<void> {
    const result = await this.openDialog(category);
    if (!result) return;

    try {
      await this.store.update(category.id, result);
      this.lastError.set(null);
    } catch (error: unknown) {
      this.lastError.set(errorMessage(error));
    }
  }

  /**
   * A 409 here is informative, not a failure to retry: it names how many
   * bills still reference the category, and that count is the only thing
   * that tells a person what to do next. It belongs on the page, not in a
   * snack bar that disappears while they read it.
   */
  async confirmRemove(category: CategoryResponse): Promise<void> {
    const confirmed = await firstValueFrom(
      this.dialog
        .open<ConfirmDialogComponent, unknown, ConfirmDialogResult>(ConfirmDialogComponent, {
          data: {
            title: `Delete ${category.name}?`,
            message: 'Bills using this category must be reassigned or deleted first.',
            confirmLabel: 'Delete',
          },
        })
        .afterClosed(),
    );
    if (confirmed !== 'confirm') return;

    try {
      await this.store.remove(category.id);
      this.lastError.set(null);
      this.notifications.success(`Deleted ${category.name}`);
    } catch (error: unknown) {
      this.lastError.set(errorMessage(error));
    }
  }

  private openDialog(category: CategoryResponse | null): Promise<CategoryDialogResult | undefined> {
    return firstValueFrom(
      this.dialog
        .open<CategoryDialogComponent, unknown, CategoryDialogResult | undefined>(
          CategoryDialogComponent,
          { data: { category } },
        )
        .afterClosed(),
    );
  }
}
