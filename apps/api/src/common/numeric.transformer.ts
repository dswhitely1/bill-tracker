import type { ValueTransformer } from 'typeorm';

/**
 * PostgreSQL `numeric` arrives from node-postgres as a *string*, because an
 * arbitrary-precision decimal does not fit a JS number in general. Our money
 * columns are `numeric(12,2)`, comfortably inside the exactly-representable
 * range once scaled, so `Number` is lossless for every value the CHECK
 * constraints permit.
 *
 * Without this transformer every amount reaches the client as `"142.00"` and
 * client-side sums become string concatenation.
 */
export const numericTransformer: ValueTransformer = {
  to: (value: number | null): number | null => value,
  from: (value: string | null): number | null => (value === null ? null : Number(value)),
};
