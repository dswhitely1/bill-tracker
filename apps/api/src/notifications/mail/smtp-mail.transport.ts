import { createTransport, type Transporter } from 'nodemailer';
import { MailMessage, MailTransport } from './mail-transport';

export class SmtpMailTransport extends MailTransport {
  private readonly transporter: Transporter;

  constructor(
    url: string,
    private readonly from: string,
  ) {
    super();
    this.transporter = createTransport(url);
  }

  async send(message: MailMessage): Promise<void> {
    // No try/catch here. A send that fails must reach the caller, which is
    // the only place that knows a failed digest costs the email and
    // nothing else (spec §4.4) — swallowing it here would make a dead
    // mail server indistinguishable from a delivered one.
    await this.transporter.sendMail({
      from: this.from,
      to: message.to,
      subject: message.subject,
      text: message.text,
    });
  }
}
