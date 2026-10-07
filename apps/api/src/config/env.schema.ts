import { z } from 'zod';

const baseEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.url(),
  DB_SSL: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  JWT_ACCESS_SECRET: z.string().min(32, 'must be at least 32 characters'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  REFRESH_TTL_DAYS: z.coerce.number().int().positive().default(30),
  BCRYPT_COST: z.coerce.number().int().min(10).max(15).default(12),
  WEB_ORIGIN: z.url(),
  APP_TIMEZONE: z
    .string()
    .default('UTC')
    .refine(
      (tz) => {
        try {
          new Intl.DateTimeFormat('en-CA', { timeZone: tz });
          return true;
        } catch {
          return false;
        }
      },
      { message: 'must be a valid IANA timezone name, for example America/New_York' },
    ),
  /**
   * Absent selects the logging transport (spec §5.2) — absence is a mode,
   * not a missing default. This URL can carry a password, so like every
   * other secret in this schema it gets no fallback value.
   */
  SMTP_URL: z.url().optional(),
  MAIL_FROM: z.email().optional(),
});

export const envSchema = baseEnvSchema.superRefine((env, ctx) => {
  // Conditional rather than unconditionally required: an installation with
  // no mail server configured must still boot, and it must not be made to
  // invent a sender address it will never use.
  if (env.SMTP_URL !== undefined && env.MAIL_FROM === undefined) {
    ctx.addIssue({
      code: 'custom',
      path: ['MAIL_FROM'],
      message: 'is required when SMTP_URL is set, to name the sender of outgoing mail',
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `  ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }
  return result.data;
}
