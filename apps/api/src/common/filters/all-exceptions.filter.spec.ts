import {
  ArgumentsHost, HttpException, HttpStatus, Logger, ServiceUnavailableException,
} from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AllExceptionsFilter } from './all-exceptions.filter';

interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

let logError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function hostFor(path = '/api/test') {
  const json = vi.fn<(body: ErrorResponseBody) => void>();
  const status = vi.fn<(code: number) => { json: typeof json }>(() => ({ json }));
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
      getRequest: () => ({ url: path }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  it('maps a unique violation to 409 without leaking the constraint name', () => {
    const { host, status, json } = hostFor('/api/auth/register');
    const pgError = Object.assign(new Error('duplicate key'), {
      code: '23505',
      constraint: 'UQ_users_email',
      detail: 'Key (email)=(a@b.c) already exists.',
    });

    new AllExceptionsFilter().catch(pgError, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    const body = json.mock.calls[0][0];
    expect(body.message).toBe('Resource already exists');
    // Spec §10 publishes "error": "Conflict" (title case), not HttpStatus[409]'s
    // own "CONFLICT".
    expect(body.error).toBe('Conflict');
    expect(JSON.stringify(body)).not.toContain('UQ_users_email');
    expect(JSON.stringify(body)).not.toContain('a@b.c');
  });

  it('maps a string-too-long error to 400', () => {
    const { host, status } = hostFor();
    const pgError = Object.assign(new Error('value too long'), { code: '22001' });

    new AllExceptionsFilter().catch(pgError, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
  });

  it('maps a not-null violation to 400', () => {
    const { host, status } = hostFor();
    const pgError = Object.assign(new Error('null value in column'), { code: '23502' });

    new AllExceptionsFilter().catch(pgError, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
  });

  it('preserves an explicit HttpException status and message', () => {
    const { host, status, json } = hostFor();
    new AllExceptionsFilter().catch(new HttpException('Nope', HttpStatus.FORBIDDEN), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
    expect(json.mock.calls[0][0].message).toBe('Nope');
    expect(json.mock.calls[0][0].error).toBe('Forbidden');
  });

  it('passes through an object-bodied HttpException with no message key, unflattened — '
    + 'the shape HealthCheckService.check() throws when the database ping fails', () => {
    const { host, status, json } = hostFor('/api/health');
    const healthFailure = {
      status: 'error',
      info: {},
      error: { database: { status: 'down' } },
      details: { database: { status: 'down' } },
    };

    new AllExceptionsFilter().catch(
      new ServiceUnavailableException(healthFailure),
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    // The whole Terminus result survives verbatim — naming which indicator
    // failed — rather than being flattened to a generic
    // "Service Unavailable Exception" message with the detail discarded.
    expect(json.mock.calls[0][0]).toEqual(healthFailure);
  });

  it('never puts a stack trace in the response body, but does log it server-side', () => {
    const { host, json } = hostFor();
    new AllExceptionsFilter().catch(new Error('boom with secrets'), host);

    const body = JSON.stringify(json.mock.calls[0][0]);
    expect(body).not.toContain('boom with secrets');
    expect(body).not.toContain('at ');

    // the detail must go somewhere — server-side logs, not the wire
    expect(logError).toHaveBeenCalledTimes(1);
    expect(String(logError.mock.calls[0][1])).toContain('boom with secrets');
  });

  it('includes path and an ISO timestamp on every response, and logs server-side', () => {
    const { host, json } = hostFor('/api/users/me');
    new AllExceptionsFilter().catch(new Error('x'), host);

    const body = json.mock.calls[0][0];
    expect(body.path).toBe('/api/users/me');
    expect(() => new Date(body.timestamp).toISOString()).not.toThrow();
    expect(logError).toHaveBeenCalledTimes(1);
  });
});

describe('AllExceptionsFilter and field errors', () => {
  it('carries a field-error map through instead of discarding it', () => {
    const { host, status, json } = hostFor('/api/bills');
    const exception = new HttpException(
      {
        statusCode: 400,
        error: 'Bad Request',
        message: ['name should not be empty'],
        errors: { name: ['name should not be empty'] },
      },
      HttpStatus.BAD_REQUEST,
    );

    new AllExceptionsFilter().catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    const body = json.mock.calls[0][0] as ErrorResponseBody & {
      errors?: Record<string, string[]>;
    };
    expect(body.errors).toEqual({ name: ['name should not be empty'] });
    expect(body.message).toEqual(['name should not be empty']);
    expect(body.path).toBe('/api/bills');
  });

  it('omits the errors key entirely when the exception carries none', () => {
    const { host, json } = hostFor();
    new AllExceptionsFilter().catch(new HttpException('Nope', HttpStatus.BAD_REQUEST), host);

    expect(json.mock.calls[0][0]).not.toHaveProperty('errors');
  });

  it('ignores an empty errors map, rather than forwarding a field failure with nothing in it', () => {
    // An empty object would otherwise pass the shape check vacuously and
    // be forwarded as `errors: {}` — a client would then attach nothing
    // to any control and show nothing in a banner either.
    const { host, json } = hostFor();
    const exception = new HttpException(
      { statusCode: 400, error: 'Bad Request', message: 'nope', errors: {} },
      HttpStatus.BAD_REQUEST,
    );

    new AllExceptionsFilter().catch(exception, host);

    expect(json.mock.calls[0][0]).not.toHaveProperty('errors');
  });

  it('ignores an errors value that is not a map of string arrays', () => {
    const { host, json } = hostFor();
    const exception = new HttpException(
      { statusCode: 400, error: 'Bad Request', message: 'nope', errors: 'not a map' },
      HttpStatus.BAD_REQUEST,
    );

    new AllExceptionsFilter().catch(exception, host);

    expect(json.mock.calls[0][0]).not.toHaveProperty('errors');
  });
});
