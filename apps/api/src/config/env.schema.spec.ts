import { describe, expect, it } from 'vitest';
import { validateEnv } from './env.schema';

const valid = {
  NODE_ENV: 'test',
  PORT: '3000',
  DATABASE_URL: 'postgres://don:super@localhost:5432/bills_test',
  DB_SSL: 'false',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_ACCESS_TTL: '15m',
  REFRESH_TTL_DAYS: '30',
  BCRYPT_COST: '12',
  WEB_ORIGIN: 'http://localhost:4200',
};

describe('validateEnv', () => {
  it('coerces numeric strings and booleans into real types', () => {
    const env = validateEnv(valid);
    expect(env.PORT).toBe(3000);
    expect(env.REFRESH_TTL_DAYS).toBe(30);
    expect(env.DB_SSL).toBe(false);
  });

  it('refuses to start when JWT_ACCESS_SECRET is absent', () => {
    const { JWT_ACCESS_SECRET, ...without } = valid;
    expect(() => validateEnv(without)).toThrow(/JWT_ACCESS_SECRET/);
  });

  it('refuses a JWT_ACCESS_SECRET shorter than 32 characters', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'short' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('names every invalid variable at once rather than failing on the first', () => {
    expect(() => validateEnv({ ...valid, DATABASE_URL: 'nope', WEB_ORIGIN: 'nope' })).toThrow(
      /DATABASE_URL[\s\S]*WEB_ORIGIN/,
    );
  });

  it('provides no default for any secret', () => {
    const { JWT_ACCESS_SECRET, ...without } = valid;
    let message = '';
    try {
      validateEnv(without);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toMatch(/changeme|secret123|default/i);
  });
});

describe('APP_TIMEZONE', () => {
  it('defaults to UTC', () => {
    expect(validateEnv({ ...valid }).APP_TIMEZONE).toBe('UTC');
  });

  it('accepts a real IANA zone', () => {
    expect(validateEnv({ ...valid, APP_TIMEZONE: 'America/New_York' }).APP_TIMEZONE).toBe(
      'America/New_York',
    );
  });

  it('rejects a zone Intl does not recognise, at boot', () => {
    expect(() => validateEnv({ ...valid, APP_TIMEZONE: 'Mars/Olympus_Mons' })).toThrow(
      /APP_TIMEZONE/,
    );
  });
});

describe('mail configuration', () => {
  it('needs no mail configuration at all', () => {
    const env = validateEnv({ ...valid });
    expect(env.SMTP_URL).toBeUndefined();
    expect(env.MAIL_FROM).toBeUndefined();
  });

  it('accepts a transport URL together with a sender', () => {
    const env = validateEnv({
      ...valid,
      SMTP_URL: 'smtps://user:pass@smtp.example.com:465',
      MAIL_FROM: 'bills@example.com',
    });
    expect(env.SMTP_URL).toBe('smtps://user:pass@smtp.example.com:465');
    expect(env.MAIL_FROM).toBe('bills@example.com');
  });

  it('refuses a transport URL with no sender, and says which variable is missing', () => {
    expect(() =>
      validateEnv({ ...valid, SMTP_URL: 'smtps://user:pass@smtp.example.com:465' }),
    ).toThrow(/MAIL_FROM/);
  });

  it('refuses a malformed transport URL', () => {
    expect(() =>
      validateEnv({ ...valid, SMTP_URL: 'not-a-url', MAIL_FROM: 'bills@example.com' }),
    ).toThrow(/SMTP_URL/);
  });

  it('refuses a sender that is not an email address', () => {
    expect(() =>
      validateEnv({
        ...valid,
        SMTP_URL: 'smtps://user:pass@smtp.example.com:465',
        MAIL_FROM: 'not-an-email',
      }),
    ).toThrow(/MAIL_FROM/);
  });

  it('provides no default for the transport URL, which can carry a password', () => {
    let message = '';
    try {
      validateEnv({ ...valid, SMTP_URL: 'not-a-url', MAIL_FROM: 'bills@example.com' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toMatch(/smtp:\/\/localhost|changeme|default/i);
  });
});
