import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';

export interface ConfirmDialogData {
  title: string;
  message: string;
  confirmLabel: string;
  /**
   * A safer action offered beside the destructive one — "Deactivate
   * instead" for a bill whose deletion cascades through its payment
   * history. When present it takes initial focus.
   */
  alternateLabel?: string;
}

export type ConfirmDialogResult = 'confirm' | 'alternate' | undefined;

@Component({
  selector: 'app-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <mat-dialog-content>{{ data.message }}</mat-dialog-content>
    <mat-dialog-actions align="end">
      <button matButton mat-dialog-close data-testid="cancel">Cancel</button>
      @if (data.alternateLabel) {
        <button matButton cdkFocusInitial data-testid="alternate" (click)="close('alternate')">
          {{ data.alternateLabel }}
        </button>
      }
      <button
        matButton="filled"
        class="destructive"
        data-testid="confirm"
        (click)="close('confirm')"
      >
        {{ data.confirmLabel }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .destructive {
      --mat-button-filled-container-color: var(--mat-sys-error);
      --mat-button-filled-label-text-color: var(--mat-sys-on-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialogComponent {
  protected readonly data = inject<ConfirmDialogData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject<MatDialogRef<ConfirmDialogComponent, ConfirmDialogResult>>(
    MatDialogRef,
  );

  close(result: ConfirmDialogResult): void {
    this.dialogRef.close(result);
  }
}
