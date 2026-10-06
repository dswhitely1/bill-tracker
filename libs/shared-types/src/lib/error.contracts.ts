/** The envelope every API failure uses — foundation spec §10. */
export interface ErrorResponse {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

/**
 * A `ValidationPipe` failure. `errors` is keyed on the dotted property path
 * so a client can attach each message to the control that produced it.
 *
 * Only pipe failures carry `errors`. A 400 raised by a service — a
 * `categoryId` naming another user's category, for instance — is an
 * `ErrorResponse` with no field information at all.
 */
export interface ValidationErrorResponse extends ErrorResponse {
  message: string[];
  errors: Record<string, string[]>;
}
