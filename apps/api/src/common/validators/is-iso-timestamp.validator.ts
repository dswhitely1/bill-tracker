import { ValidationOptions, isISO8601, registerDecorator } from 'class-validator';

/**
 * `is-iso-date.validator.ts` exists because `@Matches(/^\d{4}-\d{2}-\d{2}$/)`
 * accepts `2026-02-31`, which then reaches PostgreSQL's date parser and
 * returns a 500 instead of a 400. That lesson was never generalised to
 * `timestamptz` columns, and the gap is worse there than it was for `date`:
 *
 * - `@IsISO8601()` (any options) accepts ISO 8601 *basic* format — a string
 *   like `20261005` with no separators at all — but `new Date('20261005')`
 *   is an Invalid Date. That reaches `pg` as the literal string
 *   `"0NaN-NaN-NaNTNaN:NaN:NaN.NaN+NaN:NaN"` and the query 500s.
 * - `@IsISO8601({ strict: true })` alone is not enough either: it does
 *   reject `2026-02-31` (good), but it still accepts `20261005` (bad) —
 *   "strict" tightens separator/format rules, it does not forbid basic
 *   format or guarantee `Date.parse` succeeds.
 *
 * So this validator checks all three things `@IsISO8601` does not check
 * together: the string is syntactically ISO 8601 in strict mode, `Date.parse`
 * actually succeeds on it (rules out the basic-format gap above), and the
 * resulting instant is not in the future (a `paidAt` of 2099 is a bad
 * timestamp whether or not the string that produced it was well-formed —
 * `payment_logs` is the append-only truth and should not record events
 * that have not happened yet). A one-minute tolerance absorbs client clock
 * skew. Validators cannot inject `ConfigService`, so this compares against
 * `Date.now()` directly rather than the app's configured "now".
 */
const FUTURE_TOLERANCE_MS = 60_000;

export function IsIsoTimestamp(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      name: 'isIsoTimestamp',
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      validator: {
        validate: (value: unknown) => {
          if (typeof value !== 'string') return false;
          if (!isISO8601(value, { strict: true })) return false;
          const parsed = Date.parse(value);
          if (Number.isNaN(parsed)) return false;
          return parsed <= Date.now() + FUTURE_TOLERANCE_MS;
        },
        defaultMessage: () =>
          '$property must be a real ISO 8601 timestamp that is not in the future',
      },
    });
  };
}
