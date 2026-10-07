import { Logger, Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.schema';
import { LogMailTransport } from './log-mail.transport';
import { MailTransport } from './mail-transport';
import { SmtpMailTransport } from './smtp-mail.transport';

const logger = new Logger('MailTransport');

export function selectMailTransport(config: ConfigService<Env, true>): MailTransport {
  const url = config.get('SMTP_URL', { infer: true });
  const from = config.get('MAIL_FROM', { infer: true });

  if (url === undefined || from === undefined) {
    // Logged once at startup so which transport is live is never a guess.
    logger.log('No SMTP_URL configured; reminder mail will be written to this log');
    return new LogMailTransport();
  }

  logger.log(`Sending reminder mail over SMTP as ${from}`);
  return new SmtpMailTransport(url, from);
}

export const mailTransportProvider: Provider = {
  provide: MailTransport,
  useFactory: selectMailTransport,
  inject: [ConfigService],
};
