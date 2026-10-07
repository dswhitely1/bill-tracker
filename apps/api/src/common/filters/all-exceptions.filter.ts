import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';

const PG_UNIQUE_VIOLATION = '23505';
const PG_STRING_TOO_LONG = '22001';
const PG_NOT_NULL_VIOLATION = '23502';

/**
 * "CONFLICT" -> "Conflict", "INTERNAL_SERVER_ERROR" -> "Internal Server Error".
 * Matches the title-cased reason phrase Nest's own built-in HttpException
 * subclasses put in their `error` field (see titleCaseReason's callers below),
 * so this is only the fallback for statuses that didn't already supply one.
 */
function titleCaseReason(status: HttpStatus): string {
  const name = HttpStatus[status] ?? 'ERROR';
  return name
    .split('_')
    .map((word) => word.charAt(0) + word.slice(1).toLowerCase())
    .join(' ');
}

function isFieldErrorMap(value: unknown): value is Record<string, string[]> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const values = Object.values(value);
  // An empty map would otherwise pass vacuously: `errors: {}` would be
  // forwarded as field-level errors, so a client attaches nothing to any
  // control and shows nothing in a banner either.
  if (values.length === 0) return false;
  return values.every(
    (messages) => Array.isArray(messages) && messages.every((m) => typeof m === 'string'),
  );
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse();
    const request = http.getRequest();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = titleCaseReason(status);
    // Set only for an object-bodied HttpException with no `message` key —
    // e.g. HealthCheckService.check() throws
    // ServiceUnavailableException({status, info, error, details}), Terminus's
    // own structured result. Flattening that into {statusCode, error,
    // message, path, timestamp} would discard exactly the detail that names
    // which indicator failed, so it is passed through unchanged instead.
    let passthroughBody: Record<string, unknown> | undefined;
    let fieldErrors: Record<string, string[]> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();

      if (typeof body === 'string') {
        message = body;
        error = titleCaseReason(status);
      } else if (body !== null && typeof body === 'object') {
        const record = body as Record<string, unknown>;
        if (!('message' in record)) {
          passthroughBody = record;
        } else {
          message = (record.message as string | string[] | undefined) ?? exception.message;
          error = typeof record.error === 'string' ? record.error : titleCaseReason(status);
          if (isFieldErrorMap(record.errors)) fieldErrors = record.errors;
        }
      } else {
        message = exception.message;
        error = titleCaseReason(status);
      }
    } else {
      const code = (exception as { code?: string })?.code;
      if (code === PG_UNIQUE_VIOLATION) {
        status = HttpStatus.CONFLICT;
        message = 'Resource already exists';
      } else if (code === PG_STRING_TOO_LONG || code === PG_NOT_NULL_VIOLATION) {
        status = HttpStatus.BAD_REQUEST;
        message = 'Invalid request payload';
      }
      error = titleCaseReason(status);
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `${request.method ?? 'UNKNOWN'} ${request.url} failed`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json(
      passthroughBody ?? {
        statusCode: status,
        error,
        message,
        ...(fieldErrors ? { errors: fieldErrors } : {}),
        path: request.url,
        timestamp: new Date().toISOString(),
      },
    );
  }
}
