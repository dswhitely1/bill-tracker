import { BadRequestException, ValidationError } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { flattenToFieldErrors, validationExceptionFactory } from './validation-error.factory';

function error(property: string, constraints?: Record<string, string>, children: ValidationError[] = []): ValidationError {
  return { property, constraints, children } as ValidationError;
}

describe('flattenToFieldErrors', () => {
  it('keys a top-level failure on its property name', () => {
    const result = flattenToFieldErrors([
      error('name', { isLength: 'name must be longer than or equal to 1 characters' }),
    ]);

    expect(result).toEqual({
      name: ['name must be longer than or equal to 1 characters'],
    });
  });

  it('collects every constraint on one property', () => {
    const result = flattenToFieldErrors([
      error('defaultAmount', {
        isPositive: 'defaultAmount must be a positive number',
        max: 'defaultAmount must not be greater than 9999999999.99',
      }),
    ]);

    expect(result.defaultAmount).toHaveLength(2);
  });

  it('keys a nested failure on its dotted path', () => {
    const result = flattenToFieldErrors([
      error('profile', undefined, [
        error('email', { isEmail: 'email must be an email' }),
      ]),
    ]);

    expect(result).toEqual({ 'profile.email': ['email must be an email'] });
  });

  it('keys a doubly nested failure on its full dotted path', () => {
    const result = flattenToFieldErrors([
      error('a', undefined, [error('b', undefined, [error('c', { isInt: 'c must be an integer' })])]),
    ]);

    expect(result).toEqual({ 'a.b.c': ['c must be an integer'] });
  });

  it('omits a property that only carries children, with no constraints of its own', () => {
    const result = flattenToFieldErrors([
      error('profile', undefined, [error('email', { isEmail: 'email must be an email' })]),
    ]);

    expect(result).not.toHaveProperty('profile');
  });
});

describe('validationExceptionFactory', () => {
  it('produces a 400 carrying both the flat message array and the field map', () => {
    const exception = validationExceptionFactory([
      error('name', { isLength: 'name must be longer than or equal to 1 characters' }),
    ]);

    expect(exception).toBeInstanceOf(BadRequestException);
    expect(exception.getStatus()).toBe(400);
    expect(exception.getResponse()).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: ['name must be longer than or equal to 1 characters'],
      errors: { name: ['name must be longer than or equal to 1 characters'] },
    });
  });

  it('orders the message array parent-first, matching what Nest produced before', () => {
    const exception = validationExceptionFactory([
      error('a', { x: 'a failed' }, [error('b', { y: 'b failed' })]),
      error('c', { z: 'c failed' }),
    ]);

    const body = exception.getResponse() as { message: string[] };
    expect(body.message).toEqual(['a failed', 'b failed', 'c failed']);
  });
});
