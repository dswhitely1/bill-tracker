import { HttpErrorResponse } from '@angular/common/http';
import { FormGroup } from '@angular/forms';
import { errorMessage, isValidationErrorResponse } from '../core/api/api-error';

/**
 * Attaches each server message to the control that produced it, and
 * returns the messages that matched no control.
 *
 * **The return value is not optional.** A caller that discards it will, on
 * some input, reject a submission and display nothing — the message
 * belonged to a field the form does not render, or to a 400 that carries
 * no field map at all. Every caller shows the returned messages in a
 * form-level banner.
 *
 * The control's own validation errors are preserved: a field can be both
 * empty and rejected by the server, and clearing the first to show the
 * second would be arbitrary.
 */
export function applyServerErrors(form: FormGroup, error: unknown): string[] {
  if (!(error instanceof HttpErrorResponse)) return [errorMessage(error)];

  const body = error.error;
  if (!isValidationErrorResponse(body)) return [errorMessage(error)];

  const unmatched: string[] = [];

  for (const [path, messages] of Object.entries(body.errors)) {
    const control = form.get(path);
    if (control === null) {
      unmatched.push(...messages);
      continue;
    }
    control.setErrors({ ...control.errors, server: messages[0] });
    control.markAsTouched();
  }

  return unmatched;
}
