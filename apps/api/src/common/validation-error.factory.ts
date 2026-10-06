import { BadRequestException, HttpStatus, ValidationError } from '@nestjs/common';

/**
 * Turns class-validator's nested `ValidationError[]` into a flat map keyed on
 * the dotted property path.
 *
 * Nest's own `ValidationPipe` already flattens these, but only to a
 * `string[]` — the structure that says *which field* failed is computed and
 * then discarded. Recovering it in the client means matching each sentence
 * against a leading property name, which works only for as long as every
 * message happens to start with one. A single `{ message: '...' }` override
 * on any decorator breaks that silently: the message still renders in the
 * form-level banner, so nothing looks wrong.
 *
 * A property contributes a key only when it has constraints of its own. A
 * parent that merely holds failing children is a path segment, not a field,
 * and no form control is bound to it.
 */
export function flattenToFieldErrors(
  errors: ValidationError[],
  parentPath = '',
): Record<string, string[]> {
  const result: Record<string, string[]> = {};

  for (const error of errors) {
    const path = parentPath ? `${parentPath}.${error.property}` : error.property;
    const messages = Object.values(error.constraints ?? {});

    if (messages.length > 0) {
      result[path] = [...(result[path] ?? []), ...messages];
    }

    for (const [childPath, childMessages] of Object.entries(
      flattenToFieldErrors(error.children ?? [], path),
    )) {
      result[childPath] = [...(result[childPath] ?? []), ...childMessages];
    }
  }

  return result;
}

/**
 * The `exceptionFactory` for the global `ValidationPipe`.
 *
 * `message` keeps the shape, content, and order Nest's default factory
 * produced — parent messages before their children's, in declaration order —
 * so every existing assertion against a 400 body continues to pass. `errors`
 * is additive.
 */
export function validationExceptionFactory(errors: ValidationError[]): BadRequestException {
  const fieldErrors = flattenToFieldErrors(errors);

  return new BadRequestException({
    statusCode: HttpStatus.BAD_REQUEST,
    error: 'Bad Request',
    message: Object.values(fieldErrors).flat(),
    errors: fieldErrors,
  });
}
