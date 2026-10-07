import { HttpErrorResponse } from '@angular/common/http';
import type { ValidationErrorResponse } from '@bill-tracker/shared-types';

const OFFLINE =
  'Cannot reach the server. Check your connection and try again.';
const FALLBACK = 'Something went wrong. Please try again.';

/**
 * Narrows a response body to a `ValidationPipe` failure.
 *
 * Only pipe failures carry `errors`. A 400 raised by a service — a
 * `categoryId` naming another user's category, for instance — has no field
 * information, so the client branches on the key's presence and never on
 * the status code alone. Getting this wrong drops the service's message
 * on the floor, because nothing would match a control.
 */
export function isValidationErrorResponse(body: unknown): body is ValidationErrorResponse {
  if (typeof body !== 'object' || body === null) return false;
  const errors = (body as { errors?: unknown }).errors;
  if (typeof errors !== 'object' || errors === null || Array.isArray(errors)) return false;
  const values = Object.values(errors);
  // An empty map would otherwise pass every check below vacuously: a 400
  // with `errors: {}` would be "recognised" as field-level, so
  // applyServerErrors would attach nothing to any control and return
  // nothing to show in a banner either — exactly the "rejects a
  // submission and shows nothing" failure this type exists to avoid.
  if (values.length === 0) return false;
  return values.every(
    (messages) => Array.isArray(messages) && messages.every((m) => typeof m === 'string'),
  );
}

/** The sentence to show a person for any failed request. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return FALLBACK;

  // Status 0 is the browser's way of saying the request never completed:
  // offline, DNS failure, or a blocked request. "Error 0" means nothing to
  // anyone.
  if (error.status === 0) return OFFLINE;

  const message = (error.error as { message?: unknown } | null)?.message;
  if (typeof message === 'string' && message !== '') return message;
  if (Array.isArray(message) && message.length > 0) return message.join(', ');

  return FALLBACK;
}
