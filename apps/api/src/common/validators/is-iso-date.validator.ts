import { ValidationOptions, registerDecorator } from 'class-validator';
import { isCalendarDate } from '../../bills/dates';

/**
 * A `@Matches(/^\d{4}-\d{2}-\d{2}$/)` would accept `2026-02-31`, which then
 * reaches PostgreSQL's date parser and returns a 500 instead of a 400. This
 * checks the shape *and* the calendar.
 */
export function IsIsoDate(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isIsoDate',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: (value: unknown) => isCalendarDate(value),
        defaultMessage: () => '$property must be a real calendar date in YYYY-MM-DD form',
      },
    });
  };
}
