import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MATERIAL_ANIMATIONS } from '@angular/material/core';
import { describe, expect, it, vi } from 'vitest';
import {
  ConfirmDialogComponent,
  ConfirmDialogData,
  ConfirmDialogResult,
} from './confirm-dialog.component';

function build(data: ConfirmDialogData) {
  const close = vi.fn<(result?: ConfirmDialogResult) => void>();
  TestBed.configureTestingModule({
    imports: [ConfirmDialogComponent],
    providers: [
      provideZonelessChangeDetection(),
      { provide: MATERIAL_ANIMATIONS, useValue: { animationsDisabled: true } },
      { provide: MAT_DIALOG_DATA, useValue: data },
      { provide: MatDialogRef, useValue: { close } },
    ],
  });
  return { fixture: TestBed.createComponent(ConfirmDialogComponent), close };
}

describe('ConfirmDialogComponent', () => {
  it('shows the title, the message, and the confirm label', async () => {
    const { fixture } = build({
      title: 'Delete Rent?',
      message: 'This deletes 12 instances and their payment history.',
      confirmLabel: 'Delete',
    });
    await fixture.whenStable();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Delete Rent?');
    expect(text).toContain('This deletes 12 instances and their payment history.');
    expect(text).toContain('Delete');
  });

  it('offers no alternate action when none was supplied', async () => {
    const { fixture } = build({ title: 'T', message: 'M', confirmLabel: 'OK' });
    await fixture.whenStable();

    expect(fixture.nativeElement.querySelector('[data-testid="alternate"]')).toBeNull();
  });

  it('closes with "confirm" when the destructive action is chosen', async () => {
    const { fixture, close } = build({ title: 'T', message: 'M', confirmLabel: 'Delete' });
    await fixture.whenStable();

    fixture.nativeElement.querySelector('[data-testid="confirm"]').click();

    expect(close).toHaveBeenCalledWith('confirm');
  });

  it('closes with "alternate" when the safer action is chosen', async () => {
    const { fixture, close } = build({
      title: 'T',
      message: 'M',
      confirmLabel: 'Delete',
      alternateLabel: 'Deactivate instead',
    });
    await fixture.whenStable();

    fixture.nativeElement.querySelector('[data-testid="alternate"]').click();

    expect(close).toHaveBeenCalledWith('alternate');
  });

  it('gives the alternate action focus when there is one', async () => {
    // The API offers a non-destructive path; the dialog should land on it
    // rather than on the one that destroys payment history.
    const { fixture } = build({
      title: 'T',
      message: 'M',
      confirmLabel: 'Delete',
      alternateLabel: 'Deactivate instead',
    });
    await fixture.whenStable();

    const alternate = fixture.nativeElement.querySelector('[data-testid="alternate"]');
    expect(alternate.hasAttribute('cdkFocusInitial')).toBe(true);
  });
});
