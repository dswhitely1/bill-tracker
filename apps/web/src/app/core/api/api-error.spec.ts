import { HttpErrorResponse } from '@angular/common/http';
import { describe, expect, it } from 'vitest';
import { errorMessage, isValidationErrorResponse } from './api-error';

function httpError(status: number, body: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error: body, url: '/api/bills' });
}

describe('isValidationErrorResponse', () => {
  it('accepts a pipe failure carrying a field map', () => {
    expect(
      isValidationErrorResponse({
        statusCode: 400,
        error: 'Bad Request',
        message: ['name should not be empty'],
        errors: { name: ['name should not be empty'] },
        path: '/api/bills',
        timestamp: '2026-10-06T00:00:00.000Z',
      }),
    ).toBe(true);
  });

  it('rejects a service-raised 400, which carries no field map at all', () => {
    // The distinction the client branches on. A categoryId naming another
    // user's category is a 400 with no `errors` key, and treating it as a
    // field failure would silently drop its message.
    expect(
      isValidationErrorResponse({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Category not found',
        path: '/api/bills',
        timestamp: '2026-10-06T00:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('rejects a malformed errors value', () => {
    expect(isValidationErrorResponse({ errors: 'nope', message: [] })).toBe(false);
    expect(isValidationErrorResponse({ errors: { name: 'nope' }, message: [] })).toBe(false);
  });

  it('rejects an empty errors map, which would attach nothing to any control', () => {
    // An empty object would otherwise pass every check vacuously, which
    // would make applyServerErrors attach nothing and return nothing to
    // show in a banner either — a rejected submission with no visible
    // reason.
    expect(
      isValidationErrorResponse({
        statusCode: 400,
        error: 'Bad Request',
        message: [],
        errors: {},
        path: '/api/bills',
        timestamp: '2026-10-06T00:00:00.000Z',
      }),
    ).toBe(false);
  });

  it('rejects null, undefined, and a string', () => {
    expect(isValidationErrorResponse(null)).toBe(false);
    expect(isValidationErrorResponse(undefined)).toBe(false);
    expect(isValidationErrorResponse('error')).toBe(false);
  });
});

describe('errorMessage', () => {
  it('uses the server message when there is one', () => {
    expect(errorMessage(httpError(409, { message: 'This category is used by 3 bill(s).' }))).toBe(
      'This category is used by 3 bill(s).',
    );
  });

  it('joins a message array into one sentence', () => {
    expect(errorMessage(httpError(400, { message: ['name is required', 'amount must be positive'] }))).toBe(
      'name is required, amount must be positive',
    );
  });

  it('names the offline case rather than showing status 0', () => {
    expect(errorMessage(httpError(0, null))).toBe(
      'Cannot reach the server. Check your connection and try again.',
    );
  });

  it('falls back to a readable sentence for a 500 with no body', () => {
    expect(errorMessage(httpError(500, null))).toBe('Something went wrong. Please try again.');
  });

  it('handles a value that is not an HttpErrorResponse at all', () => {
    expect(errorMessage(new Error('boom'))).toBe('Something went wrong. Please try again.');
  });
});
