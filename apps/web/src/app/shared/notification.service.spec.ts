import { TestBed } from '@angular/core/testing';
import { MatSnackBar, MatSnackBarRef } from '@angular/material/snack-bar';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationService } from './notification.service';

let open: ReturnType<
  typeof vi.fn<
    (message: string, action?: string, config?: unknown) => MatSnackBarRef<unknown>
  >
>;
let service: NotificationService;

beforeEach(() => {
  open = vi.fn<(message: string, action?: string, config?: unknown) => MatSnackBarRef<unknown>>();
  TestBed.configureTestingModule({
    providers: [{ provide: MatSnackBar, useValue: { open } }],
  });
  service = TestBed.inject(NotificationService);
});

describe('NotificationService', () => {
  it('opens a snack bar with the message and a Dismiss action on success', () => {
    service.success('Created Utilities');

    expect(open).toHaveBeenCalledWith('Created Utilities', 'Dismiss', { duration: 4000 });
  });

  it('opens a snack bar with the message and a Dismiss action on error', () => {
    service.error('Something went wrong');

    expect(open).toHaveBeenCalledWith('Something went wrong', 'Dismiss', { duration: 8000 });
  });

  it('keeps an error on screen longer than a success, since it is the one a person needs time to read', () => {
    service.success('ok');
    service.error('bad');

    const successDuration = (open.mock.calls[0]![2] as { duration: number }).duration;
    const errorDuration = (open.mock.calls[1]![2] as { duration: number }).duration;
    expect(errorDuration).toBeGreaterThan(successDuration);
  });
});
