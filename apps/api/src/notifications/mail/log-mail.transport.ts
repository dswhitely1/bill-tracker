import { Logger } from '@nestjs/common';
import { MailMessage, MailTransport } from './mail-transport';

/**
 * The default transport (spec §5.2). It logs the whole message — recipient,
 * subject, body — so `npm start` on a fresh clone produces working
 * reminders a developer can read in the terminal, with no credentials and
 * no network.
 */
export class LogMailTransport extends MailTransport {
  private readonly logger = new Logger(LogMailTransport.name);

  send(message: MailMessage): Promise<void> {
    this.logger.log(
      `Would send mail\n  to: ${message.to}\n  subject: ${message.subject}\n\n${message.text}`,
    );
    return Promise.resolve();
  }
}
