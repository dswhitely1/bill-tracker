import { describe, expect, it } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { LogMailTransport } from './log-mail.transport';
import { SmtpMailTransport } from './smtp-mail.transport';
import { selectMailTransport } from './mail-transport.provider';

function configWith(values: Partial<Env>): ConfigService<Env, true> {
  return {
    get: (key: keyof Env) => values[key],
  } as unknown as ConfigService<Env, true>;
}

describe('selectMailTransport', () => {
  it('logs when no transport URL is configured', () => {
    const transport = selectMailTransport(configWith({}));
    expect(transport).toBeInstanceOf(LogMailTransport);
  });

  it('sends over SMTP when a transport URL is configured', () => {
    const transport = selectMailTransport(
      configWith({ SMTP_URL: 'smtp://localhost:1025', MAIL_FROM: 'bills@example.com' }),
    );
    expect(transport).toBeInstanceOf(SmtpMailTransport);
  });

  it('logs rather than throwing when a URL is present but the sender is not', () => {
    // env.schema refuses this combination at boot (Task 2), so it cannot
    // reach here through configuration. The guard exists because
    // constructing SmtpMailTransport with an undefined `from` would
    // produce mail with no sender that silently fails at the far end,
    // which is strictly worse than logging.
    const transport = selectMailTransport(configWith({ SMTP_URL: 'smtp://localhost:1025' }));
    expect(transport).toBeInstanceOf(LogMailTransport);
  });
});
